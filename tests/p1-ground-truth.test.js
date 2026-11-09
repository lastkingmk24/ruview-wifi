/**
 * P1 tests — synthetic baseline acceptance gates (deterministic mock world).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateWorld } from '../acquisition/mock-adapter.js';
import { createAnonymizer } from '../acquisition/anonymize.js';
import { ProbeClusterer } from '../acquisition/clusterer.js';
import { DeviceCounter } from '../acquisition/counter.js';
import { createPipeline } from '../acquisition/pipeline.js';
import { evaluate, zoneAccuracy, GATES } from '../acquisition/evaluation.js';

function runWorld(config = {}) {
  const world = generateWorld({ deviceCount: 20, seed: 0xbeef, durationMs: 600_000, ...config });
  const anonymizer = createAnonymizer();
  const clusterer = new ProbeClusterer({ windowMs: 120_000 });
  const counter = new DeviceCounter({ zoneMap: world.zoneMap });
  const pipeline = createPipeline({ anonymizer, clusterer, counter });
  for (const f of world.frames) pipeline.ingestFrame(f.data, f.tsMs);
  const report = counter.report(world.durationMs);
  return { world, metrics: evaluate(world, clusterer, counter, anonymizer), zones: zoneAccuracy(world, report) };
}

test('synthetic baseline passes all acceptance gates', () => {
  const { metrics, zones } = runWorld();
  for (const [name, check] of GATES) {
    assert.ok(check(metrics), `gate failed: ${name} (metrics: ${JSON.stringify(metrics)})`);
  }
  assert.ok(zones.zoneMAE <= 0.25, `zone MAE ${zones.zoneMAE} exceeds gate`);
  assert.equal(metrics.estimatedActive, metrics.detectableActual);
});

test('randomization mix: per-SSID and per-probe rotation still counts correctly', () => {
  // Same seed, different device count → different rotation mix
  const { metrics } = runWorld({ deviceCount: 24, seed: 0xcafe });
  assert.ok(metrics.recallDetectable >= 0.95, `recall ${metrics.recallDetectable}`);
  assert.ok(metrics.splitRate <= 0.10, `split ${metrics.splitRate}`);
  assert.equal(metrics.mergeCount, 0);
  assert.equal(metrics.phantomCount, 0);
});

test('silent devices bound recall — ceiling is reported', () => {
  const { metrics, world } = runWorld({ deviceCount: 20, offlineRate: 0.2 });
  const ceiling = world.groundTruth.devices.filter((d) => d.detectable).length / world.groundTruth.activeCount;
  assert.ok(metrics.recallAllActive <= ceiling + 1e-9, 'recall cannot exceed detectability ceiling');
  assert.ok(metrics.recallDetectable >= 0.95, 'detectable devices must still be found');
  assert.ok(world.groundTruth.silentCount >= 1, 'mock must include undetectable silent devices');
});

test('zone attribution matches ground truth per zone', () => {
  const { zones } = runWorld();
  for (const row of zones.rows) {
    assert.equal(row.actual, row.estimated, `zone ${row.zone} mismatch`);
  }
});
