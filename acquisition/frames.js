/**
 * 802.11 frame parsing — radiotap header skipping + MAC header + IE parsing.
 *
 * Pure logic (no I/O): parses raw 802.11 management frames (probe req/resp,
 * beacon, assoc req/resp, auth) into structured metadata for device counting.
 *
 * Payload/upper-layer data is never parsed or retained — metadata only.
 */

export const TYPE = Object.freeze({ MGMT: 0, CTL: 1, DATA: 2 });

export const MGMT_SUBTYPE = Object.freeze({
  ASSOC_REQ: 0x00,
  ASSOC_RESP: 0x01,
  AUTH: 0x0b,
  PROBE_REQ: 0x04,
  PROBE_RESP: 0x05,
  BEACON: 0x08,
  DISASSOC: 0x0a,
  DEAUTH: 0x0c,
  ACTION: 0x0d,
});

export const SUBTYPE_NAMES = Object.fromEntries(
  Object.entries(MGMT_SUBTYPE).map(([k, v]) => [v, k]),
);

// Radiotap field sizes (spec v1.0) for the common fields. Fields beyond this
// table are rare; if a capture contains them, the frame is skipped with a
// 'unsupported radiotap field' error (documented limitation).
const RADIOTAP_FIELD_SIZES = {
  0: 8, // TSFT
  1: 1, // Flags
  2: 2, // Rate (uint16)
  3: 4, // Channel (freq u16 + flags u16)
  4: 2, // FHSS
  5: 1, // dBm Antenna
  6: 1, // dBm Noise
  7: 2, // Lock Quality
  8: 2, // TX Flags
  9: 2, // RX Flags
  10: 1, // dBm Antenna Noise (Linux-specific)
  11: 1, // RTS Retries
  12: 2, // RTTS
  13: 4, // Reserved
};

export function macToBuffer(mac) {
  const parts = mac.split(':');
  if (parts.length !== 6) throw new Error(`invalid MAC: ${mac}`);
  return Buffer.from(parts.map((p) => parseInt(p, 16)));
}

