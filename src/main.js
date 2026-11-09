/**
 * RuView Observatory — bootstrap.
 *
 * Starts the deterministic simulation engine and renders it into the UI at
 * 60 fps. Controls: pause/resume, speed multiplier, reset (re-seeds the same
 * mission), and a live UTC/IST clock.
 */

import {
  createWorld,
  tick,
  setPaused,
  setSpeed,
  WORLD_TICK_MS,
  LEVEL,
} from './observatory.js';
import {
  drawMap,
  drawCsi,
  drawVitals,
  updateMeshTable,
  updateAlerts,
  updatePills,
  formatUptime,
  formatSimTime,
} from './ui.js';

const SEED = 0xc0ffee;

const refs = {
  clock: document.getElementById('clock'),
  clockLocal: document.getElementById('clock-local'),
  metaSeed: document.getElementById('meta-seed'),
  metaTick: document.getElementById('meta-tick'),
  metaUptime: document.getElementById('meta-uptime'),
  pillContacts: document.getElementById('pill-contacts'),
  pillMesh: document.getElementById('pill-mesh'),
  pillSpectrum: document.getElementById('pill-spectrum'),
  pillAlerts: document.getElementById('pill-alerts'),
  mapCanvas: document.getElementById('map-canvas'),
  csiCanvas: document.getElementById('csi-canvas'),
  vitalsCanvas: document.getElementById('vitals-canvas'),
  meshTbody: document.getElementById('mesh-tbody'),
  alertList: document.getElementById('alert-list'),
  consoleEl: document.getElementById('console'),
  btnPause: document.getElementById('btn-pause'),
  selSpeed: document.getElementById('sel-speed'),
  btnReset: document.getElementById('btn-reset'),
  alertsSub: document.getElementById('alerts-sub'),
  footerBuild: document.getElementById('footer-build'),
};

const mapCtx = refs.mapCanvas.getContext('2d');
const csiCtx = refs.csiCanvas.getContext('2d');
const vitalsCtx = refs.vitalsCanvas.getContext('2d');

let world = createWorld({ seed: SEED });
let lastRenderedAlertId = 0;

/* ---------- console logging ---------- */

function logLine(level, msg) {
  const now = new Date();
  const ts = now.toUTCString().slice(17, 25);
  const el = document.createElement('span');
  el.className = `line ${level}`;
  el.innerHTML = `<span class="ts">${ts}</span> <span class="msg"></span>`;
  el.querySelector('.msg').textContent = msg;
  refs.consoleEl.appendChild(el);
  refs.consoleEl.scrollTop = refs.consoleEl.scrollHeight;
  while (refs.consoleEl.childElementCount > 150) {
    refs.consoleEl.removeChild(refs.consoleEl.firstChild);
  }
}

function heartbeat() {
  logLine('system',
    `engine alive · ticks ${world.stats.ticks} · sim ${formatSimTime(world.time)} · contacts ${world.contacts.length}`);
}

/* ---------- render ---------- */

function render() {
  drawMap(mapCtx, world);
  drawCsi(csiCtx, world);
  drawVitals(vitalsCtx, world);
  updateMeshTable(refs.meshTbody, world);
  updateAlerts(refs.alertList, world);
  updatePills(refs, world);

  refs.metaTick.textContent = `TICK ${world.stats.ticks}`;
  refs.metaUptime.textContent = `UPTIME ${formatUptime(world.stats.ticks * (WORLD_TICK_MS / 1000))}`;
}

/* ---------- clock ---------- */

const IST_OFFSET_MINUTES = 330; // UTC+5:30, India Standard Time

function updateClocks() {
  const now = new Date();
  const utc = now.toUTCString().slice(17, 25);
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60000).toISOString().slice(11, 19);
  refs.clock.textContent = `${utc} UTC`;
  refs.clockLocal.textContent = `${ist} +05:30`;
}
setInterval(updateClocks, 1000);
updateClocks();

/* ---------- simulation loop ---------- */

let lastFrame = performance.now();
let accumulator = 0;

function frame(now) {
  const dt = Math.min(now - lastFrame, 1000);
  lastFrame = now;
  if (!world.paused) {
    accumulator += dt * world.speed;
    let guard = 0;
    while (accumulator >= WORLD_TICK_MS && guard < 64) {
      tick(world, WORLD_TICK_MS);
      accumulator -= WORLD_TICK_MS;
      guard += 1;
    }
  }

  // New alerts → console
  const newAlerts = world.alerts.slice(lastRenderedAlertId);
  if (newAlerts.length > 0) {
    for (const a of newAlerts) {
      logLine(a.level, `[${a.type}] ${a.message}`);
    }
    lastRenderedAlertId = world.alerts.length;
  }

  render();
  requestAnimationFrame(frame);
}

/* ---------- controls ---------- */

refs.btnPause.addEventListener('click', () => {
  setPaused(world, !world.paused);
  refs.btnPause.textContent = world.paused ? 'RESUME' : 'PAUSE';
});

refs.selSpeed.addEventListener('change', () => {
  setSpeed(world, Number(refs.selSpeed.value));
});

refs.btnReset.addEventListener('click', () => {
  world = createWorld({ seed: SEED });
  lastRenderedAlertId = 0;
  refs.consoleEl.innerHTML = '';
  logLine('system', `mission reset · seed 0x${SEED.toString(16).toUpperCase()} · ${world.contacts.length} contacts · ${world.nodes.length} mesh nodes`);
  logLine('info', 'CSI engine online · 56 subcarriers · simulation data only');
});

/* ---------- startup ---------- */

refs.metaSeed.textContent = `SEED 0x${SEED.toString(16).toUpperCase()}`;
refs.alertsSub.textContent = 'last 24';
refs.footerBuild.textContent = `build ${new Date().toISOString().slice(0, 10)} · v1.0.0 · simulation`;
logLine('system', 'RuView Observatory booting');
logLine('system', `mission reset · seed 0x${SEED.toString(16).toUpperCase()} · ${world.contacts.length} contacts · ${world.nodes.length} mesh nodes`);
logLine('info', 'CSI engine online · 56 subcarriers · simulation data only');
setInterval(heartbeat, 5000);
requestAnimationFrame(frame);
