# AEGIS-Graph API Contract

## 4. Device API — what the hardware calls (DO NOT CHANGE)

**This is the single source of truth between the software (laptop) and the hardware (ESP32 console + UNO Q).**
The hardware firmware, the mock server (`tools/mock_aegis_server.py`) and the device simulator (`tools/device_simulator.py`) already implement exactly this. The real software must implement it **byte-for-byte**: same paths, same field names, same status codes.

## General rules

| Rule | Value |
|---|---|
| Transport | Plain HTTP + JSON, UTF-8, `Content-Type: application/json` |
| Server bind | `0.0.0.0:8000` (must be reachable from the hotspot, not only localhost) |
| Base URL on devices | `http://<laptop-ip>:8000` (no trailing slash) |
| Device auth header | `X-Device-Key: <DEVICE_KEY>` — **required** on every `POST` device endpoint, wrong/missing → `401 {"error":"bad_device_key"}` |
| Device id header | `X-Device-Id: <device_id>` — informational, always sent |
| Read endpoints | `GET /api/health`, `/api/status`, `/api/pending_fix` need **no** key (devices send it anyway; the dashboard may call them too) |
| Polling | Devices call `GET /api/status` every **2 s** and `POST /api/device/heartbeat` every **10 s** |
| Timeouts | Devices give up after **3 s** — every endpoint must answer in well under 1 s |
| CORS | Allow the dashboard origin(s) and headers `Content-Type, X-Device-Key, X-Device-Id` |
| Card IDs | RFID UID as **uppercase hex, no separators**, e.g. `04A1B2C3` (4-byte) or `04A1B2C3D4E5F6` (7-byte). Server normalises: uppercase, strip `:` and spaces |
| Text shown on the TFT | `title`, `detail`, `approver`, `name` must be **plain ASCII** (the display fonts have no emoji / arrows / accents). Keep `title` ≤ 60 chars, `detail` ≤ 90 chars |
| Device ids | `esp32-console-01` (type `esp32_console`), `unoq-status-01` (type `unoq_status`) |

---

## 1. `GET /api/health`
```json
200 {"ok": true, "ts": 1791452002, "service": "aegis", "version": "1.0"}
```

## 2. `GET /api/status`
```json
200 {
  "state": "unsafe",              // "idle" | "unsafe" | "safe"
  "path_count": 3,                // open attack paths to crown jewels (0..99)
  "risk": 88,                     // overall risk 0..100
  "scenario": "educloud",         // "" when no analysis has run
  "choke_point": "Over-privileged Role",   // string or null
  "pending_fix": true,            // true when a fix is waiting for badge approval
  "seq": 7,                       // increments on EVERY state change (devices use it to refetch)
  "updated_at": 1791452002
}
```
State meanings: `idle` = no analysis yet · `unsafe` = paths exist (path_count > 0) · `safe` = path_count is 0 after a fix.

## 3. `GET /api/pending_fix`
No fix waiting:
```json
200 {"fix_id": null}
```
Fix waiting:
```json
200 {
  "fix_id": "scope_passrole",
  "title": "Scope the PassRole permission on edu-app-role",
  "detail": "Restrict iam:PassRole from '*' to a single approved role ARN.",
  "risk_before": 88, "risk_after": 12,
  "paths_before": 3, "paths_after": 0
}
```

## 4. `POST /api/approve`  *(X-Device-Key required)*
Sent by the ESP32 when a badge is tapped **while a fix is pending**.
```json
request  {"fix_id": "scope_passrole", "card_id": "04A1B2C3", "device_id": "esp32-console-01"}
```
| Case | Status | Body |
|---|---|---|
| Known card, fix matches → **fix applied** | 200 | `{"applied": true, "approver": "Security Lead", "fix_id": "scope_passrole", "state": "safe", "path_count": 0, "risk": 12}` |
| Missing `fix_id` or `card_id` | 400 | `{"applied": false, "reason": "card_id_and_fix_id_required"}` |
| Wrong / missing device key | 401 | `{"error": "bad_device_key"}` |
| Card not enrolled | 403 | `{"applied": false, "reason": "unknown_card", "card_id": "DEADBEEF"}` |
| No fix pending | 409 | `{"applied": false, "reason": "no_pending_fix"}` |
| Different fix pending | 409 | `{"applied": false, "reason": "fix_mismatch", "pending_fix_id": "..."}` |

