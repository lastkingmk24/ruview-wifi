/**
 * Operator API — zero-dependency HTTP service for the device counter.
 *
 * Endpoints:
 *   GET  /health           — liveness
 *   GET  /api/v1/devices   — active/stale device records (anonymized ids only)
 *   GET  /api/v1/stats     — counts by zone + pipeline stats
 *   POST /api/v1/events    — ingest frame events
 *                            { events: [{ tsMs, sa, ssids, rates, oui, tagIds, subtype }] }
 *                            or { frames: [{ tsMs, data: <hex> }] }
 *
 * No raw MACs or SSIDs are ever returned. CORS is permissive because this is
 * a local operator tool; P5 will add RBAC and network isolation.
 */

import { createServer } from 'node:http';

export function createApiServer({ counter, pipeline, port = 8181, audit = null }) {
  let startTime = Date.now();

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }

    const sendJson = (code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...cors });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(200, { ok: true, uptimeMs: Date.now() - startTime });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/devices') {
      sendJson(200, counter.report(pipeline ? pipeline.stats().lastEventMs ?? Date.now() : Date.now()));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/v1/stats') {
      const report = counter.report(pipeline ? pipeline.stats().lastEventMs ?? Date.now() : Date.now());
      sendJson(200, {
        generatedAtMs: report.generatedAtMs,
        active: report.active,
        stale: report.stale,
        total: report.total,
        byZone: report.byZone,
        pipeline: pipeline ? pipeline.stats() : null,
        auditEntries: audit ? audit.size : 0,
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/events') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 4 * 1024 * 1024) {
          res.writeHead(413).end('payload too large');
          req.destroy();
        }
      });
      req.on('end', () => {
        let data;
        try {
          data = JSON.parse(body);
        } catch {
          sendJson(400, { error: 'invalid JSON' });
          return;
        }
        let accepted = 0;
        let rejected = 0;
        try {
          if (Array.isArray(data.frames)) {
            for (const f of data.frames) {
              const buf = Buffer.from(f.data, 'hex');
              const r = pipeline.ingestFrame(buf, f.tsMs);
              if (r.ok) accepted += 1; else rejected += 1;
            }
          } else if (Array.isArray(data.events)) {
            for (const ev of data.events) {
              const r = pipeline.ingestParsedEvent(ev);
              if (r.ok) accepted += 1; else rejected += 1;
            }
          } else {
            sendJson(400, { error: 'expected { events } or { frames }' });
            return;
          }
          sendJson(200, { accepted, rejected });
        } catch (e) {
          sendJson(500, { error: e.message });
        }
      });
      return;
    }

    sendJson(404, { error: 'not found' });
  });

  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      const actualPort = server.address().port;
      resolve({
        server,
        port: actualPort,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}
