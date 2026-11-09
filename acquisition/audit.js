/**
 * Append-only JSONL audit log for device-counting events.
 *
 * Minimal P1 implementation: append-only, one JSON object per line. P5 will
 * add retention enforcement, hashing/chaining and RBAC.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class AuditLog {
  constructor(path, { retentionMs = 7 * 24 * 3600_000 } = {}) {
    this.path = path;
    this.retentionMs = retentionMs;
    this.entries = [];
    if (existsSync(path)) {
      this._load();
    }
  }

  _load() {
    try {
      const content = readFileSync(this.path, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          this.entries.push(JSON.parse(trimmed));
        } catch { /* skip corrupt lines */ }
      }
    } catch { /* ignore */ }
  }

  append(entry) {
    this.entries.push(entry);
    if (this.entries.length > 100_000) {
      this._compact();
    }
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
  }

  _compact() {
    const now = this.entries.length ? this.entries[this.entries.length - 1].tsMs : 0;
    const kept = this.entries.filter((e) => (now - e.tsMs) < this.retentionMs);
    this.entries = kept;
    try {
      writeFileSync(this.path, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
    } catch { /* ignore */ }
  }

  get size() {
    return this.entries.length;
  }
}
