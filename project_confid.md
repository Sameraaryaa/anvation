# AEGIS-Graph — Software Build Prompts for Antigravity
### Backend + Frontend (System A) · built to plug into the ESP32 console and UNO Q without changes

> **How to use this document**
> 1. Open one Antigravity workspace for the software repo.
> 2. Paste **Prompt 0 (Project rules)** first. It is the context every later prompt relies on.
> 3. Paste Prompts 1 → 11 **in order**. After each one, run its **Check** before moving on.
> 4. Sections 2–6 are the specification the prompts refer to. Prompts tell Antigravity to read them, so **put this whole file in the repo as `docs/SOFTWARE_SPEC.md`** before Prompt 1, plus `docs/API_CONTRACT.md` and the two scenario files.
>
> **The hardware is already built against Section 4 (Device API).** If the software follows it exactly, the ESP32 console and the UNO Q work the moment they join the hotspot. Never rename a path or field from Section 4.

---

## 1. Fixed decisions

| Area | Decision |
|---|---|
| Backend | Python 3.11, **FastAPI**, Uvicorn, **NetworkX ≥ 3.2**, pydantic v2 |
| Frontend | **React 18 + Vite + TypeScript + Tailwind CSS**, **Cytoscape.js** + `cytoscape-dagre` (left-to-right graph), `lucide-react` icons, `react-router-dom` |
| AI | **Gemini** via the **`google-genai`** SDK (`from google import genai`). Primary `gemini-3.8-flash`, fallbacks `gemini-3.7-flash` → `gemini-3.5-flash-lite`. Read-only tools only |
| Database | `DB_MODE=local` → **SQLite** file `aegis.db` (default, works offline) · `DB_MODE=cloud` → **Firestore** (`google-cloud-firestore`) |
| One port | FastAPI serves the API **and** the built frontend on **`0.0.0.0:8000`**. Judges open `http://<laptop-ip>:8000` |
| Dev | Vite on 5173 proxies `/api` → `http://localhost:8000` |
| Devices | `esp32-console-01` (approval console), `unoq-status-01` (status board) — they only call Section 4 endpoints |
| Approvals | A fix is applied **only** by `POST /api/approve` with an **enrolled badge**. The browser cannot approve unless `ALLOW_BROWSER_APPROVAL=1` (demo fallback, off by default) |
| Scope | Defensive tool. Reads **synthetic / exported** config files only. Never scans or connects to a real cloud |

### Environment (`backend/.env`)
```
DB_MODE=local                  # local | cloud
DEVICE_KEY=aegis-demo-key-change-me   # MUST equal DEVICE_KEY in the ESP32 config.h and UNO Q main.py
GEMINI_API_KEY=                # paid tier
AIR_GAPPED=0                   # 1 = no Gemini calls, template answers only
ALLOW_BROWSER_APPROVAL=0       # 1 = show "Simulate badge" on the Hardware page (demo fallback)
GCP_PROJECT=                   # only for DB_MODE=cloud
FIRESTORE_PREFIX=aegis
SEED_CARDS=04A1B2C3:Security Lead      # optional, comma-separated UID:Name pairs
```

### Repository layout
```
aegis-graph/
  backend/
    app/
      main.py            FastAPI app, routers, static frontend
      config.py          env settings
      models.py          pydantic models (scenario + API)
      engine/
        loader.py        load + validate scenario JSON
        graph.py         build NetworkX graph
        analysis.py      paths, dominators, choke point, blast radius, risk
        remediation.py   min-cut, smallest fix set, apply fix, before/after
      store/
        base.py          Repository interface
        sqlite_repo.py
        firestore_repo.py
        audit.py         hash-chain helpers
      api/
        device.py        Section 4 endpoints (hardware)
        dashboard.py     Section 5 endpoints (browser)
      sentinel.py        Gemini assistant (read-only, validated)
    scenarios/educloud.json, miniconfig.json
    tests/
    requirements.txt
  frontend/              Vite + React + TS + Tailwind
  tools/device_simulator.py, mock_aegis_server.py   (copy from the hardware folder)
  docs/SOFTWARE_SPEC.md (this file), API_CONTRACT.md
```

---

## 2. The numbers the demo must show (oracle)

Computed by the reference engine in Section 3.5 on the unmodified scenario files. Unit tests must assert these exactly.

