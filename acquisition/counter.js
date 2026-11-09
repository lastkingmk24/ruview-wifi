/**
 * Device counter — state machine over anonymized device identities.
 *
 * Maintains per-device records (first/last seen, probe/association activity,
 * zone attribution, heuristic confidence) and produces zone-level counts.
 * Emits audit events for every state change.
 *
 * Note on confidence: this is a documented heuristic (more probes, an
 * association, multi-SSID activity → higher confidence), NOT a calibrated
 * probability. P3 will replace it with calibrated estimates.
 */

export const DEVICE_STATUS = Object.freeze({
  ACTIVE: 'active',
  STALE: 'stale', // no activity within staleMs
});

function zoneForSsids(ssids, zoneMap) {
  const counts = new Map();
  for (const ssid of ssids) {
    const zone = zoneMap[ssid];
    if (zone) counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  if (counts.size === 0) return 'unknown';
  let best = null;
  let bestN = -1;
  for (const [zone, n] of counts) {
    if (n > bestN) { best = zone; bestN = n; }
  }
  return best;
}

export function confidenceFor(record) {
  // Heuristic confidence score, 0..1:
  //  - probes seen: +0.4 (1+), +0.2 (3+), +0.1 (5+) → up to +0.7
  //  - associated: +0.15
  //  - multi-SSID activity: +0.15
  let c = 0.2;
  if (record.probeCount >= 1) c += 0.4;
  if (record.probeCount >= 3) c += 0.2;
  if (record.probeCount >= 5) c += 0.1;
  if (record.assocSeen) c += 0.15;
  if (record.zones.size >= 2) c += 0.15;
  return Math.min(1, Math.round(c * 100) / 100);
}

export class DeviceCounter {
  constructor({
    zoneMap = {},
    staleMs = 5 * 60_000,
    ttlMs = 24 * 3600_000,
    audit = null,
  } = {}) {
    this.zoneMap = zoneMap;
    this.staleMs = staleMs;
    this.ttlMs = ttlMs;
    this.audit = audit;
    this.devices = new Map(); // identityId → record
    this.eventsProcessed = 0;
  }

  /**
   * Ingest one anonymized frame event.
   * event: FrameEvent with sa/bssid replaced by anonymized ids, plus
   * `identityId` from the clusterer.
   */
  ingest(event) {
    this.eventsProcessed += 1;
    let rec = this.devices.get(event.identityId);
    if (!rec) {
      rec = {
        id: event.identityId,
        firstSeenMs: event.tsMs,
        lastSeenMs: event.tsMs,
        probeCount: 0,
        assocSeen: false,
        authSeen: false,
        zones: new Map(),
        zone: 'unknown',
        ssids: new Set(),
      };
      this.devices.set(rec.id, rec);
      this._audit('device_seen', rec);
    }
    rec.lastSeenMs = event.tsMs;

    const subtype = event.subtype;
    if (subtype === 4) rec.probeCount += 1; // PROBE_REQ
    if (subtype === 0) rec.assocSeen = true; // ASSOC_REQ
    if (subtype === 0x0b) rec.authSeen = true; // AUTH

    for (const ssid of event.ssids ?? []) {
      rec.ssids.add(ssid);
      const zone = this.zoneMap[ssid];
      if (zone) rec.zones.set(zone, (rec.zones.get(zone) ?? 0) + 1);
    }
    if (rec.zones.size > 0) {
      rec.zone = [...rec.zones.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    rec.confidence = confidenceFor(rec);
    this._audit('device_updated', rec);
    return rec;
  }

  /** Recompute statuses (active/stale) against nowMs. */
  refreshStatuses(nowMs) {
    for (const rec of this.devices.values()) {
      rec.status = (nowMs - rec.lastSeenMs) > this.staleMs ? DEVICE_STATUS.STALE : DEVICE_STATUS.ACTIVE;
    }
  }

  /** Remove records older than TTL. */
  prune(nowMs) {
    let removed = 0;
    for (const [id, rec] of this.devices) {
      if (nowMs - rec.lastSeenMs > this.ttlMs) {
        this.devices.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** Produce the zone-level count report (no raw identifiers). */
  report(nowMs) {
    this.refreshStatuses(nowMs);
    this.prune(nowMs);
    const byZone = new Map();
    const devices = [];
    for (const rec of this.devices.values()) {
      if (rec.status === DEVICE_STATUS.ACTIVE) {
        byZone.set(rec.zone, (byZone.get(rec.zone) ?? 0) + 1);
      }
      devices.push({
        id: rec.id,
        zone: rec.zone,
        status: rec.status,
        confidence: rec.confidence,
        firstSeenMs: rec.firstSeenMs,
        lastSeenMs: rec.lastSeenMs,
        probeCount: rec.probeCount,
        assocSeen: rec.assocSeen,
        ssidCount: rec.ssids.size,
      });
    }
    return {
      generatedAtMs: nowMs,
      active: [...this.devices.values()].filter((r) => r.status === DEVICE_STATUS.ACTIVE).length,
      stale: [...this.devices.values()].filter((r) => r.status === DEVICE_STATUS.STALE).length,
      total: this.devices.size,
      byZone: Object.fromEntries([...byZone.entries()].sort((a, b) => b[1] - a[1])),
      devices,
    };
  }

  _audit(kind, rec) {
    if (!this.audit) return;
    this.audit.append({
      tsMs: rec.lastSeenMs,
      kind,
      deviceId: rec.id,
      zone: rec.zone,
      confidence: rec.confidence,
    });
  }
}
