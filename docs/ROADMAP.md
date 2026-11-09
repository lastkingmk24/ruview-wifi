# Roadmap

This roadmap tracks turning the self-contained simulation demo into a fuller observatory interface. Order is roughly by dependency.

## v1.0 — shipped

- [x] Deterministic simulation engine (presence, motion, vitals, CSI, mesh, alerts)
- [x] Tactical map, CSI spectrum, vitals sparklines, mesh table, alert feed, console
- [x] Pause / speed / reset controls, UTC + IST clocks
- [x] 14 unit tests (`node --test`, zero dependencies)
- [x] Zero-dependency build + local preview server
- [x] GitHub Actions Pages deployment (build → test → deploy `dist/`)

## v1.1 — Phase 1: device counting MVP (implemented, synthetic baseline validated)

- [x] 802.11 management-frame parser (radiotap + IEs), pcap reader/writer/stream
- [x] Salted-HMAC MAC anonymization (no raw MACs persisted)
- [x] Randomization-aware probe clustering (features + SSID overlap + time window)
- [x] Device counter: zone attribution, heuristic confidence, staleness/TTL, audit log
- [x] Operator HTTP API (health / devices / stats / events)
- [x] Deterministic mock adapter + ground-truth harness (markdown validation report)
- [x] Live capture runner (tcpdump stream) + pcap replay
- [x] 30 new tests (44 total), all green
- [ ] Hardware validation (controlled room, known devices) — operator procedure in docs/PHASE1.md

## v1.1 — interface hardening

- [ ] Alert acknowledgement + filtering by level/type
- [ ] Contact list with per-contact vitals and dwell detail
- [ ] Keyboard shortcuts (space = pause, R = reset)
- [ ] Responsive breakpoint tuning for tablets
- [ ] Additive alert-rule engine (threshold-based custom alerts)

## v1.2 — live data adapters

- [ ] WebSocket/REST adapter: feed real CSI frames from an ESP32 mesh or RuView sensing server into the existing world shape
- [ ] Recording/replay: save a mission simulation and replay it deterministically
- [ ] Multi-environment profiles (rooms, terrain types, node layouts)

## v1.3 — analytics

- [ ] Occupancy heatmap history
- [ ] Vitals anomaly detection (apnea screening, distress flags)
- [ ] Dwell-time and motion-trend statistics per sector
- [ ] Export mission data as JSON/CSV for after-action review

## v2.0 — platform

- [ ] Distributed sensor mesh simulator (node failure, partition, rerouting visualization)
- [ ] Multi-contact correlation across overlapping node coverage
- [ ] WASM-based signal-processing pipeline (FFT, Hampel filter, STFT) for near-real-time demo mode
- [ ] Internationalization (locale strings)

## Principles

- Keep the engine pure and deterministic so tests stay meaningful.
- Keep the render layer stateless — live adapters must not touch it.
- No runtime dependencies unless a clear trade-off is justified.
- Deployment stays trivial: build `dist/`, upload, done.
