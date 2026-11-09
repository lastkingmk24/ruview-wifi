/**
 * RuView Observatory — build script (zero dependencies).
 *
 * Validates the source tree, cleans `dist/`, copies the static site assets
 * into `dist/`, and writes a `build-info.json` manifest. Used by the GitHub
 * Pages workflow (`npm run build` → upload `dist/`).
 */

import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');

const REQUIRED_FILES = ['index.html', 'styles.css', 'main.js', 'observatory.js', 'ui.js'];

function fail(message) {
  console.error(`[build] FAIL: ${message}`);
  process.exit(1);
}

function main() {
  const cleanOnly = process.argv.includes('--clean-only');

  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(srcDir, file))) {
      fail(`missing required source file: src/${file}`);
    }
  }

  if (cleanOnly) {
    rmSync(distDir, { recursive: true, force: true });
    console.log('[build] dist/ removed');
    return;
  }

  // Clean & recreate
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  // Copy site assets
  const assets = readdirSync(srcDir).filter((f) => /\.(html|css|js)$/.test(f));
  for (const file of assets) {
    cpSync(join(srcDir, file), join(distDir, file));
  }

  // Manifest
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const manifest = {
    project: pkg.name,
    version: pkg.version,
    builtAt: new Date().toISOString(),
    node: process.version,
    assets,
  };
  writeFileSync(join(distDir, 'build-info.json'), JSON.stringify(manifest, null, 2));

  const total = assets.reduce((n, f) => n + readFileSync(join(distDir, f)).length, 0);
  console.log(`[build] OK — ${assets.length} assets → dist/ (${(total / 1024).toFixed(1)} KB)`);
  console.log(`[build] ${pkg.name} v${pkg.version} · ${manifest.builtAt}`);
}

main();
