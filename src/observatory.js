/**
 * RuView Observatory — deterministic WiFi sensing simulation engine.
 *
 * This module is pure logic (no DOM, no I/O) so it can be unit-tested in
 * Node and executed in the browser for the live observatory demo.
 *
 * The engine models the sensing output of a RuView-style CSI (Channel State
 * Information) mesh: presence/motion contacts, breathing & heart-rate vitals,
 * a 56-subcarrier RF spectrum, an ESP32 sensor-node mesh, and a tactical
 * sector map. All behaviour is driven by a seeded PRNG, so a given seed always
 * reproduces the same "mission" deterministically.
 */

export const SUBCARRIER_COUNT = 56;
export const SECTOR_ROWS = 6;
export const SECTOR_COLS = 8;
export const WORLD_TICK_MS = 200;
export const MAX_TELEMETRY = 180;
export const MAX_ALERT_HISTORY = 100;

export const LEVEL = Object.freeze({
  INFO: 'info',
  WARN: 'warn',
  CRITICAL: 'critical',
});

export const CONTACT_STATE = Object.freeze({
  MOVING: 'moving',
  DWELLING: 'dwelling',
});

export const NODE_STATUS = Object.freeze({
  ONLINE: 'online',
  DEGRADED: 'degraded',
  OFFLINE: 'offline',
});

/** Deterministic PRNG (mulberry32). Returns a function producing [0,1) floats. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sectorCenter(col, row) {
  return { x: col + 0.5, y: row + 0.5 };
}

/**
 * Build a patrol route: a list of waypoints on the sector grid.
 * The route visits a deterministic sequence of sectors and returns to start,
 * forming a closed loop so a contact never escapes the map.
 */
function makeRoute(rand) {
  const cols = SECTOR_COLS;
  const rows = SECTOR_ROWS;
  const steps = 4 + Math.floor(rand() * 4);
  const route = [];
  let col = 1 + Math.floor(rand() * (cols - 2));
  let row = 1 + Math.floor(rand() * (rows - 2));
  for (let i = 0; i < steps; i++) {
    route.push({ col, row });
    const dc = Math.floor(rand() * 3) - 1;
    const dr = Math.floor(rand() * 3) - 1;
    col = Math.min(cols - 2, Math.max(1, col + dc));
    row = Math.min(rows - 2, Math.max(1, row + dr));
  }
  route.push({ col: 1, row: 1 });
  return route;
}

function makeContact(rand, index) {
  const route = makeRoute(rand);
  const start = route[0];
  return {
    id: `C-${String(index + 1).padStart(2, '0')}`,
    trackId: `TRK-${String(index + 1).padStart(2, '0')}`,
    x: start.col,
    y: start.row,
    vx: 0,
    vy: 0,
    state: CONTACT_STATE.MOVING,
    confidence: 0.55 + rand() * 0.4,
    route,
    routeIndex: 0,
    dwellTicks: 0,
    dwellMax: 20 + Math.floor(rand() * 60),
    speed: 0.06 + rand() * 0.06,
    breathing: 12 + rand() * 8,
    heart: 58 + rand() * 32,
    trail: [],
  };
}

function makeNode(rand, index, col, row) {
  return {
    id: `ESP32-${String(index + 1).padStart(2, '0')}`,
    x: col + 0.5,
    y: row + 0.5,
    rssi: -45 - rand() * 35,
    battery: 75 + rand() * 25,
    uptime: Math.floor(rand() * 86400),
    packetRate: 60 + Math.floor(rand() * 180),
    status: NODE_STATUS.ONLINE,
  };
}

/**
 * Create a fresh, fully-deterministic world.
 *
 * Options (all optional):
 *  - seed: PRNG seed (number). Default: 0xC0FFEE.
 *  - contactCount: number of detected contacts. Default: 4.
 *  - nodeCount: number of mesh nodes. Default: 12.
 *  - interferenceRate: probability per tick of an RF interference burst.
 *  - nodeFailureRate: probability per tick of a node degrading or going offline.
 *  - nodeRecoveryRate: probability per tick of an offline node recovering.
 */