| Scenario | Paths before → after | Risk before → after | Choke point | Smallest fix (min-cut) | Blast radius before → after |
|---|---|---|---|---|---|
| **educloud** | **3 → 0** | **88 → 12** | `role_overpriv` "Over-privileged Role" | `scope_passrole` (1 edge: `role_overpriv → role_admin`) | **7 nodes / 22 weighted → 4 / 4 (−82%)** |
| miniconfig | 1 → 0 | 79 → 4 | `role_lambda` "Lambda Role" | `scope_secrets` | 3 / 11 → 2 / 2 (−82%) |

EduCloud paths, ranked by risk:

| # | Path | Difficulty | Hops | Risk | Severity |
|---|---|---|---|---|---|
| 1 | internet → leaked_key → role_overpriv → role_admin → db_parent_portal | 5 | 4 | **88** | Critical |
| 2 | internet → web_app → role_overpriv → role_admin → db_parent_portal | 8 | 4 | 79 | High |
| 3 | internet → code_runner → role_overpriv → role_admin → db_parent_portal | 8 | 4 | 79 | High |

---

## 3. Analysis engine specification

### 3.1 Graph
- One directed graph per scenario. Node attributes = all JSON fields. Edge attributes = all JSON fields except `from`/`to` (JSON key `from` maps to pydantic field `from_` with `alias="from"`).
- `entry = entry_points[0]`, `jewel = crown_jewels[0]` (support lists, but the demo uses one each).

### 3.2 Paths
- `paths = all simple paths entry → jewel`, sorted by total edge `difficulty` ascending (ties: path string).
- Path **id** = 1-based index after sorting by **risk descending**, then difficulty ascending.

### 3.3 Dominators and choke point
- `idom = nx.immediate_dominators(G, entry)`. **Walk from the jewel to the entry like this** (NetworkX 3.5+ no longer puts the start node in `idom`, so a `while idom[n] != n` loop crashes):
  ```python
  doms, n = set(), jewel
  while n != entry:
      n = idom[n]
      if n != entry: doms.add(n)
  ```
- **Choke point** = the tail node of the min-cut edge (3.6) if it is a dominator; otherwise the dominator with the highest `nx.betweenness_centrality`. EduCloud → `role_overpriv`.

### 3.4 Risk and severity (exact)
For each path `p`:
```
D = sum(edge.difficulty for edges in p)
E = 1.0 if node[p[0]].exposed else 0.4          # exposure
X = 1 / (1 + 0.05 * D)                          # exploitability
I = node[jewel].value / 10   (default value 5)  # impact
C = 1.1 if p passes through any dominator (excluding entry and jewel) else 1.0
path_risk = round(100 * E * X * I * C)
```
- **Overall risk** = max path risk; if there are **no** paths: `min(30, 4 × number of direct successors of the entry node)` (residual exposure). EduCloud after the fix → 12.
- Severity: **Critical ≥ 85**, **High 70–84**, **Medium 40–69**, **Low < 40**.

### 3.5 Blast radius
- `reach = nx.descendants(G, entry)`; `blast_count = len(reach)`.
- `blast_weighted = Σ weight(n)` where `weight = node.value` if present, else **4** for a role with `privilege == "admin"`, else **1**.
- `blast_reduction_pct = round(100 × (before − after) / before)` on the weighted values.

### 3.6 Remediation optimisation
- Capacity graph: every edge capacity = **1** if `fixable` else **1000**. `nx.minimum_cut(H, entry, jewel)` → cut edges.
- Map cut edges to their `fix` ids → **recommended fixes**. If the cut contains a non-fixable edge (capacity ≥ 1000), fall back to **greedy hitting-set**: repeatedly remove the fixable edge that lies on the most remaining paths until no path remains. (General hitting-set is NP-hard. Say "greedy approximation" in comments and in the UI tooltip.)
- **Counterfactual**: copy the graph, delete every `removes_edges` pair of the recommended fixes, re-run 3.2–3.5 → `after`. Assert `after.path_count == 0`, else add the next greedy fix and repeat.

