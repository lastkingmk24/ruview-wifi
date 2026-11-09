/**
 * P1 tests — pcap round-trip and streaming parser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { writePcap, readPcap, createPcapStreamParser } from '../acquisition/pcap.js';

function makePackets(n = 5) {
  return Array.from({ length: n }, (_, i) => ({
    tsMs: 1000 + i * 250,
    data: Buffer.from(`packet-${i}`),
  }));
}

test('pcap round-trip preserves packets and timestamps', () => {
  const packets = makePackets(7);
  const blob = writePcap(packets);
  const out = readPcap(blob);
  assert.equal(out.length, 7);
  for (let i = 0; i < packets.length; i++) {
    assert.equal(out[i].tsMs, packets[i].tsMs);
    assert.equal(out[i].data.toString(), packets[i].data.toString());
  }
});

test('pcap reader handles big-endian files', () => {
  const header = Buffer.alloc(24);
  header[0] = 0xa1; header[1] = 0xb2; header[2] = 0xc3; header[3] = 0xd4; // BE magic
  header.writeUInt16BE(2, 4);
  header.writeUInt16BE(4, 6);
  header.writeUInt32BE(0, 8);
  header.writeUInt32BE(0, 12);
  header.writeUInt32BE(262144, 16);
  header.writeUInt32BE(127, 20);
  const rec = Buffer.alloc(16);
  rec.writeUInt32BE(1, 0); // sec (epoch 1s → tsMs 1000)
  rec.writeUInt32BE(0, 4); // usec
  rec.writeUInt32BE(8, 8); // incl ('packet-0' is 8 bytes)
  rec.writeUInt32BE(8, 12); // orig
  const blob = Buffer.concat([header, rec, Buffer.from('packet-0')]);
  const out = readPcap(blob);
  assert.equal(out.length, 1);
  assert.equal(out[0].tsMs, 1000);
  assert.equal(out[0].data.toString(), 'packet-0');
});

test('streaming parser handles chunked input', () => {
  const packets = makePackets(10);
  const blob = writePcap(packets);
  const collected = [];
  const parser = createPcapStreamParser({ onPacket: (p) => collected.push(p) });
  // feed in uneven chunks
  let chunkSize = 7;
  for (let i = 0; i < blob.length; i += chunkSize) {
    parser.push(blob.subarray(i, Math.min(i + chunkSize, blob.length)));
  }
  assert.equal(collected.length, 10);
  assert.equal(collected[0].tsMs, 1000);
  assert.equal(collected[9].data.toString(), 'packet-9');
});

test('pcap reader rejects bad magic', () => {
  const bad = Buffer.alloc(64);
  assert.throws(() => readPcap(bad), /bad pcap magic/);
});