export function bufferToMac(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

/** Skip a radiotap header; returns { offset, channel } or { error }. */
export function skipRadiotap(buf, offset = 0) {
  if (buf.length - offset < 4) return { error: 'truncated radiotap' };
  const version = buf[offset];
  if (version !== 0) return { error: 'bad radiotap version' };
  const headerLen = buf.readUInt16LE(offset + 2);
  if (headerLen < 4) return { error: 'bad radiotap len' };
  if (buf.length - offset < headerLen) return { error: 'truncated radiotap header' };

  let p = offset + 4;
  let present = buf.readUInt32LE(p);
  p += 4;
  let channel = null;
  let bit = 0;
  while (present !== 0) {
    if (present & 1) {
      if (bit === 31) {
        present = buf.readUInt32LE(p);
        p += 4;
        bit = 0;
        continue;
      }
      const size = RADIOTAP_FIELD_SIZES[bit];
      if (size === undefined) return { error: `unsupported radiotap field ${bit}` };
      if (bit === 3) channel = buf.readUInt16LE(p);
      p += size;
    }
    present >>= 1;
    bit++;
  }
  return { offset: p, channel };
}

/**
 * Parse a raw 802.11 frame into a FrameEvent (metadata only).
 * Returns { error } for unsupported/truncated frames.
 */
export function parseFrame(buffer, { hasRadiotap = true } = {}) {
  let offset = 0;
  let channel = null;
  if (hasRadiotap) {
    const r = skipRadiotap(buffer, 0);
    if (r.error) return { error: r.error };
    offset = r.offset;
    channel = r.channel;
  }

  if (buffer.length - offset < 24) return { error: 'truncated 802.11 header' };
  const fc = buffer.readUInt16LE(offset);
  const version = fc & 0x03;
  const type = (fc >>> 2) & 0x03;
  const subtype = (fc >>> 4) & 0x0f;
  const flags = (fc >>> 8) & 0xff;

  if (version !== 0) return { error: 'bad 802.11 version' };
  if (type !== TYPE.MGMT) return { error: 'not a management frame' };

  const seq = buffer.readUInt16LE(offset + 22);
  const da = bufferToMac(buffer.subarray(offset + 4, offset + 10));
  const sa = bufferToMac(buffer.subarray(offset + 10, offset + 16));
  const bssid = bufferToMac(buffer.subarray(offset + 16, offset + 22));

  // Management body offsets (fixed fields before IEs)
  let bodyOffset = offset + 24;
  if (subtype === MGMT_SUBTYPE.BEACON) {
    if (buffer.length - bodyOffset < 12) return { error: 'truncated beacon' };
    bodyOffset += 12; // timestamp 8 + interval 2 + capability 2
  } else if (subtype === MGMT_SUBTYPE.ASSOC_REQ) {
    bodyOffset += 4; // capability 2 + listen interval 2
  } else if (subtype === MGMT_SUBTYPE.ASSOC_RESP) {
    bodyOffset += 6; // capability 2 + status 2 + aid 2
  } else if (subtype === MGMT_SUBTYPE.AUTH) {
    bodyOffset += 6; // auth algo 2 + trans seq 2 + status 2
  }

  const ies = parseIes(buffer, bodyOffset);
  const { ssids, rates, oui, tagIds, featureTags } = extractIeInfo(ies);

  return {
    type,
    subtype,
    name: SUBTYPE_NAMES[subtype] ?? `unknown(${subtype})`,
    da,
    sa,
    bssid,
    seq,
    tods: (flags & 0x01) !== 0,
    fromds: (flags & 0x02) !== 0,
    ssids,
    rates,
    oui,
    tagIds,
    featureTags,
    channel,
  };
}

export function parseIes(buffer, offset) {
  const ies = [];
  let p = offset;
  while (p + 4 <= buffer.length) {
    const id = buffer[p];
    const len = buffer[p + 1];
    if (p + 2 + len > buffer.length) break;
    ies.push({ id, value: buffer.subarray(p + 2, p + 2 + len) });
    p += 2 + len;
  }
  return ies;
}

export function extractIeInfo(ies) {
  const ssids = [];
  const rates = [];
  const tagIds = [];
  let oui = null;
  for (const ie of ies) {
    tagIds.push(ie.id);
    if (ie.id === 0 && ie.value.length > 0) {
      ssids.push(ie.value.toString('latin1'));
    } else if (ie.id === 1 && ie.value.length > 0) {
      // Supported rates: each byte is a rate in 500 kbps units
      for (const b of ie.value) rates.push(b * 0.5);
    } else if (ie.id === 255 && ie.value.length > 0) {
      // Extended supported rates: same encoding
      for (const b of ie.value) rates.push(b * 0.5);
    } else if (ie.id === 221 && ie.value.length >= 4) {
      // Vendor specific: first 3 bytes are the OUI
      oui = ie.value.subarray(0, 3).toString('hex');
    }
  }
  // Feature tags: fingerprint tags only — SSID (0), rates (1) and vendor (221)
  // are already represented by ssids/rates/oui.
  const featureTags = tagIds.filter((t) => t !== 0 && t !== 1 && t !== 221);
  return { ssids, rates, oui, tagIds, featureTags };
}

/** Build a raw 802.11 management frame from parts (used by the mock adapter). */
export function buildFrame({ fc, seq, da, sa, bssid, ies, flags = 0 }) {
  let bodyLen = 0;
  for (const ie of ies) bodyLen += ie.length;
  const buf = Buffer.alloc(24 + bodyLen);
  buf.writeUInt16LE(fc | (flags << 8), 0);
  buf.writeUInt16LE(0, 2); // duration
  macToBuffer(da).copy(buf, 4);
  macToBuffer(sa).copy(buf, 10);
  macToBuffer(bssid).copy(buf, 16);
  buf.writeUInt16LE(seq, 22);
  let p = 24;
  for (const ie of ies) {
    ie.copy(buf, p);
    p += ie.length;
  }
  return buf;
}

export function ie(id, value) {
  const out = Buffer.alloc(2 + value.length);
  out[0] = id;
  out[1] = value.length;
  value.forEach((b, i) => out[2 + i] = b);
  return out;
}

/** Build a radiotap-wrapped frame (used by the mock adapter). */
export function wrapRadiotap(payload, { channel = 2412 } = {}) {
  // present = TSFT(0) | FLAGS(1) | RATE(2) | CHANNEL(3)
  const present = 0x0000000f;
  const header = Buffer.alloc(23);
  header[0] = 0; // version
  header[1] = 0; // pad
  header.writeUInt16LE(23, 2); // header length
  header.writeUInt32LE(present, 4);
  header.writeUInt32LE(0, 8); // TSFT low (µs)
  header.writeUInt32LE(0, 12); // TSFT high
  header[16] = 0; // flags
  header.writeUInt16LE(24, 17); // rate (24 Mbps, arbitrary)
  header.writeUInt16LE(channel, 19); // channel frequency (MHz)
  header.writeUInt16LE(0x0010, 21); // channel flags (2.4 GHz)
  return Buffer.concat([header, payload]);
}