### 3.7 Reference implementation (port this logic; outputs must equal Section 2)
```python
import json, sys, networkx as nx
def build(sc):
    G = nx.DiGraph()
    for n in sc["nodes"]: G.add_node(n["id"], **n)
    for e in sc["edges"]: G.add_edge(e["from"], e["to"], **{k: v for k, v in e.items() if k not in ("from", "to")})
    return G
def weight(G, n):
    d = G.nodes[n]
    if "value" in d: return d["value"]
    if d.get("privilege") == "admin": return 4
    return 1
def analyze(sc, G):
    entry, jewel = sc["entry_points"][0], sc["crown_jewels"][0]
    paths = sorted(nx.all_simple_paths(G, entry, jewel), key=lambda p: sum(G[a][b]["difficulty"] for a, b in zip(p, p[1:])))
    doms = set()
    if paths:
        idom = nx.immediate_dominators(G, entry); n = jewel
        while n != entry:            # works whether or not idom contains the start node
            n = idom[n]
            if n != entry: doms.add(n)
    res = []
    for p in paths:
        diff = sum(G[a][b]["difficulty"] for a, b in zip(p, p[1:]))
        E = 1.0 if G.nodes[p[0]].get("exposed") else 0.4
        X = 1 / (1 + 0.05 * diff)
        I = G.nodes[jewel].get("value", 5) / 10
        C = 1.1 if doms & set(p[1:-1]) else 1.0
        res.append({"path": p, "difficulty": diff, "hops": len(p) - 1, "risk": round(100 * E * X * I * C)})
    reach = nx.descendants(G, entry)
    choke = None
    risk = max((r["risk"] for r in res), default=min(30, 4 * len(list(G.successors(entry)))))
    return {"path_count": len(paths), "paths": res, "risk": risk, "dominators": sorted(doms), "choke_point": choke,
            "blast_count": len(reach), "blast_weighted": sum(weight(G, n) for n in reach),
            "betweenness": {k: round(v, 3) for k, v in nx.betweenness_centrality(G).items() if v > 0}}
def mincut(sc, G):
    entry, jewel = sc["entry_points"][0], sc["crown_jewels"][0]
    H = nx.DiGraph()
    for a, b, d in G.edges(data=True): H.add_edge(a, b, capacity=1 if d.get("fixable") else 1000)
    val, (S, T) = nx.minimum_cut(H, entry, jewel)
    return val, [(a, b) for a, b in H.edges() if a in S and b in T]
for f in sys.argv[1:]:
    sc = json.load(open(f)); G = build(sc); before = analyze(sc, G); cut = mincut(sc, G)
    fix = [G[a][b]["fix"] for a, b in cut[1]]
    tails = [a for a, b in cut[1] if a in before["dominators"]]
    bc = nx.betweenness_centrality(G)
    before["choke_point"] = tails[0] if tails else (max(before["dominators"], key=lambda n: bc[n]) if before["dominators"] else None)
    H = G.copy()
    for fid in fix:
        for a, b in sc["remediations"][fid]["removes_edges"]: H.remove_edge(a, b)
    after = analyze(sc, H)
    red = round(100 * (before["blast_weighted"] - after["blast_weighted"]) / before["blast_weighted"])
    print(f"== {sc['scenario']}")
    for r in before["paths"]: print("   path", " -> ".join(r["path"]), "| difficulty", r["difficulty"], "| hops", r["hops"], "| risk", r["risk"])
    print("   dominators:", before["dominators"], " choke point:", before["choke_point"])
    print("   betweenness:", before["betweenness"])
    print("   min-cut value:", cut[0], "edges:", cut[1], "-> fix", fix)
    print(f"   paths {before['path_count']} -> {after['path_count']} | risk {before['risk']} -> {after['risk']} | blast {before['blast_count']} nodes ({before['blast_weighted']} weighted) -> {after['blast_count']} ({after['blast_weighted']}) = -{red}%")
```

---

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

## 6. Storage

### 6.1 SQLite (`DB_MODE=local`)
```sql
CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL DEFAULT 'idle',
  path_count INTEGER NOT NULL DEFAULT 0, risk INTEGER NOT NULL DEFAULT 0, scenario TEXT NOT NULL DEFAULT '',
  choke_point TEXT, pending_fix_json TEXT, analysis_json TEXT, seq INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS cards (card_id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'approver', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, device_type TEXT, fw TEXT, ip TEXT, rssi INTEGER, uptime_s INTEGER,
  components_json TEXT, remote_ip TEXT, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS commands (device_id TEXT PRIMARY KEY, command TEXT NOT NULL, queued_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS scans (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT, device_id TEXT, known INTEGER, name TEXT, context TEXT, ts INTEGER);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL, entry_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL, this_hash TEXT NOT NULL, ts INTEGER NOT NULL);
```
Use one connection with `check_same_thread=False` guarded by a `threading.Lock` (devices poll concurrently).

