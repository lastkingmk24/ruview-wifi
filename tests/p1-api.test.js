/**
 * P1 tests — operator HTTP API.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAnonymizer } from '../acquisition/anonymize.js';
import { ProbeClusterer } from '../acquisition/clusterer.js';
import { DeviceCounter } from '../acquisition/counter.js';
import { createPipeline } from '../acquisition/pipeline.js';
import { buildFrame, ie, wrapRadiotap } from '../acquisition/frames.js';
import { createApiServer } from '../server/api.js';

async function withServer(fn) {
  const anonymizer = createAnonymizer();
  const clusterer = new ProbeClusterer({ windowMs: 60_000 });
  const counter = new DeviceCounter({ zoneMap: { 'Floor1-OfficeA': 'Zone-A' } });
  const pipeline = createPipeline({ anonymizer, clusterer, counter });
  const api = await createApiServer({ counter, pipeline, port: 0 });
  try {
    await fn(api);
  } finally {
    await api.close();
  }
}

function probeFrame(seq, sa, ssids) {
  const ies = [
    ...ssids.map((s) => ie(0, Buffer.from(s, 'latin1'))),
    ie(1, Buffer.from([108, 96])), // 54, 48 Mbps
  ];
  return wrapRadiotap(buildFrame({
    fc: 0x0040, seq, da: 'ff:ff:ff:ff:ff:ff', sa, bssid: 'ff:ff:ff:ff:ff:ff', ies,
  }));
}

test('API: health, devices, stats', async () => {
  await withServer(async ({ port }) => {
    const health = await fetch(`http://localhost:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);

    const devices = await fetch(`http://localhost:${port}/api/v1/devices`);
    assert.equal(devices.status, 200);
    const body = await devices.json();
    assert.equal(body.active, 0);

    const stats = await fetch(`http://localhost:${port}/api/v1/stats`);
    assert.equal(stats.status, 200);
    assert.equal((await stats.json()).active, 0);
  });
});

test('API: POST raw frames → counted devices with anonymized ids only', async () => {
  await withServer(async ({ port }) => {
    const frame = probeFrame(1, '02:11:22:33:44:55', ['Floor1-OfficeA']);
    const res = await fetch(`http://localhost:${port}/api/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: [{ tsMs: 1000, data: frame.toString('hex') }] }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).accepted, 1);

    const devices = await (await fetch(`http://localhost:${port}/api/v1/devices`)).json();
    assert.equal(devices.active, 1);
    assert.equal(devices.devices[0].zone, 'Zone-A');
    // No raw MAC anywhere in the response
    const raw = JSON.stringify(devices);
    assert.ok(!raw.includes('02:11:22:33:44:55'));
    assert.ok(!raw.includes('02:11:22'));
  });
});

test('API: POST pre-parsed events', async () => {
  await withServer(async ({ port }) => {
    const res = await fetch(`http://localhost:${port}/api/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [{
          tsMs: 500, subtype: 4, sa: '02:aa:bb:cc:dd:ee', ssids: ['Floor1-OfficeA'],
          rates: [54], oui: 'a45e60', tagIds: [190],
        }],
      }),
    });
    assert.equal(res.status, 200);
    const stats = await (await fetch(`http://localhost:${port}/api/v1/stats`)).json();
    assert.equal(stats.active, 1);
  });
});

test('API: invalid JSON and unknown routes return errors', async () => {
  await withServer(async ({ port }) => {
    const bad = await fetch(`http://localhost:${port}/api/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    assert.equal(bad.status, 400);

    const missing = await fetch(`http://localhost:${port}/nope`);
    assert.equal(missing.status, 404);
  });
});
