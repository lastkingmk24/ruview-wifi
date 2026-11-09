# Architecture

The RuView Observatory is a **self-contained static site**: no framework, no runtime dependencies, no backend. It is built and tested with Node 20+ (`node --test`, `node scripts/build.mjs`) and deployed as plain files to GitHub Pages.

## Layers

```
┌────────────────────────────────────────────────────────┐
│ src/index.html — layout shell (header, toolbar, panels)  │
├────────────────────────────────────────────────────────┤
│ src/main.js — bootstrap                                  │
│   · rAF loop: accumulates dt → engine ticks at 200 ms     │
│   · renders every frame; throttled DOM updates            │
│   · controls: pause/resume, speed, reset (re-seed)        │
│   · clocks: UTC + IST, console event log, heartbeat       │
├────────────────────────────────────────────────────────┤
│ src/ui.js — rendering layer (stateless)                  │
│   · drawMap / drawCsi / drawVitals → canvas               │
│   · updateMeshTable / updateAlerts / updatePills → DOM   │
├────────────────────────────────────────────────────────┤
│ src/observatory.js — simulation engine (pure logic)      │
│   · createWorld / tick / snapshot / setPaused / setSpeed │
│   · seeded PRNG (mulberry32) → fully deterministic        │
└────────────────────────────────────────────────────────┘
```

The engine has **no DOM and no I/O** — it runs identically in Node and the browser, which is why the test suite exercises exactly the code the UI uses.

## Simulation model

- **Sector map** — 6×8 grid (`SECTOR_ROWS × SECTOR_COLS`). Each cell has `occupancy` and `motion` flags.
- **Contacts** — each contact has a closed patrol route of waypoints. It moves toward the current waypoint (`moving`), dwells when reached (`dwelling`), then advances. Vitals (breathing 10–26 BPM, heart 45–110 BPM) jitter within physiological ranges and are best observed while dwelling. A 24-point trail tracks history.
- **CSI spectrum** — 56 subcarriers (5.18–5.70 GHz). Base amplitude is a deterministic waveform; a dwelling contact's breathing modulates the mid-band; interference bursts spike a random band and raise a WARN alert.
- **Mesh nodes** — 12 ESP32 CSI nodes with RSSI, battery drain, packet rate, and uptime. Status transitions (`online → degraded → offline → online`) raise alerts; rates are tunable knobs on `createWorld`.
- **Telemetry** — per-tick history (breathing, heart, presence) capped at `MAX_TELEMETRY = 180` for sparklines.
- **Determinism** — a single PRNG seed drives everything. `createWorld({ seed })` + N ticks is a pure function, which the tests rely on.

## Data flow (per frame)

1. `tick(world, dt)` advances contacts, sectors, spectrum, nodes, telemetry, alerts.
2. `render()` draws map/CSI/vitals canvases and refreshes DOM panels.
3. New alerts (by id) are appended to the console log.

## Extension points

- **Live data** — replace `tick()` with a real adapter that feeds actual CSI frames (e.g., from an ESP32 mesh or the RuView sensing server) into the same world shape; the render layer needs no changes.
- **New panels** — add a section to `index.html`, a draw function in `ui.js`, and wire it in `main.js`.
- **New contacts/nodes** — constructors in `observatory.js` accept `contactCount` / `nodeCount`.
- **Events** — `pushAlert(world, level, type, message, sectorId)` with `LEVEL.INFO | WARN | CRITICAL`.

## Testing

`tests/observatory.test.js` — 14 tests with `node:test`, no dependencies:

- determinism (same seed → identical ticks),
- bounds & state validity, physiological vital ranges,
- occupancy correctness, pause/speed semantics,
- spectrum ranges, interference alerting, node transitions,
- history caps, stat counters, snapshot isolation.

Run `npm test` locally; CI runs the same command on every push to `main`.