### 6.2 Firestore (`DB_MODE=cloud`)
`{prefix}_state/current` · `{prefix}_cards/{card_id}` · `{prefix}_devices/{device_id}` · `{prefix}_commands/{device_id}` · `{prefix}_scans/{auto}` · `{prefix}_audit/{000001…}`. Auth: `gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`. Use a transaction when appending to the audit chain.

### 6.3 Audit hash chain (must match the mock server)
```python
entry = {"event": ..., "ts": ..., **fields}
prev  = last.this_hash if any else "0" * 64
this_hash = sha256((prev + json.dumps(entry, sort_keys=True)).encode()).hexdigest()
```
`GET /api/audit` recomputes the chain and returns `chain_valid`.

---

## 7. Frontend specification

### 7.1 Look and feel — light, professional, cybersecurity (not dark, not "AI")
| Token | Value | Use |
|---|---|---|
| `bg` | `#F7F8FC` | page |
| `card` | `#FFFFFF` | panels, 1px border `#E2E8F0`, radius 14px, shadow `0 1px 3px rgba(15,23,42,.06)` |
| `ink` / `slate` / `mute` | `#12152B` / `#4F5775` / `#6B7280` | text |
| `violet` | `#7C3AED` | brand, primary buttons, path 1 |
| `blue` | `#2563EB` | path 2, info |
| `cyan` | `#0891B2` | path 3 |
| `red` / soft | `#DC2626` / `#FEE2E2` | danger, crown jewel, shared attack route, Critical |
| `amber` / soft | `#D97706` / `#FEF3C7` | choke point, High, warnings |
| `green` / soft | `#16A34A` / `#DCFCE7` | safe, approved, online |
Font: **Inter** (Google Fonts) 14px body, 600–800 for headings. No gradients, glows, neon or dark mode. Every number that matters is large and colour-coded.

### 7.2 App shell
- Top bar (white): shield logo + **AEGIS-Graph** · *Cloud Attack Path Analyzer*; nav: **Overview · Remediation · Hardware · Cards · Audit**; right: scenario select, **Run analysis** (violet), **Reset** (outline), and two **device pills**: `Console ●` and `UNO Q ●` (green = online, red = offline, from `/api/devices`; click → Hardware page).
- Global polling: `GET /api/status` every **2 s** (refetch `/api/analysis` when `seq` changes), `GET /api/devices` every **3 s**.
- Toasts: fix approved ("Approved by Security Lead via esp32-console-01"), badge denied ("Unknown badge DEADBEEF tapped on the console — enrol it?" with a link to Cards), device offline/online.

### 7.3 Overview page (the main demo screen)
Grid: graph (left, ~65%) | side panel (right, 380px) | bottom row.
- **Attack graph** (Cytoscape + dagre, `rankDir: 'LR'`): node shapes — internet = red-outlined ellipse "entry point"; compute/credential/role = round rectangles; data = round rectangle; **crown jewel** red border + "CROWN JEWEL" sub-label; **choke point** amber border + amber "CHOKE POINT" tag above it. Edge colours: an edge on exactly one path uses that path's colour (violet/blue/cyan); an edge on 2+ paths is **red** and thicker (shared route); non-path edges grey dashed (blast radius only). After approval: removed edge grey **dashed** with label "fixed", unreachable nodes at 35% opacity. Hover an edge → tooltip with technique id + difficulty.
- Side panel: **Risk score** (big number 0–100 + severity + bar) · **Blast radius** (nodes reachable) · **Smallest fix** card (amber): "1 fix breaks all 3 paths", fix title, and an approval status line:
  - pending → pulsing amber dot "Waiting for an authorised badge on the console (esp32-console-01)"; if the console is offline: red "Console offline — approval unavailable".
  - applied → green "Approved by <name> at <time>".
- **Attack paths** list: numbered chips in path colours, readable path, "difficulty · hops", severity badge.
- Bottom row: **Sentinel** panel (question box + answer, "grounded in graph" badge, mode `gemini`/`template`) and **Before / after** card: Paths 3 → 0 · Risk 88 → 12 · Blast radius −82%, plus timings (analysis ms; "approved Xs after analysis").
- Empty state (idle): illustration-free card "Run an analysis to map attack paths", with the scenario select.

