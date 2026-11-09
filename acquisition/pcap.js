/**
 * pcap reading/writing — supports LINKTYPE_IEEE802_11_RADIOTAP (127) and
 * Linux cooked captures (105, 16-byte header). Zero dependencies.
 *
 * Used both for file replay (a capture written by tcpdump) and for live
 * streaming from `tcpdump -w -` (incremental chunk feeding).
 */

export const PCAP_MAGIC = 0xa1b2c3d4;
export const LINKTYPE_RADIOTAP = 127;
export const LINKTYPE_LINUX_COOKED = 105;

export function writePcap(packets, { snaplen = 262144 } = {}) {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(PCAP_MAGIC, 0); // magic (LE encoding)
  header.writeUInt16LE(2, 4); // version major
  header.writeUInt16LE(4, 6); // version minor
  header.writeUInt32LE(0, 8); // thiszone
  header.writeUInt32LE(0, 12); // sigfigs
  header.writeUInt32LE(snaplen, 16);
  header.writeUInt32LE(LINKTYPE_RADIOTAP, 20);

  const records = packets.map(({ tsMs, data }) => {
    const rec = Buffer.alloc(16);
    const sec = Math.floor(tsMs / 1000);
    const usec = Math.round((tsMs - sec * 1000) * 1000);
    rec.writeUInt32LE(sec, 0);
    rec.writeUInt32LE(usec, 4);
    rec.writeUInt32LE(data.length, 8);
    rec.writeUInt32LE(data.length, 12);
    return Buffer.concat([rec, data]);
  });
  return Buffer.concat([header, ...records]);
}

/** Parse a complete pcap file into { tsMs, data } packets. */
export function readPcap(buffer) {
  if (buffer.length < 24) throw new Error('truncated pcap file');
  let swapped = false;
  if (buffer.readUInt32LE(0) === PCAP_MAGIC) {
    swapped = false;
  } else if (buffer.readUInt32BE(0) === PCAP_MAGIC) {
    swapped = true;
  } else {
    throw new Error('bad pcap magic');
  }
  const readU32 = (off) => (swapped ? buffer.readUInt32BE(off) : buffer.readUInt32LE(off));
  const linktype = readU32(20);
  const packets = [];
  let p = 24;
  while (p + 16 <= buffer.length) {
    const sec = readU32(p);
    const usec = readU32(p + 4);
    const inclLen = readU32(p + 8);
    const origLen = readU32(p + 12);
    p += 16;
    if (p + inclLen > buffer.length) break; // truncated final record
    const data = Buffer.from(buffer.subarray(p, p + inclLen));
    p += inclLen;

    if (linktype === LINKTYPE_LINUX_COOKED && data.length >= 16) {
      data = data.subarray(16); // strip cooked header
    }
    packets.push({ tsMs: sec * 1000 + usec / 1000, data });
  }
  return packets;
}

/**
 * Incremental pcap stream parser — feeds chunks from a live capture
 * (`tcpdump -w -`) and emits complete packets via onPacket.
 */
export function createPcapStreamParser({ onPacket } = {}) {
  let buf = Buffer.alloc(0);
  let swapped = false;
  let linktype = null;
  let offset = 0;
  let headerParsed = false;

  return {
    push(chunk) {
      buf = Buffer.concat([buf, chunk]);
      if (!headerParsed) {
        if (buf.length < 24) return;
        if (buf.readUInt32LE(0) === PCAP_MAGIC) swapped = false;
        else if (buf.readUInt32BE(0) === PCAP_MAGIC) swapped = true;
        else {
          throw new Error('bad pcap magic in stream');
        }
        const readU32 = (off) => (swapped ? buf.readUInt32BE(off) : buf.readUInt32LE(off));
        linktype = readU32(20);
        offset = 24;
        headerParsed = true;
      }

      const readU32 = (off) => (swapped ? buf.readUInt32BE(off) : buf.readUInt32LE(off));
      while (buf.length - offset >= 16) {
        const inclLen = readU32(offset + 8);
        if (buf.length - offset < 16 + inclLen) break;
        const sec = readU32(offset);
        const usec = readU32(offset + 4);
        let data = Buffer.from(buf.subarray(offset + 16, offset + 16 + inclLen));
        if (linktype === LINKTYPE_LINUX_COOKED && data.length >= 16) {
          data = data.subarray(16);
        }
        offset += 16 + inclLen;
        if (onPacket) onPacket({ tsMs: sec * 1000 + usec / 1000, data });
      }
      // drop the consumed prefix
      buf = offset > 0 ? Buffer.from(buf.subarray(offset)) : buf;
      offset = 0;
    },
    get packetCount() {
      return this._count ?? 0;
    },
  };
}
