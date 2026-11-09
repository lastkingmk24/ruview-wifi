# Compliance & Governance — Phase 0 Gate

This document is the **governance gate for all sensing activity** in this
project. No live sensing may be performed until every item below is
confirmed. It is intentionally conservative: the goal is lawful, ethical,
human-supervised situational awareness, not surveillance.

## 1. Jurisdiction and legal basis

**Status: TO BE CONFIRMED BY THE OPERATOR.** The operator must confirm the
country/jurisdiction and obtain written authorization before any live sensing.

Checklist (fill in before first live use):

- [ ] Country/region identified (radio-frequency regulations + data protection law).
- [ ] Legal basis for passive RF monitoring in that jurisdiction (e.g., ISM-band
      passive reception is generally permitted, but verify locally: FCC Part 15
      (US), ETSI EN 300 328 / EN 301 893 (EU), WPC rules (India), etc.).
- [ ] Data protection law applicable (GDPR / DPDP Act 2023 / local equivalent)
      and privacy impact assessment (DPIA) completed.
- [ ] Organizational authorization: written approval from the responsible
      authority (defense/security organization, lab management, company
      leadership) defining scope, purpose, and authorized personnel.
- [ ] Written confirmation that this tool is used for **situational awareness
      research and training only** — not for targeting, identification, or
      automated decision-making against persons.

## 2. Human-subject ethics (IRB / ethics review)

Human subjects may be involved in controlled validation tests (people walking
through test areas). Before any such test:

- [ ] Ethics/IRB review of the test protocol (or documented exemption).
- [ ] Informed consent from all participants.
- [ ] Clear opt-out mechanism (anyone may leave the test area).
- [ ] No recording of identifying features — only RF metadata.
- [ ] Test dates/locations logged; data minimized to the minimum required.

## 3. Allowed data — metadata only

**The pipeline captures and retains ONLY the following 802.11 management-frame
metadata:**

- Frame type/subtype (probe request/response, beacon, association request/response, authentication).
- MAC addresses (anonymized immediately — see §4).
- SSID list (probed SSIDs — used for zone attribution; see §4 on SSID handling).
- Supported rates, vendor OUI, IE tag IDs (fingerprint features).
- Sequence numbers, timestamps.

**Explicitly NOT collected:**

- Any payload / LLC / upper-layer data (HTTP, DNS, credentials, etc.).
- Decrypted content of any kind.
- Any content of association/probe frames beyond the IE metadata above.

The acquisition pipeline is designed so that payload bytes are never parsed
or stored (see `acquisition/frames.js` — only management-frame IEs are
extracted; the data pipeline drops everything else).

## 4. Privacy safeguards

- **MAC anonymization:** raw MACs are replaced with salted HMAC-SHA256 ids
  (`acquisition/anonymize.js`) before any storage, clustering, or display.
  Raw MACs are never written to disk, logs, or API responses.
- **SSID handling:** SSIDs may be personal data. They are used for zone
  attribution and clustering. Aggregate reports should mask SSIDs where
  required by policy; the API currently does not return raw SSIDs.
- **Retention limits (configure before live use):**
  - Raw pcap capture files: **24 hours** (then delete).
  - Anonymized device records: **7 days** (then delete).
  - Audit log: **7 days**, append-only.
  - Ground-truth validation reports: retained per test protocol only.
- **Data minimization:** only fields needed for counting are retained.
- **Access control (P5):** the operator API will require RBAC (analyst /
  supervisor roles) and run on an isolated network.

## 5. RF interference and spectrum use

- **Passive reception only.** No transmission, no jamming, no spoofing, no
  deauthentication attacks, no rogue APs.
- Monitor-mode capture is passive listening; it does not interfere with
  networks. Channel selection should avoid active jamming/interference with
  critical systems (e.g., medical, aviation — 2.4/5 GHz ISM bands only).
- The capture interface must be put in monitor mode only on the authorized
  test interface.

## 6. Operator responsibilities

- Operate only within the authorized area and time window.
- Human-in-the-loop: **all zone estimates are reviewed before use.** No
  automated alerts trigger physical response.
- Maintain the audit trail (every device-count change is logged).
- Stop sensing immediately if anyone objects, if authorization lapses, or if
  the system malfunctions (safe-stop: kill the capture process).
- Treat all output as probabilistic metadata. Device counts are estimates;
  human presence is a statistical inference. Neither identifies persons.

## 7. Emergency stop

Killing the capture process (`scripts/capture.mjs`) stops sensing and the API.
No data is transmitted externally; the only network output is the local API.

---

*This document must be reviewed and signed off before Phase 1 hardware
validation. Adapt it to your organization's legal and ethics requirements.*