### 7.4 Remediation page
For each recommended fix: title, detail, **IAM policy before/after** (side-by-side JSON, removed parts red, added parts green), **Terraform** block, **OPA/Rego** rule, "removes edge role_overpriv → role_admin", why it is the minimum (min-cut value 1, choke point). An approval timeline: Analysis run → Waiting for badge → Approved by … (from audit).

### 7.5 Hardware page (this is what makes the integration visible)
Two device cards, refreshed every 3 s:
- **ESP32-S3 Approval Console** (`esp32-console-01`): ONLINE/OFFLINE pill, last seen "3 s ago", IP, Wi-Fi RSSI bar, firmware, uptime; component rows from `components` (`tft`, `rfid`, `rfid_version`, `wifi`) with green/red dots; buttons **Identify** and **Self-test** (`POST /api/devices/{id}/command`) with "queued — device will react within 10 s"; a **mirror** of what the TFT is showing now, derived from `/api/status` + pending fix (same wording as the console: "3 ATTACK PATHS · RISK 88 · TAP BADGE TO APPROVE" / "SYSTEM SAFE" / "Waiting for analysis").
- **Arduino UNO Q Status Board** (`unoq-status-01`): same header fields; component rows (`led_matrix`, `rgb_leds`, `bridge`); buttons Identify / Self-test; a **live 8×13 LED-matrix mirror** (blue dots on navy) drawing the same patterns as the board (Section 7.7) and two LED dots for LED3/LED4 colours.
- If `ALLOW_BROWSER_APPROVAL=1`: an amber "Demo fallback" box with an enrolled-card dropdown and **Simulate badge tap** → `POST /api/dev/simulate_badge`.
- Collapsible **Wiring reference**: the pin tables from the hardware guide.
- If a device never sent a heartbeat: grey card "Not seen yet — check the hotspot, AEGIS_API_BASE and DEVICE_KEY".

### 7.6 Cards and Audit pages
- **Cards**: enrolled badges table (UID mono font, name, role, enrolled time, Remove). Above it **Recent badge scans** (from `/api/rfid/recent`, refresh 3 s): UID, device, known/unknown, context (`scan` / `approve` / `approve_denied`), time; unknown rows get an **Enrol** button → modal with name (default "Security Lead") → `POST /api/cards`.
- **Audit**: table of events (newest first) with event, who (approver / UID / device), fix, short hash; a header badge **"Hash chain valid ✓"** (green) or **"Chain broken"** (red).

### 7.7 UNO Q matrix mirror patterns (8 rows × 13 cols; same as `sketch.ino`)
- **unsafe**: X on columns 0–4 rows 1–5 (blinks 500 ms), path count as 3×5 digits (1 digit at col 8; 2 digits at cols 6 and 10), bottom row lit `round(risk×13/100)` cells.
- **safe**: tick at (r,c) = (3,3)(4,4)(5,5)(4,6)(3,7)(2,8)(1,9)(4,3)(5,4)(6,5)(5,6)(4,7)(3,8)(2,9).
- **idle**: a 2-pixel-tall dot bouncing across rows 3–4.
- **offline** (UNO Q offline): blinking "?" at col 5.
Digit font rows (3-bit, MSB = left): 0 `7,5,5,5,7` · 1 `2,6,2,2,7` · 2 `7,1,7,4,7` · 3 `7,1,7,1,7` · 4 `5,5,7,1,1` · 5 `7,4,7,1,7` · 6 `7,4,7,5,7` · 7 `7,1,2,2,2` · 8 `7,5,7,5,7` · 9 `7,5,7,1,7` · ? `7,1,3,0,2`.

---

## 8. Scenario files (put in `backend/scenarios/`, unchanged)

