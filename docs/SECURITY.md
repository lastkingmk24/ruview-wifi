# Security & Authorized Use

## Scope

The RuView Observatory is a **self-contained simulation demo**. It contains:

- no live sensing and no access to real WiFi/CSI signals;
- no real persons, locations, or tracking data — every marker on the map is synthetic;
- no backend, no telemetry, no network calls — it runs entirely in the browser;
- no cameras, no radar, no geolocation of real devices.

## Intended use

Demonstration, training, and interface prototyping for **situational-awareness dashboards** built on WiFi sensing concepts, in **authorized environments** only. The simulation engine is a development stand-in for the real sensing stack (ESP32 CSI nodes + RuView signal processing).

## Responsible use

- Do not deploy this demo to misrepresent real sensing capability. The UI always displays a **SIMULATION · DEMO MODE** badge and footer disclaimer.
- Do not modify the demo to accept or display real sensing data without appropriate authorization, privacy review, and compliance with applicable law.
- WiFi sensing technology is dual-use. Real deployments involving monitoring of persons or spaces require legal authority, informed consent where applicable, and adherence to applicable privacy, data-protection, and signals-intelligence regulations.
- Treat this repository as a reference interface, not an operational tool.

## Reporting issues

Open an issue or contact the maintainer. There is no live-data path to compromise — issues should concern the demo's simulation or the deployment pipeline.
