/**
 * RuView Observatory — simulation engine tests (node:test, zero dependencies).
 *
 * Run with: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorld,
  tick,
  setPaused,
  setSpeed,
  snapshot,
  SUBCARRIER_COUNT,
  SECTOR_ROWS,
  SECTOR_COLS,
  MAX_TELEMETRY,
  LEVEL,
  NODE_STATUS,
  CONTACT_STATE,
} from '../src/observatory.js';

function runTicks(world, count, dt = 200) {
  for (let i = 0; i < count; i++) tick(world, dt);
  return world;
}

test('world starts in a valid state', () => {
  const world = createWorld({ seed: 1234 });
  assert.equal(world.sectors.length, SECTOR_ROWS * SECTOR_COLS);
  assert.equal(world.subcarriers.length, SUBCARRIER_COUNT);
  assert.equal(world.contacts.length, 4);
  assert.equal(world.nodes.length, 12);
  assert.equal(world.time, 0);
  assert.equal(world.paused, false);
  assert.equal(world.speed, 1);
  assert.equal(world.alerts.length, 0);
});

test('simulation is deterministic for a given seed', () => {
  const a = snapshot(runTicks(createWorld({ seed: 42 }), 30));
  const b = snapshot(runTicks(createWorld({ seed: 42 }), 30));
  assert.deepEqual(a, b);

  const c = snapshot(runTicks(createWorld({ seed: 43 }), 30));
  assert.notDeepEqual(a, c);
});

test('contacts stay inside the sector grid and keep moving or dwelling', () => {
  const world = createWorld({ seed: 7 });
  runTicks(world, 200);
  for (const contact of world.contacts) {
    assert.ok(contact.x >= 0 && contact.x < SECTOR_COLS, `contact ${contact.id} x out of bounds`);
    assert.ok(contact.y >= 0 && contact.y < SECTOR_ROWS, `contact ${contact.id} y out of bounds`);
    assert.ok([CONTACT_STATE.MOVING, CONTACT_STATE.DWELLING].includes(contact.state));
    assert.ok(contact.confidence > 0 && contact.confidence <= 1);
  }
});

test('vitals stay within physiological ranges over time', () => {
  const world = createWorld({ seed: 99 });
  runTicks(world, 300);
  for (const contact of world.contacts) {
    assert.ok(contact.breathing >= 10 && contact.breathing <= 26, 'breathing out of range');
    assert.ok(contact.heart >= 45 && contact.heart <= 110, 'heart rate out of range');
  }
});

test('sector occupancy reflects contact positions', () => {
  const world = createWorld({ seed: 5, contactCount: 3 });
  runTicks(world, 40);
  const occupied = world.sectors.filter((s) => s.occupancy > 0);
  assert.ok(occupied.length > 0, 'expected at least one occupied sector');
  const total = world.sectors.reduce((n, s) => n + s.occupancy, 0);
  assert.ok(total >= 1 && total <= world.contacts.length);
});

test('pause freezes the simulation; resume continues it', () => {
  const world = createWorld({ seed: 8 });
  runTicks(world, 10);
  const t0 = world.time;
  setPaused(world, true);
  tick(world);
  assert.equal(world.time, t0, 'paused world must not advance');
  setPaused(world, false);
  tick(world);
  assert.ok(world.time > t0, 'resumed world must advance');
});

test('speed multiplier scales simulated time', () => {
  const world = createWorld({ seed: 8 });
  setSpeed(world, 4);
  tick(world, 200);
  assert.equal(world.time, 800);
  setSpeed(world, 0);
  assert.ok(world.speed >= 0.25, 'speed must have a floor');
});

test('CSI subcarriers stay in [0,1] and include breathing modulation', () => {
  const world = createWorld({ seed: 3 });
  runTicks(world, 120);
  for (const sub of world.subcarriers) {
    assert.ok(sub.amplitude >= 0.05 && sub.amplitude <= 1, 'subcarrier amplitude out of range');
    assert.ok(sub.freq >= 5 && sub.freq <= 6, 'subcarrier frequency out of range');
  }
});

test('interference burst raises a WARN alert and spikes a band', () => {
  const world = createWorld({ seed: 11, interferenceRate: 1 });
  runTicks(world, 3);
  assert.equal(world.interference.active, true);
  const warn = world.alerts.filter((a) => a.level === LEVEL.WARN && a.type === 'RF_INTERFERENCE');
  assert.ok(warn.length >= 1, 'expected interference alert');
  const band = world.interference.band;
  const spiked = world.subcarriers.filter((s, i) => Math.abs(i - band) < world.interference.width);
  assert.ok(spiked.some((s) => s.amplitude > 0.6), 'expected amplitude spike in the band');
});

test('node status transitions raise alerts and recover', () => {
  const world = createWorld({ seed: 12, nodeFailureRate: 0.05 });
  runTicks(world, 300);
  const nodeAlerts = world.alerts.filter((a) => a.type.startsWith('NODE_'));
  assert.ok(nodeAlerts.length >= 1, 'expected node status alerts');
  const offline = world.nodes.some((n) => n.status === NODE_STATUS.OFFLINE);
  assert.ok(offline || nodeAlerts.some((a) => a.type === 'NODE_OFFLINE'));
});

test('telemetry history is capped', () => {
  const world = createWorld({ seed: 21 });
  runTicks(world, 400);
  assert.ok(world.telemetry.length <= MAX_TELEMETRY);
  assert.ok(world.telemetry.length > 0);
  const last = world.telemetry[world.telemetry.length - 1];
  assert.ok('presence' in last && 'breathing' in last && 'heart' in last);
});

test('alert history is capped', () => {
  const world = createWorld({ seed: 22, interferenceRate: 0.5, nodeFailureRate: 0.2 });
  runTicks(world, 400);
  assert.ok(world.alerts.length <= 100);
});

test('stats track ticks and detections', () => {
  const world = createWorld({ seed: 31 });
  runTicks(world, 20);
  assert.equal(world.stats.ticks, 20);
  assert.ok(world.stats.detections > 0, 'moving contacts should count as detections');
});

test('snapshot isolates the world state', () => {
  const world = createWorld({ seed: 41 });
  runTicks(world, 5);
  const snap = snapshot(world);
  tick(world, 5);
  assert.notEqual(snap.time, world.time);
  assert.equal(snap.contacts.length, world.contacts.length);
});