Server side effects on **200**: apply the fix in the model, re-run the analysis, set `state`/`path_count`/`risk`, clear the pending fix, `seq += 1`, append audit entry `fix_applied` (approver, card_id, fix_id, device_id, paths/risk before→after, ts) to the hash-chained audit log.
On **403**: append audit entry `approve_denied` and record the scan in "recent scans".

## 5. `POST /api/rfid/scan`  *(X-Device-Key required)*
Sent by the ESP32 when a badge is tapped and **nothing is pending** (used to identify / enrol badges).
```json
request  {"card_id": "04A1B2C3", "device_id": "esp32-console-01"}
response 200 {"known": true, "name": "Security Lead", "card_id": "04A1B2C3"}
response 200 {"known": false, "name": null, "card_id": "DEADBEEF"}
```
Server side effect: add to "recent scans" (newest first, keep 20) so the dashboard can show an **Enrol** button.

## 6. `POST /api/device/heartbeat`  *(X-Device-Key required)*
```json
request {
  "device_id": "esp32-console-01",
  "device_type": "esp32_console",          // or "unoq_status"
  "fw": "1.0.0",
  "ip": "192.168.43.57",
  "rssi": -52,                              // null on the UNO Q
  "uptime_s": 1234,
  "components": {"tft": "ok", "rfid": "ok", "rfid_version": "0x92", "wifi": "ok"}
}
response 200 {"ok": true, "command": "none", "server_time": 1791452002}
```
- UNO Q `components`: `{"led_matrix": "ok", "rgb_leds": "ok", "bridge": "ok"}`.
- `command` is `"none"`, `"identify"` (flash the device so you can find it) or `"self_test"` (re-test parts). A queued command is delivered **once**, on the next heartbeat (≤ 10 s), then cleared.
- A device is **online** if its last heartbeat was ≤ **25 s** ago.

---

## Reference flow (what judges will see)

```
dashboard "Run analysis" ──► server: state=unsafe, path_count=3, risk=88, pending fix, seq++
UNO Q   (2 s poll)        ──► GET /api/status          → matrix: X + "3" + risk bar, LEDs red
ESP32   (2 s poll)        ──► GET /api/status + /api/pending_fix → TFT shows the fix, "TAP BADGE"
badge tap (enrolled)      ──► POST /api/approve        → 200, TFT "FIX APPROVED by Security Lead"
server                    ──► state=safe, path_count=0, risk=12, audit entry, seq++
UNO Q   (next poll)       ──► matrix tick, LEDs green ; dashboard shows paths 3 → 0
```

**Implementation notes for the backend**
- Device `POST` endpoints check `X-Device-Key == settings.DEVICE_KEY` **before** reading the body → `401 {"error": "bad_device_key"}`.
- `GET /api/status` must be cheap: read cached state from the repository, never re-run the analysis.
- `seq` must increase on: analyze, approve (success), reset, and when a pending fix changes.
- On a successful approve: run the counterfactual, store `applied = true` and the `after` numbers in the stored analysis, set `state = "safe"` if `after.path_count == 0`.
- Device `last_seen` is updated by heartbeats only. **online = now − last_seen ≤ 25 s.**
- The reference behaviour is `tools/mock_aegis_server.py`. The real server must give the same status codes and JSON for the same requests.

---

## 5. Dashboard API — what the browser calls

