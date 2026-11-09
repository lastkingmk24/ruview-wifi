#!/usr/bin/env node
/**
 * Live capture runner — Phase 1 device counting on a monitor-mode interface.
 *
 * USAGE (live, requires Linux host + monitor-mode NIC + root):
 *   node scripts/capture.mjs --iface wlan0mon --port 8181 [--zones zones.json]
 *
 * USAGE (replay a pcap produced by tcpdump):
 *   node scripts/capture.mjs --file capture.pcap --port 8181
 *
 * Puts the interface into monitor mode first (needs sudo):
 *   sudo ip link set wlan0 down && sudo iw dev wlan0 set type monitor && sudo ip link set wlan0 up
 *
 * Starts capturing with: tcpdump -i <iface> -w -  (pcap on stdout, streamed
 * through the pcap stream parser). Serves the operator API on the port.
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createAnonymizer } from '../acquisition/anonymize.js';
import { ProbeClusterer } from '../acquisition/clusterer.js';
import { DeviceCounter } from '../acquisition/counter.js';
import { createPipeline } from '../acquisition/pipeline.js';
import { createPcapStreamParser, readPcap } from '../acquisition/pcap.js';
import { createApiServer } from '../server/api.js';
import { AuditLog } from '../acquisition/audit.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = { iface: null, file: null, port: 8181, zones: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--iface') args.iface = argv[++i];
    else if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--zones') args.zones = argv[++i];
  }
  if (!args.iface && !args.file) {
    console.error('Usage: capture.mjs --iface <wlanX> [--port 8181] | --file <capture.pcap>');
    process.exit(2);
  }
  return args;
}

function loadZoneMap(path) {
  if (!path) return {};
  const abs = path.startsWith('/') ? path : join(root, path);
  return JSON.parse(readFileSync(abs, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv);
  const zoneMap = loadZoneMap(args.zones);
  const audit = new AuditLog(join(root, 'data', 'audit.jsonl'));

  const anonymizer = createAnonymizer();
  const clusterer = new ProbeClusterer({ windowMs: 120_000 });
  const counter = new DeviceCounter({ zoneMap, audit });
  const pipeline = createPipeline({ anonymizer, clusterer, counter });

  console.log(`[capture] pipeline ready — zones: ${Object.keys(zoneMap).length} mapped`);

  if (args.file) {
    // Replay mode — no hardware required
    const pcap = readFileSync(args.file);
    const { packets } = pipeline.ingestPcap(pcap);
    console.log(`[capture] replayed ${packets} packets from ${args.file}`);
  } else {
    // Live mode — stream tcpdump stdout
    console.log(`[capture] starting tcpdump on ${args.iface} (streaming pcap)…`);
    const tcpdump = spawn('tcpdump', ['-i', args.iface, '-w', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
    tcpdump.on('error', (err) => {
      console.error(`[capture] failed to start tcpdump: ${err.message}`);
      console.error('[capture] install tcpdump and run with sudo for monitor mode');
      process.exit(1);
    });
    const parser = createPcapStreamParser({
      onPacket: ({ tsMs, data }) => pipeline.ingestFrame(data, tsMs),
    });
    tcpdump.stdout.on('data', (chunk) => parser.push(chunk));
    tcpdump.on('exit', (code) => console.log(`[capture] tcpdump exited with code ${code}`));
  }

  const api = await createApiServer({ counter, pipeline, port: args.port, audit });
  console.log(`[capture] API → http://localhost:${api.port}/`);
  console.log(`[capture] devices → http://localhost:${api.port}/api/v1/devices`);
  console.log(`[capture] stats → http://localhost:${api.port}/api/v1/stats`);

  const shutdown = () => {
    console.log('[capture] shutting down…');
    pipeline && process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
