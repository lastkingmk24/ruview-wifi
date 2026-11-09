/**
 * Randomization-aware probe clustering.
 *
 * Modern devices rotate (randomize) their MAC addresses in probe requests.
 * To count devices instead of MACs, probe events are clustered into device
 * identities using a probe "signature" — the probed SSID list, supported
 * rates, vendor OUI and IE tags — plus a time window.
 *
 * Merge rules (in order):
 *  1. Same anonymized MAC → same identity.
 *  2. Same feature set (rates + OUI + tags) AND overlapping SSID sets AND
 *     within the time window → same identity. This handles association
 *     events (single-SSID signatures) merging into a device's probe identity,
 *     and per-SSID / per-probe MAC rotation.
 *
 * Known trade-offs (documented in docs/PHASE1.md):
 *  - Two different devices with identical features probing the same SSID
 *    within the window may be wrongly merged (false merge → undercount).
 *  - A device whose probes are too sparse (spacing > window) may be split
 *    into multiple identities (overcount).
 */

export function signatureOf(event) {
  const ssids = [...(event.ssids ?? [])].sort();
  const rates = [...(event.rates ?? [])].map((r) => r.toFixed(1)).sort();
  const tags = [...(event.tagIds ?? [])].sort((a, b) => a - b);
  return [
    ssids.join('|'),
    rates.join(','),
    event.oui ?? '',
    tags.join(','),
  ].join('~');
}

export function featuresOf(event) {
  // Feature portion of the signature: rates + OUI + fingerprint tags
  // (SSID-independent). Fingerprint tags exclude SSID (0), rates (1) and
  // vendor (221) — those are represented by ssids/rates/oui already.
  const rates = [...(event.rates ?? [])].map((r) => r.toFixed(1)).sort();
  const tags = [...(event.featureTags
    ?? (event.tagIds ?? []).filter((t) => t !== 0 && t !== 1 && t !== 221))]
    .sort((a, b) => a - b);
  return `${rates.join(',')}~${event.oui ?? ''}~${tags.join(',')}`;
}

export class ProbeClusterer {
  constructor({ windowMs = 120_000, maxIdentities = 5_000 } = {}) {
    this.windowMs = windowMs;
    this.maxIdentities = maxIdentities;
    this.identities = [];
    this.nextId = 1;
  }

  /**
   * Assign a probe event to a device identity.
   * Returns the identity object.
   */
  add(event, anonMac) {
    const sig = signatureOf(event);
    const features = featuresOf(event);
    const ssids = new Set(event.ssids ?? []);

    for (const id of this.identities) {
      if (this._matches(id, event, anonMac, features, ssids)) {
        return this._assign(id, event, anonMac, sig, features, ssids);
      }
    }

    // New identity
    if (this.identities.length >= this.maxIdentities) {
      this.identities.sort((a, b) => a.lastSeenMs - b.lastSeenMs).shift();
    }
    const id = {
      id: `id_${String(this.nextId++).padStart(4, '0')}`,
      macs: new Set([anonMac]),
      sig,
      features,
      ssids,
      firstSeenMs: event.tsMs,
      lastSeenMs: event.tsMs,
      eventCount: 1,
    };
    this.identities.push(id);
    return id;
  }

  _matches(id, event, anonMac, features, ssids) {
    if (id.macs.has(anonMac)) return true;
    if (id.features !== features) return false;
    if (id.lastSeenMs < event.tsMs - this.windowMs) return false;
    // SSID overlap: equal sets, or at least one shared SSID
    if (ssids.size === 0 || id.ssids.size === 0) return true;
    for (const s of ssids) {
      if (id.ssids.has(s)) return true;
    }
    return false;
  }

  _assign(id, event, anonMac, sig, features, ssids) {
    id.macs.add(anonMac);
    id.lastSeenMs = event.tsMs;
    id.eventCount += 1;
    // Grow the stored signature/features/SSID set with new observations
    for (const s of ssids) id.ssids.add(s);
    const merged = new Set([...id.ssids, ...ssids]);
    id.ssids = merged;
    // Keep the richest observed full signature
    if (sig.length > id.sig.length) id.sig = sig;
    return id;
  }

  snapshot() {
    return this.identities.map((i) => ({
      ...i,
      macs: [...i.macs],
      ssids: [...i.ssids],
    }));
  }
}
