/**
 * Deterministic mock adapter — simulates a multiroom building with N WiFi
 * devices and emits raw 802.11 frames (with radiotap) plus a pcap blob.
 *
 * This is a SIMULATION for testing and for a synthetic baseline only.
 * Real-world accuracy must be re-measured against hardware (see
 * scripts/ground-truth.mjs and docs/PHASE1.md).
 */

import { buildFrame, wrapRadiotap, ie, MGMT_SUBTYPE } from './frames.js';
import { writePcap } from './pcap.js';

export const DEFAULT_ZONE_MAP = {
  'Floor1-OfficeA': 'Zone-A',
  'Floor1-OfficeB': 'Zone-B',
  'Floor2-Lab': 'Zone-C',
  GuestWiFi: 'public',
};

const ZONE_AP_SSIDS = ['Floor1-OfficeA', 'Floor1-OfficeB', 'Floor2-Lab', 'GuestWiFi', 'HomeNet'];

const OUI_POOL = [
  'a4:5e:60', '00:1a:11', '28:6c:07', '00:0f:e6', 'ec:8f:1a', '7c:7e:62',
];
const RATES_POOL = [1, 2, 5.5, 6, 9, 11, 12, 18, 24, 36, 48, 54];
const TAG_POOLS = [
  [190],
  [190, 191],
  [190, 191, 192],
  [],
  [192],
  [190, 195],
];
const ROTATIONS = ['none', 'per-ssid', 'per-probe'];