| Method & path | Request | Response |
|---|---|---|
| `POST /api/analyze` | `{"scenario": "educloud"}` | full **Analysis** (5.1). Side effects: state `unsafe` (or `safe` if 0 paths), pending fix = first recommended fix with its before/after numbers, `seq += 1`, audit `analysis_run` |
| `GET /api/analysis` | — | latest **Analysis**, or `404 {"error": "no_analysis"}` |
| `GET /api/scenarios` | — | `[{"id": "educloud", "display_name": "..."}, ...]` (files in `scenarios/`) |
| `POST /api/reset` | — | `{"ok": true}`; state `idle`, pending fix cleared, analysis cleared, `seq += 1` (cards and audit kept) |
| `GET /api/devices` | — | `[{"device_id", "device_type", "fw", "ip", "rssi", "uptime_s", "components", "last_seen", "age_s", "online"}]` |
| `POST /api/devices/{device_id}/command` | `{"command": "identify" \| "self_test"}` | `{"ok": true, "queued": "identify", "note": "delivered on next heartbeat (<=10 s)"}`; `400` for other commands |
| `GET /api/cards` | — | `[{"card_id", "name", "role", "created_at"}]` |
| `POST /api/cards` | `{"card_id", "name", "role": "approver"}` | `{"ok": true}`; normalise UID (uppercase, strip `:` and spaces); audit `card_enrolled` |
| `DELETE /api/cards/{card_id}` | — | `{"ok": true}`; audit `card_removed` |
| `GET /api/rfid/recent` | — | last 20 scans `[{"card_id", "device_id", "known", "name", "context", "ts"}]` newest first |
| `GET /api/audit` | — | `{"entries": [...newest first...], "chain_valid": true}` |
| `POST /api/ask` | `{"question": "..."}` | `{"answer", "mode": "gemini" \| "template", "model", "grounded": true, "cited": ["role_overpriv", ...]}` |
| `GET /api/config` | — | `{"allow_browser_approval": false, "air_gapped": false, "db_mode": "local"}` |
| `POST /api/dev/simulate_badge` | `{"card_id"}` | only if `ALLOW_BROWSER_APPROVAL=1` (else `403`); runs the **same** approve logic with `device_id = "browser-sim"`; audit shows `browser-sim` |

### 5.1 Analysis object
```json
{
  "scenario": "educloud", "display_name": "EduCloud (synthetic ed-tech stack)",
  "applied": false,
  "nodes": [{"id": "role_overpriv", "label": "Over-privileged Role", "type": "role",
             "entry": false, "crown_jewel": false, "choke": true, "dominator": true,
             "on_path": true, "reachable": true, "misconfig": ["passrole_wildcard"]}],
  "edges": [{"id": "role_overpriv->role_admin", "source": "role_overpriv", "target": "role_admin",
             "type": "CAN_PASS_ROLE", "technique": "T1098.001", "difficulty": 2,
             "fixable": true, "fix": "scope_passrole", "paths": [1, 2, 3], "removed": false}],
  "paths": [{"id": 1, "nodes": ["internet", "leaked_key", "role_overpriv", "role_admin", "db_parent_portal"],
             "hops": 4, "difficulty": 5, "risk": 88, "severity": "Critical"}],
  "choke_point": {"id": "role_overpriv", "label": "Over-privileged Role"},
  "dominators": ["role_admin", "role_overpriv"],
  "recommended_fixes": [{"fix_id": "scope_passrole", "title": "...", "detail": "...",
                         "iam_before": {}, "iam_after": {}, "terraform_after": "...", "rego": "...",
                         "removes_edges": [["role_overpriv", "role_admin"]]}],
  "before": {"path_count": 3, "risk": 88, "blast_count": 7, "blast_weighted": 22},
  "after":  {"path_count": 0, "risk": 12, "blast_count": 4, "blast_weighted": 4},
  "blast_reduction_pct": 82,
  "timings": {"analysis_ms": 12}
}
```
After approval: `"applied": true`, the removed edges carry `"removed": true`, every node gets `reachable` from the **after** graph, and `paths` become `[]` (keep the old paths in `"paths_before"` for the UI).

---

