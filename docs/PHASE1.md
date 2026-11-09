# Phase 1 — Device Counting MVP (Probe/Association Metadata Only)

**Status: implemented, tested, synthetic baseline validated. Hardware validation pending.**

## What was built

| Module | Role |
|---|---|
| `acquisition/frames.js` | 802.11 management-frame parser: radiotap skip, MAC header, IE extraction (SSIDs, rates, OUI, tags) |
| `acquisition/pcap.js` | pcap reader/writer + live stream parser (linktype 127 radiotap, 105 cooked) |
| `acquisition/anonymize.js` | Salted HMAC-SHA256 MAC anonymization (non-reversible) |
| `acquisition/clusterer.js` | Randomization-aware device identity clustering (features + SSID overlap + time window) |
| `acquisition/counter.js` | Device state machine: zone attribution, heuristic confidence, staleness/TTL |
| `acquisition/pipeline.js` | Glue: parse → anonymize → cluster → count; AP-side frames dropped |
| `acquisition/mock-adapter.js` | Deterministic multiroom device world (rotation policies: none / per-SSID / per-probe; silent & offline devices) |
| `acquisition/evaluation.js` | Ground-truth matching + acceptance gates |
| `acquisition/audit.js` | Append-only JSONL audit log |
| `server/api.js` | Operator HTTP API (health, devices, stats, events) |
| `scripts/ground-truth.mjs` | Validation harness → markdown report |
| `scripts/capture.mjs` | Live capture runner (tcpdump stream) + pcap replay |

## Synthetic validation results (controlled baseline)

Run `npm run ground-truth`. Results for the default deterministic world
(20 devices, 10-minute window, mixed rotation policies):

| Metric | Value | Gate | Result |
|---|---|---|---|
| Recall (detectable devices) | 1.000 | ≥ 0.95 | PASS |
| Recall (all active) | 0.889 | reported (ceiling 0.89) | — |
| Split rate (overcount) | 0.0% | ≤ 10% | PASS |
| False merges (undercount) | 0 | 0 | PASS |
| Phantom identities | 0 | 0 | PASS |
| Zone MAE | 0.00 | ≤ 0.25 | PASS |

**These numbers validate the pipeline logic on synthetic data. They are NOT
real-world accuracy claims.** Real-world performance must be re-measured with
hardware captures (see "Hardware validation" below).

## Known limitations (documented, not hidden)

1. **Probe-request counting is a sample:** devices that never probe or associate
   in the window are invisible. Recall has a ceiling below 1.0 — the harness
   reports it honestly (silent devices).
2. **MAC randomization:** dedup is a heuristic. Two devices with identical
   feature sets probing the same SSID within the window can be wrongly merged
   (undercount); a device whose probes are sparse (> window) can be split
   (overcount). The 120 s window is a trade-off between these errors.
3. **AX200 note:** the AX200 host runs monitor-mode sniffing for probe
   metadata. It cannot provide CSI (Phase 2 uses ESP32-S3 CSI nodes).
4. **Zone attribution** comes from probed SSIDs mapped to zones — requires a
   zone map (`acquisition/zones.example.json`). Unmapped SSIDs → "unknown".
5. **Confidence is heuristic** (more probes/associations → higher confidence),
   not a calibrated probability. Phase 3 replaces it.
6. **Association-only devices** (associated, never probing) are counted via
   association events but cannot be zone-attributed beyond the AP SSID.

## Hardware validation procedure (before any operational use)

1. Run the compliance gate (docs/COMPLIANCE.md) — jurisdiction, authorization, IRB.
2. Set up a test area with **N known devices** (phones/laptops) and a known
   ground truth: who is present, in which zone.
3. Enable monitor mode and capture:
   ```bash
   sudo ip link set wlan0 down
   sudo iw dev wlan0 set type monitor
   sudo ip link set wlan0 up
   npm run capture -- --iface wlan0mon --port 8181 --zones acquisition/zones.example.json
   ```
4. Record the session: device count at intervals, actual presence changes.
5. Compare against ground truth; fill the real-world row in the report:
   precision/recall, randomization-dedup error, zone accuracy, by room/wall type.
6. Report results in `reports/` with the harness command used, device list
   (by anonymous id only), and environment (walls, interference).

## API

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness |
| `GET /api/v1/devices` | Active/stale devices (anonymized ids, zone, confidence) |
| `GET /api/v1/stats` | Counts by zone + pipeline stats + audit entry count |
| `POST /api/v1/events` | Ingest `{ frames: [{tsMs, data: hex}] }` or `{ events: [...] }` |

No raw MACs or SSIDs are returned by any endpoint.

## What comes next (Phase 2)

- ESP32-S3 CSI acquisition (ESP-IDF `wifi_csi_get_data`), cleaning/calibration,
  presence detection per zone. See docs/ROADMAP.md.

## Real vs. hype (Phase 1)

- **Reliable (synthetic):** device counting with randomization-aware dedup,
  zone attribution, audit trail — verified against ground truth.
- **Reliable (hardware, expected):** device counts in the tens, precision
  bounded by probe behavior and MAC-randomization rates (literature: 60–95%
  device identification accuracy in office environments; plan for ±10–20%
  error in dense areas).
- **Not achievable:** identity/identification, counting devices that transmit
  nothing, guaranteed accuracy in dense RF environments, through-wall device
  counting from a single vantage point.