// 66 unique rate pairs — makes device feature sets (rates+OUI+tags)
// distinct by construction for the synthetic baseline.
const RATE_PAIRS = [];
for (let a = 0; a < RATES_POOL.length; a++) {
  for (let b = a + 1; b < RATES_POOL.length; b++) {
    RATE_PAIRS.push([RATES_POOL[a], RATES_POOL[b]]);
  }
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomMac(rand) {
  // Locally administered, non-broadcast address
  const b0 = 0x02 | Math.floor(rand() * 0x7e);
  const rest = [];
  for (let i = 0; i < 5; i++) rest.push(Math.floor(rand() * 256));
  return [b0, ...rest].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

function ratesToIeValue(rates) {
  const top = [...rates].sort((a, b) => b - a).slice(0, 2);
  return Buffer.from(top.map((r) => Math.round(r * 2)));
}

function tagValues(tagIds, rand) {
  return tagIds.map((id) => {
    const len = 2 + Math.floor(rand() * 3);
    return Buffer.from([id, len, ...Array.from({ length: len }, () => Math.floor(rand() * 256))]);
  });
}

function buildProbeRequest({ sa, bssid, ssids, rates, oui, tagIds, seq, rand }) {
  const ies = [
    ...ssids.map((s) => ie(0, Buffer.from(s, 'latin1'))),
    ie(1, ratesToIeValue(rates)),
    ie(221, Buffer.from([...oui.split(':').map((p) => parseInt(p, 16)), 5, 6, 7, 8, 9])),
    ...tagValues(tagIds, rand),
  ];
  return buildFrame({
    fc: 0x0040, // type 0, subtype 4 (probe request)
    seq,
    da: 'ff:ff:ff:ff:ff:ff',
    sa,
    bssid,
    ies,
  });
}

function buildAssocRequest({ sa, bssid, ssid, rates, oui, tagIds, seq, rand }) {
  const cap = Buffer.from([0x31, 0x04]); // capability
  const listen = Buffer.from([0x01, 0x00]); // listen interval
  const ssidIe = ie(0, Buffer.from(ssid, 'latin1'));
  const ies = [
    cap, listen,
    ssidIe,
    ie(1, ratesToIeValue(rates)),
    ie(221, Buffer.from([...oui.split(':').map((p) => parseInt(p, 16)), 5, 6, 7, 8, 9])),
    ...tagValues(tagIds, rand),
  ];
  return buildFrame({
    fc: 0x0000, // type 0, subtype 0 (association request)
    seq,
    da: bssid,
    sa,
    bssid,
    ies,
  });
}

function buildAuthRequest({ sa, bssid, seq }) {
  const algo = Buffer.from([0x01, 0x00]); // open
  const trans = Buffer.from([0x01, 0x00]);
  const status = Buffer.from([0x00, 0x00]);
  return buildFrame({
    fc: 0x00b0, // type 0, subtype 11 (authentication)
    seq,
    da: bssid,
    sa,
    bssid,
    ies: [algo, trans, status],
  });
}

function buildBeacon({ bssid, ssid, rates, tagIds, seq, rand }) {
  const timestamp = Buffer.alloc(8, 1);
  const interval = Buffer.from([0x64, 0x00]); // 100 TU
  const capability = Buffer.from([0x31, 0x04]);
  const ies = [
    ie(0, Buffer.from(ssid, 'latin1')),
    ie(1, ratesToIeValue(rates)),
    ...tagValues(tagIds, rand),
  ];
  return buildFrame({
    fc: 0x0080, // type 0, subtype 8 (beacon)
    seq,
    da: 'ff:ff:ff:ff:ff:ff',
    sa: bssid,
    bssid,
    ies: [timestamp, interval, capability, ...ies],
  });
}

/**
 * Generate a deterministic multiroom device world.
 * Returns { frames: [{tsMs, data}], pcap, groundTruth }.
 */
export function generateWorld({
  deviceCount = 20,
  seed = 0xbeef,
  durationMs = 600_000,
  zoneMap = DEFAULT_ZONE_MAP,
  offlineRate = 0.1,
} = {}) {
  const rand = mulberry32(seed);
  const frames = [];

  // APs (one per zone SSID; 'HomeNet' is an unmapped neighbor)
  const aps = ZONE_AP_SSIDS.map((ssid) => ({ ssid, bssid: randomMac(rand) }));
  const apBySsid = new Map(aps.map((a) => [a.ssid, a]));

  // Devices — signatures are unique by construction (index-derived)
  const devices = [];
  for (let i = 0; i < deviceCount; i++) {
    const rotation = ROTATIONS[i % ROTATIONS.length];
    const zoneIdx = i % ZONE_AP_SSIDS.length;
    const homeSsid = ZONE_AP_SSIDS[zoneIdx];
    const oui = OUI_POOL[i % OUI_POOL.length];
    const rates = RATE_PAIRS[i % RATE_PAIRS.length];
    const tagIds = TAG_POOLS[(i * 7) % TAG_POOLS.length];
    const probeTargets = [homeSsid];
    if (rand() < 0.6) {
      const extra = ZONE_AP_SSIDS[(i * 3 + 2) % ZONE_AP_SSIDS.length];
      if (extra !== homeSsid) probeTargets.push(extra);
    }
    const intervalMs = 5_000 + Math.floor(rand() * 10_000);
    const offline = i < Math.floor(deviceCount * offlineRate); // first devices powered off
    const silent = !offline && i % 9 === 5; // present but transmits nothing (undetectable)
    devices.push({
      index: i,
      mac: randomMac(rand),
      rotation,
      perSsidMacs: new Map(),
      oui,
      rates,
      tagIds,
      probeTargets,
      homeSsid,
      zone: zoneMap[homeSsid] ?? 'unknown',
      intervalMs,
      offline,
      silent,
      assocSsid: rand() < 0.4 ? homeSsid : null,
      seq: 0,
      knownMacs: new Set(),
    });
  }

  const addFrame = (tsMs, data) => frames.push({ tsMs, data: wrapRadiotap(data, { channel: 2412 }) });

  // AP beacons (AP-side; the pipeline ignores them for device counting)
  const beaconSsid = ZONE_AP_SSIDS[0];
  for (const ap of aps) {
    let bt = 0;
    while (bt < durationMs) {
      addFrame(bt, buildBeacon({ bssid: ap.bssid, ssid: ap.ssid, rates: [1, 5.5], tagIds: [], seq: Math.floor(bt / 100), rand }));
      bt += 100;
    }
  }

  // Device probes / associations / auth
  for (const dev of devices) {
    if (dev.offline || dev.silent) continue;
    dev.knownMacs.add(dev.mac);

    let t = Math.floor(rand() * dev.intervalMs);
    while (t < durationMs) {
      // current MAC per rotation policy
      let mac = dev.mac;
      if (dev.rotation === 'per-ssid') {
        if (!dev.perSsidMacs.has(dev.probeTargets[0])) dev.perSsidMacs.set(dev.probeTargets[0], randomMac(rand));
        mac = dev.perSsidMacs.get(dev.probeTargets[0]);
      } else if (dev.rotation === 'per-probe') {
        mac = randomMac(rand);
      }
      dev.knownMacs.add(mac);

      addFrame(t, buildProbeRequest({
        sa: mac,
        bssid: 'ff:ff:ff:ff:ff:ff',
        ssids: dev.probeTargets,
        rates: dev.rates,
        oui: dev.oui,
        tagIds: dev.tagIds,
        seq: dev.seq++,
        rand,
      }));
      t += dev.intervalMs + Math.floor(rand() * 2_000 - 1_000);
    }

    if (dev.assocSsid) {
      const ap = apBySsid.get(dev.assocSsid);
      const assocMac = dev.rotation === 'per-ssid' && dev.perSsidMacs.get(dev.assocSsid)
        ? dev.perSsidMacs.get(dev.assocSsid) : dev.mac;
      dev.knownMacs.add(assocMac);
      const at = Math.floor(rand() * durationMs);
      addFrame(at, buildAssocRequest({
        sa: assocMac,
        bssid: ap.bssid,
        ssid: dev.assocSsid,
        rates: dev.rates,
        oui: dev.oui,
        tagIds: dev.tagIds,
        seq: dev.seq++,
        rand,
      }));
      if (rand() < 0.5) {
        addFrame(at + 10, buildAuthRequest({ sa: assocMac, bssid: ap.bssid, seq: dev.seq++ }));
      }
    }
  }

  frames.sort((a, b) => a.tsMs - b.tsMs);

  const groundTruth = {
    devices: devices.map((d) => ({
      index: d.index,
      mac: d.mac,
      zone: d.zone,
      rotation: d.rotation,
      active: !d.offline,
      detectable: !d.offline && !d.silent,
      knownMacs: [...d.knownMacs],
    })),
    activeCount: devices.filter((d) => !d.offline).length,
    offlineCount: devices.filter((d) => d.offline).length,
    silentCount: devices.filter((d) => d.silent).length,
    detectableCount: devices.filter((d) => !d.offline && !d.silent).length,
  };

  const pcap = writePcap(frames);
  return { frames, pcap, groundTruth, zoneMap, durationMs };
}