### 8.1 `educloud.json`
```json
{
  "scenario": "educloud",
  "display_name": "EduCloud (synthetic ed-tech stack)",
  "entry_points": ["internet"],
  "crown_jewels": ["db_parent_portal"],
  "nodes": [
    {"id": "internet",         "type": "internet",   "label": "Internet",             "exposed": true},
    {"id": "web_app",          "type": "compute",    "label": "Public Web App",       "public": true,  "misconfig": ["sg_open_world"]},
    {"id": "code_runner",      "type": "compute",    "label": "Code Runner",          "public": true,  "misconfig": ["weak_sandbox"]},
    {"id": "leaked_key",       "type": "credential", "label": "Leaked AI Key",        "misconfig": ["key_in_client_code"]},
    {"id": "role_overpriv",    "type": "role",       "label": "Over-privileged Role", "misconfig": ["passrole_wildcard"], "name_ref": "edu-app-role"},
    {"id": "role_admin",       "type": "role",       "label": "Admin Role",           "privilege": "admin"},
    {"id": "db_parent_portal", "type": "data",       "label": "Parent-Portal DB",     "sensitivity": "children_pii", "crown_jewel": true, "value": 10},
    {"id": "file_storage",     "type": "data",       "label": "File Storage",         "sensitivity": "uploads", "value": 4}
  ],
  "edges": [
    {"from": "internet",      "to": "web_app",          "type": "EXPOSED_TO_INTERNET", "technique": "T1190",     "difficulty": 2},
    {"from": "internet",      "to": "code_runner",      "type": "EXPOSED_TO_INTERNET", "technique": "T1190",     "difficulty": 2},
    {"from": "internet",      "to": "leaked_key",       "type": "EXPOSED_CREDENTIAL",  "technique": "T1552.001", "difficulty": 1},
    {"from": "web_app",       "to": "role_overpriv",    "type": "METADATA_ACCESS",     "technique": "T1552.005", "difficulty": 3},
    {"from": "code_runner",   "to": "role_overpriv",    "type": "SANDBOX_ESCAPE",      "technique": "T1611",     "difficulty": 3},
    {"from": "leaked_key",    "to": "role_overpriv",    "type": "VALID_CREDENTIAL",    "technique": "T1078.004", "difficulty": 1},
    {"from": "role_overpriv", "to": "role_admin",       "type": "CAN_PASS_ROLE",       "technique": "T1098.001", "difficulty": 2, "fixable": true, "fix": "scope_passrole"},
    {"from": "role_admin",    "to": "db_parent_portal", "type": "CAN_READ_DATA",       "technique": "T1530",     "difficulty": 1},
    {"from": "role_admin",    "to": "file_storage",     "type": "CAN_READ_DATA",       "technique": "T1530",     "difficulty": 1}
  ],
  "remediations": {
    "scope_passrole": {
      "title": "Scope the PassRole permission on edu-app-role",
      "detail": "Restrict iam:PassRole from '*' to a single approved role ARN.",
      "removes_edges": [["role_overpriv", "role_admin"]],
      "iam_before": {"Effect": "Allow", "Action": "iam:PassRole", "Resource": "*"},
      "iam_after":  {"Effect": "Allow", "Action": "iam:PassRole", "Resource": "arn:aws:iam::ACCOUNT:role/edu-worker-restricted"},
      "terraform_after": "resource \"aws_iam_role_policy\" \"edu_app\" { # PassRole scoped to edu-worker-restricted only }",
      "rego": "deny[msg] { input.Action == \"iam:PassRole\"; input.Resource == \"*\"; msg := \"PassRole must not use wildcard\" }"
    }
  }
}
```

### 8.2 `miniconfig.json`
```json
{
  "scenario": "miniconfig",
  "display_name": "MiniConfig (test)",
  "entry_points": ["internet"],
  "crown_jewels": ["secrets_store"],
  "nodes": [
    {"id": "internet",     "type": "internet", "label": "Internet", "exposed": true},
    {"id": "api_gw",       "type": "compute",  "label": "API Gateway", "public": true, "misconfig": ["sg_open_world"]},
    {"id": "role_lambda",  "type": "role",     "label": "Lambda Role", "misconfig": ["read_secrets_wildcard"]},
    {"id": "secrets_store","type": "data",     "label": "Secrets Store", "sensitivity": "secrets", "crown_jewel": true, "value": 9}
  ],
  "edges": [
    {"from": "internet",    "to": "api_gw",        "type": "EXPOSED_TO_INTERNET", "technique": "T1190",     "difficulty": 2},
    {"from": "api_gw",      "to": "role_lambda",   "type": "ASSUME_ROLE",         "technique": "T1078.004", "difficulty": 2},
    {"from": "role_lambda", "to": "secrets_store", "type": "CAN_READ_DATA",       "technique": "T1552.004", "difficulty": 1, "fixable": true, "fix": "scope_secrets"}
  ],
  "remediations": {
    "scope_secrets": {
      "title": "Scope secret-read permission on Lambda role",
      "detail": "Restrict secretsmanager:GetSecretValue from '*' to one secret ARN.",
      "removes_edges": [["role_lambda", "secrets_store"]],
      "iam_before": {"Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "*"},
      "iam_after":  {"Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT:secret:prod/app"}
    }
  }
}
```

---