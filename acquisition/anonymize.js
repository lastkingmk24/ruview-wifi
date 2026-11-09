/**
 * MAC anonymization — salted HMAC-SHA256, truncated to a stable device id.
 *
 * Raw MAC addresses are never persisted or returned by the pipeline. The salt
 * makes ids non-reversible; changing the salt rotates all ids (used when
 * policy requires re-keying).
 */

import { createHmac } from 'node:crypto';

export function createAnonymizer(salt = 'ruview-p1-salt') {
  const key = Buffer.from(salt, 'utf8');
  return {
    anonymizeMac(mac) {
      const normalized = mac.toLowerCase();
      const h = createHmac('sha256', key).update(normalized).digest('hex');
      return `dev_${h.slice(0, 16)}`;
    },
  };
}
