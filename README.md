# RuView WiFi DensePose Sensing Observatory

A privacy-conscious, desktop-first observatory UI for RuView Wi-Fi sensing. It starts immediately in **Simulation** mode with deterministic, explicitly synthetic sample data. When a RuView sensing-server is available, switch to **Live backend** to view its actual CSI-derived REST/WebSocket output.

> **No-hardware mode is simulation, not sensing.** The moving pose, RF plots, presence, and vital-sign values shown by the local simulator are synthetic. They are visibly labelled as samples. Live mode never substitutes synthetic data when the backend is unavailable. The browser does not scan Wi-Fi directly: physical movement sensing needs RuView running with a supported CSI source (such as an ESP32-S3 node). Pose keypoints are optional; live presence/movement/RF data can still display without them.

## Quick start

Requirements: Node.js **20.19+ on the 20.x line** or **22.12+**, npm 10+, and a modern WebGL-capable browser for the 3D scene.

```bash
npm ci
npm run dev
```

Open **http://localhost:5173**. No Wi-Fi sensor, CSI adapter, Rust toolchain, or backend is needed for simulation mode.

Windows PowerShell uses the same commands:

```powershell
npm ci
npm run dev
```

To create a production build and serve it locally:

```bash
npm run build
npm run preview
```

The preview server also applies the same-origin backend proxy. For a static hosting deployment, simulation works; live mode needs an application server or reverse proxy that forwards `/health`, `/api/*`, and `/ws/*` to RuView.

## Deployment

The `Deploy observatory to GitHub Pages` workflow publishes the demo from the Arena session branch at **https://lastkingmk24.github.io/ruview-wifi/**. It runs typecheck/tests, builds with the repository base path, and deploys the static artifact. GitHub Pages is static hosting: the DEMO works there, but LIVE needs a separately hosted RuView backend and same-origin application proxy; Pages cannot proxy requests to a private Wi-Fi sensor or server.

## What is implemented

- **Interactive, full-screen 3D sensing field** with Three.js, orbit/zoom and auto-orbit controls, camera reset, spatial floor grid, wireframe/solid-room toggle, animated spherical RF visualizations, and valid multi-person pose rendering. Live skeletons are drawn only from backend-provided keypoints.
- **Deterministic local demo scenarios:** Multi-Person, Walk-through, Resting + vitals, and Quiet room. The two-person hero demo, signal values, and experimental vital samples are visibly labeled synthetic; pause/resume, scenario selection, measured FPS display, settings, sample chart, and session export are available.
- **Live RuView adapter:** same-origin HTTP health/snapshot requests, WebSocket stream, REST-polling alternative, bounded retry/backoff, malformed-packet validation, node selection, and diagnostics.
- **Signal telemetry:** RSSI, CSI amplitude, variance, signal quality, and uPlot history. Phase is shown only if present in the packet. The current upstream sensing broadcast includes amplitude but does not expose per-subcarrier phase, so live phase normally reads unavailable.
- **Presence, pose and vital panels:** backend-reported person counts and all valid reported person poses (no identity display), explicit unavailable states, confidence, provenance, and low-confidence pose suppression. The UI does not synthesize a pose from RSSI. Breathing/heart values are experimental estimates, never medical readings.
- **Events and controls:** connection/detection events, configurable local presence alert threshold, visualization toggles, source/node selection, exportable settings, explicit session-data download, sanitized diagnostics, and local buffer clearing. Clearing while in simulation pauses the local sample stream; clearing a connected live session disconnects this viewer before removing its in-memory buffer.
- **Privacy defaults:** no login, third-party analytics/telemetry, camera, face recognition, identity tracking, or browser-side persistent session storage. Simulation runs entirely in the browser. Live data is sent only to the RuView backend configured by the operator (which may be remote); review that backend's privacy/storage behavior. Live packets remain in this browser's memory unless the user explicitly downloads a session. Disconnecting the viewer does **not** stop capture in the upstream sensing-server; stop that server or the sensor to end capture.

## Architecture

```text
ESP32-S3 / other supported CSI adapter
       │  UDP CSI frames (upstream RuView server owns parsing and signal processing)
       ▼
RuView sensing-server (HTTP + WebSocket)
       │  /health, /api/v1/*, /ws/sensing
       ▼
Vite same-origin proxy ──► React + TypeScript observatory
                              ├── Simulation provider (deterministic sample data)
                              ├── Live RuView provider (REST/WS, retry, validation)
                              ├── RuView payload adapter (typed measurement handling)
                              ├── Three.js room / pose renderer
                              └── uPlot signal history
```

Sensing logic stays in the existing RuView backend. This repository is the observatory client and does not reimplement RuView CSI capture, DSP, pose inference, or vital-sign estimation. The initial checkout contained only a one-line README, so a new React/TypeScript UI was needed; the upstream wire contract was checked against the RuView source rather than guessed.

### Verified upstream contract

