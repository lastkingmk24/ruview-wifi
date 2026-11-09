/**
 * P1 tests — anonymizer, clusterer, counter, and the full in-memory + pcap
 * pipeline over a deterministic mock world.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAnonymizer } from '../acquisition/anonymize.js';
import { ProbeClusterer, signatureOf } from '../acquisition/clusterer.js';
import { DeviceCounter, DEVICE_STATUS } from '../acquisition/counter.js';
import { createPipeline } from '../acquisition/pipeline.js';
import { generateWorld } from '../acquisition/mock-adapter.js';

test('anonymizer: stable, salt-dependent, no raw MAC leakage', () => {
  const a = createAnonymizer('salt-1');
  const b = createAnonymizer('salt-2');
  const mac = 'AA:BB:CC:DD:EE:FF';
  assert.equal(a.anonymizeMac(mac), a.anonymizeMac(mac));
  assert.equal(a.anonymizeMac(mac), a.anonymizeMac(mac.toLowerCase()));
  assert.notEqual(a.anonymizeMac(mac), b.anonymizeMac(mac));
  assert.match(a.anonymizeMac(mac), /^dev_[0-9a-f]{16}$/);
  assert.ok(!a.anonymizeMac(mac).toLowerCase().includes('aa'));
});

test('signatureOf includes SSIDs, rates, OUI and tags', () => {
  const sig1 = signatureOf({ ssids: ['A', 'B'], rates: [54, 48], oui: 'a45e60', tagIds: [190] });
  const sig2 = signatureOf({ ssids: ['B', 'A'], rates: [48, 54], oui: 'a45e60', tagIds: [190] });
  const sig3 = signatureOf({ ssids: ['A', 'B'], rates: [54, 48], oui: 'a45e60', tagIds: [190, 191] });
  assert.equal(sig1, sig2);
  assert.notEqual(sig1, sig3);
});

test('clusterer: per-SSID MAC rotation merges into one identity', () => {
  const clusterer = new ProbeClusterer({ windowMs: 60_000 });
  const base = { rates: [54], oui: 'a45e60', tagIds: [190], channel: 2412 };
  const ev1 = { tsMs: 0, ssids: ['Floor1-OfficeA'], ...base };
  const ev2 = { tsMs: 5_000, ssids: ['Floor1-OfficeA'], ...base };
  const id1 = clusterer.add(ev1, 'dev_aaa');
  const id2 = clusterer.add(ev2, 'dev_bbb');
  assert.equal(id1.id, id2.id, 'different MACs, same signature+window → same identity');
});

test('clusterer: same signature far apart in time stays separate', () => {
  const clusterer = new ProbeClusterer({ windowMs: 60_000 });
  const base = { rates: [54], oui: 'a45e60', tagIds: [190] };
  const id1 = clusterer.add({ tsMs: 0, ssids: ['X'], ...base }, 'dev_aaa');
  const id2 = clusterer.add({ tsMs: 120_000, ssids: ['X'], ...base }, 'dev_bbb');
  assert.notEqual(id1.id, id2.id, 'time window must separate stale duplicates');
});

test('clusterer: same MAC always merges', () => {
  const clusterer = new ProbeClusterer({ windowMs: 60_000 });
  const id1 = clusterer.add({ tsMs: 0, ssids: ['A'], rates: [54], oui: 'a', tagIds: [] }, 'dev_x');
  const id2 = clusterer.add({ tsMs: 600_000, ssids: ['B'], rates: [24], oui: 'b', tagIds: [] }, 'dev_x');
  assert.equal(id1.id, id2.id);
});

test('clusterer: association event (single-SSID signature) merges into probe identity', () => {
  const clusterer = new ProbeClusterer({ windowMs: 60_000 });
  const feats = { rates: [54], oui: '7c7e62', tagIds: [190, 195] };
  const probe = clusterer.add({ tsMs: 10_000, ssids: ['Floor1-OfficeA', 'Floor1-OfficeB'], ...feats }, 'dev_probe');
  // Association to one of the probed SSIDs with a different (fresh) MAC
  const assoc = clusterer.add({ tsMs: 10_500, ssids: ['Floor1-OfficeB'], ...feats }, 'dev_fresh');
  assert.equal(probe.id, assoc.id, 'assoc must merge into the probe identity');
});

test('clusterer: same features but disjoint SSIDs stay separate', () => {
  const clusterer = new ProbeClusterer({ windowMs: 60_000 });
  const feats = { rates: [54], oui: '7c7e62', tagIds: [190] };
  const a = clusterer.add({ tsMs: 1_000, ssids: ['AlphaNet'], ...feats }, 'dev_a');
  const b = clusterer.add({ tsMs: 2_000, ssids: ['BravoNet'], ...feats }, 'dev_b');
  assert.notEqual(a.id, b.id, 'disjoint SSID sets with same features are different devices');
});

test('counter: zone attribution, confidence, staleness, report shape', () => {
  const zoneMap = { 'Floor1-OfficeA': 'Zone-A', GuestWiFi: 'public' };
  const counter = new DeviceCounter({ zoneMap, staleMs: 5_000 });
  counter.ingest({
    tsMs: 0, subtype: 4, identityId: 'id_1', ssids: ['Floor1-OfficeA'], sa: 'dev_a',
  });
  counter.ingest({
    tsMs: 1_000, subtype: 4, identityId: 'id_1', ssids: ['Floor1-OfficeA'], sa: 'dev_a',
  });
  counter.ingest({
    tsMs: 2_000, subtype: 0, identityId: 'id_1', ssids: ['Floor1-OfficeA'], sa: 'dev_a',
  });
  counter.ingest({
    tsMs: 0, subtype: 4, identityId: 'id_2', ssids: ['GuestWiFi'], sa: 'dev_b',
  });
  const report = counter.report(3_000);
  assert.equal(report.active, 2);
  assert.equal(report.byZone['Zone-A'], 1);
  assert.equal(report.byZone['public'], 1);
  const devA = report.devices.find((d) => d.id === 'id_1');
  assert.equal(devA.zone, 'Zone-A');
  assert.equal(devA.assocSeen, true);
  assert.ok(devA.confidence > 0.5);
  // staleness
  const report2 = counter.report(10_000);
  assert.equal(report2.active, 0);
  assert.equal(report2.stale, 2);
});

test('pipeline: full mock world — in-memory count matches ground truth', () => {
  const world = generateWorld({ deviceCount: 20, seed: 0xbeef, durationMs: 600_000 });
  const anonymizer = createAnonymizer();
  const clusterer = new ProbeClusterer({ windowMs: 120_000 });
  const counter = new DeviceCounter({ zoneMap: world.zoneMap });
  const pipeline = createPipeline({ anonymizer, clusterer, counter });
  for (const f of world.frames) pipeline.ingestFrame(f.data, f.tsMs);

  const report = counter.report(world.durationMs);
  assert.equal(report.active, world.groundTruth.detectableCount);
  assert.equal(pipeline.stats().parseErrors, 0);
});

test('pipeline: pcap round-trip yields the same count as in-memory', () => {
  const world = generateWorld({ deviceCount: 20, seed: 0xbeef, durationMs: 600_000 });
  const make = () => {
    const anonymizer = createAnonymizer();
    const clusterer = new ProbeClusterer({ windowMs: 120_000 });
    const counter = new DeviceCounter({ zoneMap: world.zoneMap });
    const pipeline = createPipeline({ anonymizer, clusterer, counter });
    return { pipeline, counter };
  };
  const a = make();
  for (const f of world.frames) a.pipeline.ingestFrame(f.data, f.tsMs);
  const b = make();
  b.pipeline.ingestPcap(world.pcap);

  assert.equal(a.counter.report(world.durationMs).active, b.counter.report(world.durationMs).active);
  assert.equal(b.counter.report(world.durationMs).active, world.groundTruth.detectableCount);
});

test('pipeline: AP-side frames (beacons) are dropped, not counted', () => {
  const world = generateWorld({ deviceCount: 5, seed: 1, durationMs: 5_000 });
  const anonymizer = createAnonymizer();
  const clusterer = new ProbeClusterer({ windowMs: 60_000 });
  const counter = new DeviceCounter({ zoneMap: world.zoneMap });
  const pipeline = createPipeline({ anonymizer, clusterer, counter });
  for (const f of world.frames) pipeline.ingestFrame(f.data, f.tsMs);
  const stats = pipeline.stats();
  assert.ok(stats.droppedApSide > 0, 'beacons should be dropped');
  assert.equal(stats.parseErrors, 0);
});
