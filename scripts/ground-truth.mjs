#!/usr/bin/env node
/**
 * Phase 1 validation harness — synthetic baseline report.
 *
 * Generates a deterministic multiroom device world (mock adapter), runs the
 * full acquisition pipeline (parse → anonymize → cluster → count), evaluates
 * the estimate against ground truth, and writes a markdown validation report.
 *
 * USAGE:
 *   node scripts/ground-truth.mjs [--devices 20] [--seed 0xBEEF]
 *                                 [--duration 600000] [--out reports/...md]
 *
 * Exit code 1 if any acceptance gate fails (CI-friendly).
 *
 * NOTE: This is a SYNTHETIC controlled baseline. Real-world accuracy must be
 * re-measured against hardware captures before any operational use.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateWorld } from '../acquisition/mock-adapter.js';
import { createAnonymizer } from '../acquisition/anonymize.js';
import { ProbeClusterer } from '../acquisition/clusterer.js';
import { DeviceCounter } from '../acquisition/counter.js';
import { createPipeline } from '../acquisition/pipeline.js';
import { evaluate, zoneAccuracy, GATES } from '../acquisition/evaluation.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const args = { devices: 20, seed: 0xbeef, durationMs: 600_000, out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--devices') args.devices = Number(argv[++i]);
    else if (argv[i] === '--seed') args.seed = parseInt(argv[++i], 0);
    else if (argv[i] === '--duration') args.durationMs = Number(argv[++i]);
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const world = generateWorld({
    deviceCount: args.devices,
    seed: args.seed,
    durationMs: args.durationMs,
  });

  const anonymizer = createAnonymizer();
  const clusterer = new ProbeClusterer({ windowMs: 120_000 });
  const counter = new DeviceCounter({ zoneMap: world.zoneMap });
  const pipeline = createPipeline({ anonymizer, clusterer, counter });

  // Run the pipeline over the mock frames
  for (const f of world.frames) {
    pipeline.ingestFrame(f.data, f.tsMs);
  }

  const report = counter.report(world.durationMs);
  const metrics = evaluate(world, clusterer, counter, anonymizer);
  const zones = zoneAccuracy(world, report);

  const gates = [
    ...GATES.map(([name, check]) => [name, check(metrics)]),
    ['zone MAE <= 0.25', zones.zoneMAE <= 0.25],
  ];
  const allPass = gates.every(([, ok]) => ok);

  const lines = [
    '# Phase 1 Validation Report — Synthetic Baseline',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Seed: 0x${args.seed.toString(16)} | Devices: ${args.devices} (offline: ${world.groundTruth.offlineCount}, silent: ${world.groundTruth.silentCount}) | Duration: ${(args.durationMs / 1000).toFixed(0)}s`,
    '',
    '## Results',
    '',
    '| Metric | Value | Gate | Result |',
    '|---|---|---|---|',
    `| Recall (detectable devices) | ${metrics.recallDetectable.toFixed(3)} | >= 0.95 | ${metrics.recallDetectable >= 0.95 ? 'PASS' : 'FAIL'} |`,
    `| Recall (all active) | ${metrics.recallAllActive.toFixed(3)} | reported (ceiling = ${(world.groundTruth.devices.filter((d) => d.detectable).length / Math.max(1, world.groundTruth.activeCount)).toFixed(2)}) | — |`,
    `| Split rate (overcount) | ${(metrics.splitRate * 100).toFixed(1)}% | <= 10% | ${metrics.splitRate <= 0.10 ? 'PASS' : 'FAIL'} |`,
    `| False merges (undercount) | ${metrics.mergeCount} | 0 | ${metrics.mergeCount === 0 ? 'PASS' : 'FAIL'} |`,
    `| Phantom identities (FP) | ${metrics.phantomCount} | 0 | ${metrics.phantomCount === 0 ? 'PASS' : 'FAIL'} |`,
    `| Zone MAE | ${zones.zoneMAE.toFixed(2)} | <= 0.25 | ${zones.zoneMAE <= 0.25 ? 'PASS' : 'FAIL'} |`,
    '',
    `**Detectable devices: actual ${metrics.detectableActual} / estimated ${metrics.estimatedActive}** (of ${world.groundTruth.activeCount} present)`,
    '',
    '## Zone counts',
    '',
    '| Zone | Actual | Estimated |',
    '|---|---|---|',
    ...zones.rows.map((r) => `| ${r.zone} | ${r.actual} | ${r.estimated} |`),
    '',
    '## Pipeline stats',
    '',
    JSON.stringify(pipeline.stats(), null, 2),
    '',
    '## Notes',
    '',
    '- **Synthetic controlled simulation.** These numbers validate the pipeline logic; real-world accuracy must be re-measured on hardware.',
    '- Silent devices (present but transmitting nothing in the window) are undetectable by any passive method — recall (all active) has a ceiling below 1.0 by design.',
    '- Randomized-MAC dedup is evaluated against the mock known rotation policies (none / per-SSID / per-probe).',
    '',
  ];
  const markdown = lines.join('\n');
  console.log(markdown);

  const outPath = args.out ?? join(root, 'reports', `ground-truth-${Date.now()}.md`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown);
  console.log(`\nReport written: ${outPath}`);
  console.log(`Overall: ${allPass ? 'ALL GATES PASS' : 'GATES FAILED'}`);
  process.exit(allPass ? 0 : 1);
}

main();