The reference repository was inspected at `monkky/ruview` commit `9a078e4ac85253ea63bb6b3874390e230c928609` (MIT-licensed repository; its v2 Rust crate declares MIT OR Apache-2.0). The current Rust sensing-server routes and `SensingUpdate` types are in `v2/crates/wifi-densepose-sensing-server/src/main.rs` and `src/types.rs`.

This client uses the server's current routes:

| Route | Use |
|---|---|
| `GET /health` | Health, selected source, tick and client count |
| `GET /api/v1/sensing/latest` | Initial/current `SensingUpdate` snapshot |
| `GET /api/v1/nodes` | Node status, RSSI and last-seen information |
| `GET /api/v1/pose/current` | Backend-produced `persons` / keypoints when available |
| `GET /api/v1/vital-signs` | Backend vital estimates, confidence and quality |
| `WS /ws/sensing` | Real-time JSON `sensing_update` broadcast |

The stream fields used by the adapter include `source`, `timestamp`, `tick`, `nodes` (`node_id`, `rssi_dbm`, `amplitude`, optional `phase`, `subcarrier_count`), `features` (`mean_rssi`, `variance`, motion/breathing bands), `classification` (`presence`, `confidence`, `motion_level`), optional `vital_signs`, `pose_keypoints`, and `persons`. Missing or invalid values stay unavailable instead of being rendered as zero.

The upstream server also has a separate WebSocket listener (default port 8765), but its HTTP listener exposes `/ws/sensing` too. The client uses that same-origin HTTP route, so the browser needs no cross-origin configuration. The Vite proxy forwards `/health`, `/api`, and `/ws` server-side to the backend.

**Pose limitation:** this UI only draws explicit backend keypoints that pass validation. The upstream server may return an experimental, feature-derived pose; that is still shown as *backend output*, not as ground truth. **Keypoints are optional:** live presence, movement classification, RSSI, and CSI telemetry can continue when the backend provides no pose. The pose panel then reports unavailable, and the 3D room shows no skeleton. The UI makes no pose estimate from RSSI by itself.

## Connect a RuView backend

Run the sensing-server from a checkout of the reference RuView project. It lives under `v2/`; the upstream repository includes the Rust workspace, ESP32-S3 firmware, and server documentation.

```bash
# In the upstream RuView checkout:
cd v2
cargo run -p wifi-densepose-sensing-server -- \
  --http-port 8080 \
  --ws-port 8765 \
  --udp-port 5005 \
  --bind-addr 0.0.0.0 \
  --source esp32
```

For a sensor-free upstream backend demonstration, use `--source simulate`. The observatory will identify the backend's `simulate` source as synthetic. Do not use `--source simulate` when presenting data as physical sensor output.

Configure the frontend proxy in this repository. The default is already `http://127.0.0.1:8080`; an explicit local configuration is:

```bash
cp .env.example .env.local
# Edit RUVIEW_BACKEND_URL if the backend is on a different reachable host/port.
npm run dev
```

PowerShell:

```powershell
Copy-Item .env.example .env.local
# Edit .env.local, then:
npm run dev
```

The frontend only requests relative paths such as `/health` and `/ws/sensing`; it does not hard-code a browser-side `localhost` backend URL. Set `RUVIEW_BACKEND_URL` in `.env.local` **before starting Vite**. If the backend is remote, the Vite process must be able to reach it. A hosted/static frontend cannot proxy to a private device on your laptop by itself.

In the UI, select **Live backend**, choose WebSocket or REST polling, and press **Connect to RuView**. Select `Backend aggregate` or a reported CSI node. A failed health check is reported in the System health panel and event stream; the provider retries a dropped WebSocket with exponential backoff. Selecting REST polling reads the same documented REST routes once per second.

## Compatible CSI hardware

This observatory does not unlock CSI from a normal laptop Wi-Fi card or ordinary consumer router. Full CSI requires a supported capture path, such as the upstream **ESP32-S3 CSI node** or a compatible research NIC. Laptop Wi-Fi scanning may provide RSSI-only signals on supported platforms; it is not equivalent to full CSI and does not provide CSI phase or subcarriers.

The upstream firmware documentation recommends an ESP32-S3 board and ESP-IDF 5.2. Follow its current provisioning/build guide; the essential flow is:

1. Build or use the upstream ESP32-S3 firmware release.
2. Flash an ESP32-S3 board using the firmware README's `esptool` offsets.
3. Join the ESP32-S3 to your **Wi-Fi network** using its SSID/password, then set the UDP target to the sensing-server machine's **IP address on that same Wi-Fi network** (port `5005`). Ethernet is not required; “LAN IP” means the local network address and can be the host's Wi-Fi address.
4. Start the sensing-server with `--source esp32` and allow inbound UDP/5005 on the host firewall.
5. Configure this UI proxy to the server's HTTP listener (default 8080), then connect in Live mode.

The upstream firmware README includes a Docker-based ESP-IDF 5.2 build command and this flash/provision pattern (replace `COM7`, SSID, password, and host IP with your values):

