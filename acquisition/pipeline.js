/**
 * Ingestion pipeline — glues frame parsing, anonymization, clustering and
 * the device counter together.
 *
 * Only client-originated management frames are counted (probe requests,
 * association requests, authentication requests). AP-side frames (beacons,
 * probe responses) are parsed but ignored for device counting.
 * Raw MACs never leave this pipeline — they are anonymized before the
 * clusterer or counter see them.
 */

import { parseFrame, MGMT_SUBTYPE } from './frames.js';
import { readPcap } from './pcap.js';

const COUNTED_SUBTYPES = new Set([
  MGMT_SUBTYPE.PROBE_REQ,
  MGMT_SUBTYPE.ASSOC_REQ,
  MGMT_SUBTYPE.AUTH,
]);

export function createPipeline({ anonymizer, clusterer, counter }) {
  let parseErrors = 0;
  let dropped = 0;
  let lastEventMs = null;

  function ingestParsedEvent(event) {
    const anonSa = anonymizer.anonymizeMac(event.sa);
    const identity = clusterer.add(event, anonSa);
    counter.ingest({
      ...event,
      sa: anonSa,
      identityId: identity.id,
    });
    lastEventMs = event.tsMs;
    return { ok: true, identityId: identity.id };
  }

  return {
    /**
     * Ingest a raw frame (Buffer, may include radiotap).
     * Returns { ok, identityId?, error? }.
     */
    ingestFrame(buffer, tsMs) {
      const parsed = parseFrame(buffer);
      if (parsed.error) {
        parseErrors += 1;
        return { ok: false, error: parsed.error };
      }
      if (!COUNTED_SUBTYPES.has(parsed.subtype)) {
        dropped += 1; // AP-side frame — not a client device signal
        return { ok: false, dropped: true };
      }
      return ingestParsedEvent({ tsMs, ...parsed });
    },

    /** Ingest a pre-parsed event object (anonymize → cluster → counter). */
    ingestParsedEvent,

    /** Ingest a raw pcap buffer (all packets). */
    ingestPcap(buffer) {
      const packets = readPcap(buffer);
      for (const p of packets) this.ingestFrame(p.data, p.tsMs);
      return { packets: packets.length };
    },

    stats() {
      return {
        parseErrors,
        droppedApSide: dropped,
        eventsProcessed: counter.eventsProcessed,
        lastEventMs,
      };
    },
  };
}