export function createWorld(options = {}) {
  const seed = options.seed ?? 0xc0ffee;
  const rand = mulberry32(seed);

  const sectors = [];
  for (let row = 0; row < SECTOR_ROWS; row++) {
    for (let col = 0; col < SECTOR_COLS; col++) {
      sectors.push({
        id: `${String.fromCharCode(65 + col)}${row + 1}`,
        col,
        row,
        occupancy: 0,
        motion: false,
      });
    }
  }

  const contacts = [];
  const contactCount = options.contactCount ?? 4;
  for (let i = 0; i < contactCount; i++) contacts.push(makeContact(rand, i));

  const nodes = [];
  const nodeCount = options.nodeCount ?? 12;
  for (let i = 0; i < nodeCount; i++) {
    const col = 1 + Math.floor(rand() * (SECTOR_COLS - 2));
    const row = 1 + Math.floor(rand() * (SECTOR_ROWS - 2));
    nodes.push(makeNode(rand, i, col, row));
  }

  const subcarriers = [];
  for (let i = 0; i < SUBCARRIER_COUNT; i++) {
    subcarriers.push({
      index: i,
      freq: 5.18 + (i / SUBCARRIER_COUNT) * 0.5, // GHz
      amplitude: 0.4 + rand() * 0.5,
      phase: rand() * Math.PI * 2,
    });
  }

  return {
    seed,
    time: 0,
    paused: false,
    speed: 1,
    sectors,
    contacts,
    nodes,
    subcarriers,
    interference: { active: false, remaining: 0, band: 0, width: 0 },
    telemetry: [],
    alerts: [],
    rngState: rand,
    nextAlertId: 1,
    // tunable rates (used by tests and by the UI's demo controls)
    interferenceRate: options.interferenceRate ?? 0.006,
    nodeFailureRate: options.nodeFailureRate ?? 0.002,
    nodeRecoveryRate: options.nodeRecoveryRate ?? 0.02,
    stats: { ticks: 0, detections: 0, alertsRaised: 0 },
  };
}

export function sectorAt(world, col, row) {
  return world.sectors.find((s) => s.col === col && s.row === row);
}

export function pushAlert(world, level, type, message, sectorId = null) {
  const alert = {
    id: world.nextAlertId++,
    t: world.time,
    level,
    type,
    message,
    sectorId,
  };
  world.alerts.push(alert);
  if (world.alerts.length > MAX_ALERT_HISTORY) world.alerts.shift();
  world.stats.alertsRaised++;
  return alert;
}

/** Detect interference burst on a random band. */
function applyInterference(world, rand) {
  if (world.interference.active) return;
  const band = Math.floor(rand() * SUBCARRIER_COUNT);
  const width = 3 + Math.floor(rand() * 8);
  world.interference = {
    active: true,
    remaining: 4 + Math.floor(rand() * 6),
    band,
    width,
  };
  for (let i = 0; i < SUBCARRIER_COUNT; i++) {
    if (Math.abs(i - band) < width) {
      world.subcarriers[i].amplitude = Math.min(1, world.subcarriers[i].amplitude + 0.35);
    }
  }
  const sector = world.sectors[Math.floor(rand() * world.sectors.length)];
  pushAlert(
    world,
    LEVEL.WARN,
    'RF_INTERFERENCE',
    `Interference burst detected on subcarriers ${band}–${band + width - 1}`,
    sector.id,
  );
}

function updateNode(node, world, rand) {
  node.battery -= 0.004;
  if (node.battery < 10) node.battery = 10;
  node.rssi += (rand() - 0.5) * 6;
  node.rssi = Math.max(-95, Math.min(-40, node.rssi));
  node.uptime += 1;
  node.packetRate = Math.max(10, Math.min(240, node.packetRate + Math.floor((rand() - 0.5) * 20)));

  if (node.status === NODE_STATUS.ONLINE && rand() < world.nodeFailureRate) {
    node.status = NODE_STATUS.DEGRADED;
    pushAlert(world, LEVEL.WARN, 'NODE_DEGRADED', `${node.id} signal quality degraded`, sectorIdForNode(world, node));
  } else if (node.status === NODE_STATUS.DEGRADED && rand() < world.nodeFailureRate) {
    node.status = NODE_STATUS.OFFLINE;
    pushAlert(world, LEVEL.CRITICAL, 'NODE_OFFLINE', `${node.id} lost — mesh rerouting`, sectorIdForNode(world, node));
  } else if (node.status === NODE_STATUS.OFFLINE && rand() < world.nodeRecoveryRate) {
    node.status = NODE_STATUS.ONLINE;
    pushAlert(world, LEVEL.INFO, 'NODE_RECOVERED', `${node.id} back online`, sectorIdForNode(world, node));
  }
}

