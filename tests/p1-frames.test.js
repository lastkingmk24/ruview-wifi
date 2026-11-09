/**
 * P1 tests — 802.11 frame parsing (radiotap + MAC header + IEs).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFrame,
  buildFrame,
  ie,
  wrapRadiotap,
  MGMT_SUBTYPE,
  SUBTYPE_NAMES,
} from '../acquisition/frames.js';

function ratesIe(rates) {
  return ie(1, Buffer.from(rates.map((r) => Math.round(r * 2))));
}

function vendorIe(oui) {
  return ie(221, Buffer.from([...oui.split(':').map((p) => parseInt(p, 16)), 5, 6, 7, 8, 9]));
}

test('probe request parsing: SSIDs, rates, OUI, tags', () => {
  const ies = [
    ie(0, Buffer.from('Floor1-OfficeA', 'latin1')),
    ie(0, Buffer.from('GuestWiFi', 'latin1')),
    ratesIe([54, 48]),
    vendorIe('a4:5e:60'),
    ie(190, Buffer.from([1, 2])),
    ie(191, Buffer.from([1, 2, 3])),
  ];
  const frame = buildFrame({
    fc: 0x0040,
    seq: 42,
    da: 'ff:ff:ff:ff:ff:ff',
    sa: '02:11:22:33:44:55',
    bssid: 'ff:ff:ff:ff:ff:ff',
    ies,
  });
  const ev = parseFrame(frame, { hasRadiotap: false });
  assert.equal(ev.error, undefined);
  assert.equal(ev.name, 'PROBE_REQ');
  assert.deepEqual(ev.ssids, ['Floor1-OfficeA', 'GuestWiFi']);
  assert.deepEqual(ev.rates, [54, 48]);
  assert.equal(ev.oui, 'a45e60');
  assert.deepEqual(ev.tagIds, [0, 0, 1, 221, 190, 191]);
  assert.equal(ev.sa, '02:11:22:33:44:55');
  assert.equal(ev.seq, 42);
});

test('association request parsing', () => {
  const cap = Buffer.from([0x31, 0x04]);
  const listen = Buffer.from([0x01, 0x00]);
  const frame = buildFrame({
    fc: 0x0000,
    seq: 7,
    da: 'aa:bb:cc:dd:ee:ff',
    sa: '02:11:22:33:44:55',
    bssid: 'aa:bb:cc:dd:ee:ff',
    ies: [cap, listen, ie(0, Buffer.from('Floor1-OfficeA', 'latin1')), ratesIe([54])],
  });
  const ev = parseFrame(frame, { hasRadiotap: false });
  assert.equal(ev.error, undefined);
  assert.equal(ev.name, 'ASSOC_REQ');
  assert.deepEqual(ev.ssids, ['Floor1-OfficeA']);
  assert.equal(ev.sa, '02:11:22:33:44:55');
  assert.equal(ev.bssid, 'aa:bb:cc:dd:ee:ff');
});

test('beacon parsing', () => {
  const timestamp = Buffer.alloc(8, 1);
  const interval = Buffer.from([0x64, 0x00]);
  const capability = Buffer.from([0x31, 0x04]);
  const frame = buildFrame({
    fc: 0x0080,
    seq: 1,
    da: 'ff:ff:ff:ff:ff:ff',
    sa: 'aa:bb:cc:dd:ee:ff',
    bssid: 'aa:bb:cc:dd:ee:ff',
    ies: [timestamp, interval, capability, ie(0, Buffer.from('Floor2-Lab', 'latin1')), ratesIe([1, 5.5])],
  });
  const ev = parseFrame(frame, { hasRadiotap: false });
  assert.equal(ev.error, undefined);
  assert.equal(ev.name, 'BEACON');
  assert.deepEqual(ev.ssids, ['Floor2-Lab']);
});

test('authentication request parsing', () => {
  const algo = Buffer.from([0x01, 0x00]);
  const trans = Buffer.from([0x01, 0x00]);
  const status = Buffer.from([0x00, 0x00]);
  const frame = buildFrame({
    fc: 0x00b0,
    seq: 3,
    da: 'aa:bb:cc:dd:ee:ff',
    sa: '02:11:22:33:44:55',
    bssid: 'aa:bb:cc:dd:ee:ff',
    ies: [algo, trans, status],
  });
  const ev = parseFrame(frame, { hasRadiotap: false });
  assert.equal(ev.error, undefined);
  assert.equal(ev.name, 'AUTH');
  assert.deepEqual(ev.ssids, []);
});

test('radiotap wrapper: skip works and channel is read', () => {
  const inner = buildFrame({
    fc: 0x0040,
    seq: 1,
    da: 'ff:ff:ff:ff:ff:ff',
    sa: '02:11:22:33:44:55',
    bssid: 'ff:ff:ff:ff:ff:ff',
    ies: [ie(0, Buffer.from('GuestWiFi', 'latin1')), ratesIe([54])],
  });
  const wrapped = wrapRadiotap(inner, { channel: 2412 });
  const ev = parseFrame(wrapped);
  assert.equal(ev.error, undefined);
  assert.equal(ev.name, 'PROBE_REQ');
  assert.equal(ev.channel, 2412);
  assert.deepEqual(ev.ssids, ['GuestWiFi']);
});

test('malformed and non-management frames return errors', () => {
  assert.equal(parseFrame(Buffer.alloc(8), { hasRadiotap: false }).error !== undefined, true);
  // 802.11 data frame (type 2)
  const dataFrame = Buffer.alloc(24);
  dataFrame.writeUInt16LE(0x0008, 0); // type 2 (data), subtype 0
  const ev = parseFrame(dataFrame, { hasRadiotap: false });
  assert.equal(ev.error, 'not a management frame');
});

test('subtype name table is complete for handled frames', () => {
  assert.equal(SUBTYPE_NAMES[MGMT_SUBTYPE.PROBE_REQ], 'PROBE_REQ');
  assert.equal(SUBTYPE_NAMES[MGMT_SUBTYPE.BEACON], 'BEACON');
});