```bash
# From the upstream RuView repository root, build ESP32-S3 firmware:
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$(pwd)/firmware/esp32-csi-node:/project" -w /project \
  espressif/idf:v5.2 bash -c \
  "rm -rf build sdkconfig && idf.py set-target esp32s3 && idf.py build"

# Flash the generated files (example serial port COM7):
python -m esptool --chip esp32s3 --port COM7 --baud 460800 \
  write_flash --flash_mode dio --flash_size 8MB \
  0x0 firmware/esp32-csi-node/build/bootloader/bootloader.bin \
  0x8000 firmware/esp32-csi-node/build/partition_table/partition-table.bin \
  0x10000 firmware/esp32-csi-node/build/esp32-csi-node.bin

# Provision Wi-Fi and send CSI to the host running sensing-server:
python scripts/provision.py --port COM7 \
  --ssid "YourSSID" --password "YourPass" \
  --target-ip 192.168.1.20 --target-port 5005
```

For Linux, replace `COM7` with the serial device (for example `/dev/ttyUSB0`). Use a private Wi-Fi network you administer and obtain consent from people in the sensing area. For multiple nodes, the server can expose per-node status; placement coordinates are not provided by the current browser stream, so the room's endpoint geometry is labelled illustrative.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `RUVIEW_BACKEND_URL` | `http://127.0.0.1:8080` | Vite server-side proxy target; set in `.env.local` |
| Vite dev port | `5173` | Observatory UI |
| RuView HTTP port | `8080` | Upstream REST API and `/ws/sensing` |
| RuView WS port | `8765` | Optional/separate upstream WebSocket listener |
| RuView UDP port | `5005` | Upstream ESP32 CSI ingress; configured in the server and firmware |

No secrets are required by this UI. Do not commit `.env.local` or put Wi-Fi passwords in frontend configuration.

## Privacy and measurement limits

- Only use live sensing in an authorized, consent-based space. The UI is not a covert-monitoring tool.
- No identity tracking or facial recognition is implemented.
- This UI does not store session data persistently by default. Its chart/session buffer is in-memory and bounded; **Download session** explicitly exports recent frames, including measurement arrays where supplied. Review that file before sharing it. The upstream backend may store or log data according to its own configuration.
- The diagnostics download omits raw CSI arrays, pose keypoints and vital values.
- **Disconnect viewer** stops only this dashboard's connection. Stop the sensing-server or disable/power off the sensor to stop capture.
- Presence, motion, and pose are source-dependent estimates. Breathing/heart rates are experimental signal estimates only and are not medical diagnoses or a medical device.
- Simulation readings and poses are synthetic and never represent a real person or sensor.

## Development and tests

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Tests cover deterministic one-/two-person demo scenarios, multi-person pose parsing and schema validation, missing measurements, RuView REST endpoint mapping, backend failures and WebSocket reconnect behavior, malformed packets, plus dashboard mode/scenario/playback, measured-FPS/orbit/settings, alert-threshold, clear-session, and scene-toggle controls. The live-provider tests use fixtures shaped from the verified upstream Rust types/routes; they do not claim to run ESP32 hardware or a live upstream Rust server.

The 3D room and signal chart are lazy-loaded. The production build currently produces a 514.5 kB Three.js scene chunk (about 129.5 kB gzip), just above Vite's default 500 kB advisory threshold; the chunk is deferred until the scene loads. This is a non-blocking warning, not a build failure.

## Troubleshooting

- **Live shows offline / HTTP error:** confirm the upstream server responds at `http://127.0.0.1:8080/health`; set `RUVIEW_BACKEND_URL` in `.env.local` and restart Vite. Check that the proxy target is reachable from the Node/Vite process.
- **WebSocket reconnect loop:** check `/ws/sensing` on the upstream HTTP listener, confirm the backend is running, and check host firewall/proxy handling of WebSocket upgrades. REST polling can be selected as a diagnostic fallback.
- **No nodes / RSSI:** put the ESP32-S3 and sensing-server host on the same Wi-Fi network (no Ethernet cable is needed), provision the server host's Wi-Fi IP and UDP port 5005, disable wireless client isolation if enabled, allow inbound UDP/5005 through the host firewall, and start the backend with `--source esp32`.
- **No CSI amplitude or phase:** the current RuView broadcast supplies per-subcarrier amplitude when available but does not currently include phase. Missing fields remain unavailable; the UI cannot recover them.
- **No pose:** check the backend `persons`/`pose_keypoints` output and its confidence. RSSI alone is not converted into a skeleton here. A valid backend output is still experimental.
- **No vital values:** estimates may remain `null` until the pipeline has enough signal history/quality. The UI intentionally does not replace unavailable values with zeros or synthetic values in Live mode.
- **3D renderer unavailable:** enable WebGL/hardware acceleration in the browser or try a current Chrome, Edge, Firefox or Safari. Telemetry panels remain usable without WebGL.
- **`npm ci` engine error:** use Node.js 20.19+ within the 20.x line, or 22.12+.

## License

This observatory code is MIT licensed. The upstream RuView project and its Rust crate have their own license notices; consult those notices when building or redistributing the upstream backend or firmware.