function sectorIdForNode(world, node) {
  const col = Math.max(0, Math.min(SECTOR_COLS - 1, Math.floor(node.x)));
  const row = Math.max(0, Math.min(SECTOR_ROWS - 1, Math.floor(node.y)));
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

function updateContact(world, contact, rand) {
  const target = contact.route[contact.routeIndex];
  if (!target) return;
  const c = sectorCenter(target.col, target.row);

  if (contact.state === CONTACT_STATE.DWELLING) {
    contact.dwellTicks -= 1;
    // Vitals are best observable while the contact is dwelling.
    contact.breathing = clamp(contact.breathing + (rand() - 0.5) * 0.6, 10, 26);
    contact.heart = clamp(contact.heart + (rand() - 0.5) * 1.2, 45, 110);
    if (contact.dwellTicks <= 0) {
      contact.state = CONTACT_STATE.MOVING;
      contact.routeIndex = (contact.routeIndex + 1) % contact.route.length;
    }
  } else {
    const dx = c.x - contact.x;
    const dy = c.y - contact.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.05) {
      const step = Math.min(contact.speed, dist);
      contact.vx = (dx / dist) * step;
      contact.vy = (dy / dist) * step;
      contact.x += contact.vx;
      contact.y += contact.vy;
    } else {
      contact.state = CONTACT_STATE.DWELLING;
      contact.dwellTicks = contact.dwellMax;
      contact.vx = 0;
      contact.vy = 0;
    }
    contact.breathing = clamp(contact.breathing + (rand() - 0.5) * 0.8, 10, 26);
    contact.heart = clamp(contact.heart + (rand() - 0.5) * 1.6, 45, 110);
  }

  contact.confidence = clamp(contact.confidence + (rand() - 0.48) * 0.02, 0.4, 0.99);

  contact.trail.push({ x: contact.x, y: contact.y });
  if (contact.trail.length > 24) contact.trail.shift();
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Advance the world by dtMs of simulated time (or by one tick at
 * `speed` multiplier when paused=false). Mutates and returns the world.
 */
export function tick(world, dtMs = WORLD_TICK_MS) {
  if (world.paused) return world;

  const rand = world.rngState;
  world.time += dtMs * world.speed;
  world.stats.ticks += 1;

  // --- Contacts: move, dwell, vitals -------------------------------------
  for (const contact of world.contacts) updateContact(world, contact, rand);

  // --- Occupancy & motion per sector ------------------------------------
  for (const sector of world.sectors) {
    sector.occupancy = 0;
    sector.motion = false;
  }
  for (const contact of world.contacts) {
    const col = clamp(Math.floor(contact.x), 0, SECTOR_COLS - 1);
    const row = clamp(Math.floor(contact.y), 0, SECTOR_ROWS - 1);
    const sector = sectorAt(world, col, row);
    if (sector) {
      sector.occupancy += 1;
      if (contact.state === CONTACT_STATE.MOVING) sector.motion = true;
    }
  }

  // --- CSI spectrum ------------------------------------------------------
  const dominant = world.contacts.filter((c) => c.state === CONTACT_STATE.DWELLING)[0] ?? world.contacts[0];
  const breathPhase = dominant ? world.time / 1000 : 0;
  for (const sub of world.subcarriers) {
    const base = 0.45 + 0.3 * Math.abs(Math.sin(sub.index * 0.4 + world.time / 4000));
    const breath = dominant && sub.index > 10 && sub.index < 46
      ? 0.12 * Math.sin(breathPhase * dominant.breathing / 60 * Math.PI * 2)
      : 0;
    const noise = (rand() - 0.5) * 0.08;
    sub.amplitude = clamp(base + breath + noise, 0.05, 1);
    sub.phase += (rand() - 0.5) * 0.05;
  }

  // --- Interference -----------------------------------------------------
  if (world.interference.active) {
    world.interference.remaining -= 1;
    if (world.interference.remaining <= 0) world.interference.active = false;
  } else if (rand() < world.interferenceRate) {
    applyInterference(world, rand);
  }

  // --- Mesh nodes -------------------------------------------------------
  for (const node of world.nodes) updateNode(node, world, rand);

  // --- Telemetry history (for sparklines) --------------------------------
  const breathing = world.contacts.filter((c) => c.state === CONTACT_STATE.DWELLING)
    .map((c) => c.breathing)[0] ?? null;
  const heart = world.contacts.filter((c) => c.state === CONTACT_STATE.DWELLING)
    .map((c) => c.heart)[0] ?? null;
  const presence = world.contacts.filter((c) => c.confidence > 0.5).length;
  world.telemetry.push({
    t: world.time,
    breathing,
    heart,
    presence,
  });
  if (world.telemetry.length > MAX_TELEMETRY) world.telemetry.shift();

  // --- Alerts -----------------------------------------------------------
  const moving = world.contacts.filter((c) => c.state === CONTACT_STATE.MOVING);
  if (moving.length > 0) world.stats.detections += 1;

  return world;
}

/** Snapshot of the world for UI rendering / debugging (no live references). */
export function snapshot(world) {
  return {
    time: world.time,
    paused: world.paused,
    speed: world.speed,
    sectors: world.sectors.map((s) => ({ ...s })),
    contacts: world.contacts.map((c) => ({ ...c, trail: [...c.trail] })),
    nodes: world.nodes.map((n) => ({ ...n })),
    subcarriers: world.subcarriers.map((s) => ({ ...s })),
    interference: { ...world.interference },
    telemetry: [...world.telemetry],
    alerts: [...world.alerts],
    stats: { ...world.stats },
  };
}

/** Pause/resume the simulation. */
export function setPaused(world, paused) {
  world.paused = Boolean(paused);
  return world;
}

/** Set the simulation speed multiplier (1, 2, 4, 8 …). */
export function setSpeed(world, speed) {
  world.speed = Math.max(0.25, Number(speed) || 1);
  return world;
}
