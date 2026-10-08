import sqlite3
import json
import time
import threading
from typing import Dict, Any, List, Optional
from pathlib import Path
from app.store.base import Repository, normalize_uid
from app.store.audit import compute_audit_hash, verify_audit_chain

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL DEFAULT 'idle',
  path_count INTEGER NOT NULL DEFAULT 0,
  risk INTEGER NOT NULL DEFAULT 0,
  scenario TEXT NOT NULL DEFAULT '',
  choke_point TEXT,
  pending_fix_json TEXT,
  analysis_json TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cards (
  card_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'approver',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  device_type TEXT,
  fw TEXT,
  ip TEXT,
  rssi INTEGER,
  uptime_s INTEGER,
  components_json TEXT,
  remote_ip TEXT,
  last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS commands (
  device_id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  queued_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT,
  device_id TEXT,
  known INTEGER,
  name TEXT,
  context TEXT,
  ts INTEGER
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  this_hash TEXT NOT NULL,
  ts INTEGER NOT NULL
);
"""

class SQLiteRepository(Repository):
    def __init__(self, db_path: str = "aegis.db", seed_cards: str = ""):
        self.db_path = str(db_path)
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._init_db(seed_cards)

    def close(self):
        with self.lock:
            self.conn.close()

    def _init_db(self, seed_cards: str):
        with self.lock:
            cur = self.conn.cursor()
            cur.executescript(SCHEMA_SQL)
            # Ensure single state row exists
            cur.execute("SELECT id FROM state WHERE id = 1")
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO state (id, state, path_count, risk, scenario, choke_point, pending_fix_json, analysis_json, seq, updated_at) "
                    "VALUES (1, 'idle', 0, 0, '', NULL, NULL, NULL, 0, ?)",
                    (int(time.time()),)
                )
            self.conn.commit()

            # Seed cards if provided
            if seed_cards:
                now = int(time.time())
                for pair in seed_cards.split(","):
                    pair = pair.strip()
                    if ":" in pair:
                        raw_uid, name = pair.split(":", 1)
                        uid = normalize_uid(raw_uid)
                        if uid:
                            cur.execute(
                                "INSERT OR IGNORE INTO cards (card_id, name, role, created_at) VALUES (?, ?, 'approver', ?)",
                                (uid, name.strip(), now)
                            )
                self.conn.commit()

    def get_state(self) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT state, path_count, risk, scenario, choke_point, pending_fix_json, seq, updated_at FROM state WHERE id = 1")
            row = cur.fetchone()
            if not row:
                return {
                    "state": "idle", "path_count": 0, "risk": 0, "scenario": "",
                    "choke_point": None, "pending_fix": False, "seq": 0, "updated_at": int(time.time())
                }
            pending_fix = bool(row[5] and row[5] != "null")
            return {
                "state": row[0],
                "path_count": row[1],
                "risk": row[2],
                "scenario": row[3],
                "choke_point": row[4],
                "pending_fix": pending_fix,
                "seq": row[6],
                "updated_at": row[7]
            }

    def set_state(self, increment_seq: bool = False, **fields) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT state, path_count, risk, scenario, choke_point, pending_fix_json, seq FROM state WHERE id = 1")
            row = cur.fetchone()
            current_seq = row[6] if row else 0
            new_seq = current_seq + (1 if increment_seq else 0)
            now = int(time.time())

            updates = []
            values = []
            for k, v in fields.items():
                if k in ("state", "path_count", "risk", "scenario", "choke_point"):
                    updates.append(f"{k} = ?")
                    values.append(v)
            updates.append("seq = ?")
            values.append(new_seq)
            updates.append("updated_at = ?")
            values.append(now)

            sql = f"UPDATE state SET {', '.join(updates)} WHERE id = 1"
            cur.execute(sql, values)
            self.conn.commit()
        return self.get_state()

    def set_analysis(self, obj: Optional[Dict[str, Any]]) -> None:
        with self.lock:
            cur = self.conn.cursor()
            json_str = json.dumps(obj) if obj else None
            cur.execute("UPDATE state SET analysis_json = ? WHERE id = 1", (json_str,))
            self.conn.commit()

    def get_analysis(self) -> Optional[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT analysis_json FROM state WHERE id = 1")
            row = cur.fetchone()
            if row and row[0]:
                return json.loads(row[0])
            return None

    def set_pending_fix(self, obj: Optional[Dict[str, Any]]) -> None:
        with self.lock:
            cur = self.conn.cursor()
            json_str = json.dumps(obj) if obj else None
            cur.execute("UPDATE state SET pending_fix_json = ? WHERE id = 1", (json_str,))
            self.conn.commit()

    def get_pending_fix(self) -> Optional[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT pending_fix_json FROM state WHERE id = 1")
            row = cur.fetchone()
            if row and row[0]:
                return json.loads(row[0])
            return None

    def upsert_device(self, heartbeat: Dict[str, Any], remote_ip: str) -> None:
        with self.lock:
            cur = self.conn.cursor()
            now = int(time.time())
            device_id = heartbeat.get("device_id")
            device_type = heartbeat.get("device_type")
            fw = heartbeat.get("fw")
            ip = heartbeat.get("ip")
            rssi = heartbeat.get("rssi")
            uptime_s = heartbeat.get("uptime_s")
            comp_json = json.dumps(heartbeat.get("components", {}))

            cur.execute(
                """
                INSERT INTO devices (device_id, device_type, fw, ip, rssi, uptime_s, components_json, remote_ip, last_seen)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(device_id) DO UPDATE SET
                    device_type = excluded.device_type,
                    fw = excluded.fw,
                    ip = excluded.ip,
                    rssi = excluded.rssi,
                    uptime_s = excluded.uptime_s,
                    components_json = excluded.components_json,
                    remote_ip = excluded.remote_ip,
                    last_seen = excluded.last_seen
                """,
                (device_id, device_type, fw, ip, rssi, uptime_s, comp_json, remote_ip, now)
            )
            self.conn.commit()

    def list_devices(self) -> List[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT device_id, device_type, fw, ip, rssi, uptime_s, components_json, remote_ip, last_seen FROM devices")
            rows = cur.fetchall()
            now = int(time.time())
            results = []
            for r in rows:
                age_s = max(0, now - r[8])
                components = json.loads(r[6]) if r[6] else {}
                results.append({
                    "device_id": r[0],
                    "device_type": r[1],
                    "fw": r[2],
                    "ip": r[3],
                    "rssi": r[4],
                    "uptime_s": r[5],
                    "components": components,
                    "remote_ip": r[7],
                    "last_seen": r[8],
                    "age_s": age_s,
                    "online": (age_s <= 25)
                })
            return results

    def queue_command(self, device_id: str, cmd: str) -> None:
        with self.lock:
            cur = self.conn.cursor()
            now = int(time.time())
            cur.execute(
                "INSERT OR REPLACE INTO commands (device_id, command, queued_at) VALUES (?, ?, ?)",
                (device_id, cmd, now)
            )
            self.conn.commit()

    def pop_command(self, device_id: str) -> Optional[str]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT command FROM commands WHERE device_id = ?", (device_id,))
            row = cur.fetchone()
            if row:
                cmd = row[0]
                cur.execute("DELETE FROM commands WHERE device_id = ?", (device_id,))
                self.conn.commit()
                return cmd
            return "none"

    def add_scan(self, card_id: str, device_id: str, known: bool, name: Optional[str], context: str) -> None:
        with self.lock:
            cur = self.conn.cursor()
            now = int(time.time())
            uid = normalize_uid(card_id)
            cur.execute(
                "INSERT INTO scans (card_id, device_id, known, name, context, ts) VALUES (?, ?, ?, ?, ?, ?)",
                (uid, device_id, 1 if known else 0, name, context, now)
            )
            self.conn.commit()

    def recent_scans(self, limit: int = 20) -> List[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                SELECT s.card_id, s.device_id,
                       CASE WHEN c.card_id IS NOT NULL THEN 1 ELSE s.known END as known,
                       COALESCE(c.name, s.name) as name,
                       s.context, s.ts
                FROM scans s
                LEFT JOIN cards c ON UPPER(s.card_id) = UPPER(c.card_id)
                ORDER BY s.id DESC LIMIT ?
                """,
                (limit,)
            )
            rows = cur.fetchall()
            return [
                {
                    "card_id": r[0],
                    "device_id": r[1],
                    "known": bool(r[2]),
                    "name": r[3],
                    "context": r[4],
                    "ts": r[5]
                }
                for r in rows
            ]

    def list_cards(self) -> List[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT card_id, name, role, created_at FROM cards ORDER BY created_at DESC")
            rows = cur.fetchall()
            return [
                {"card_id": r[0], "name": r[1], "role": r[2], "created_at": r[3]}
                for r in rows
            ]

    def get_card(self, uid: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            norm = normalize_uid(uid)
            cur.execute("SELECT card_id, name, role, created_at FROM cards WHERE card_id = ?", (norm,))
            row = cur.fetchone()
            if row:
                return {"card_id": row[0], "name": row[1], "role": row[2], "created_at": row[3]}
            return None

    def add_card(self, uid: str, name: str, role: str = "approver") -> None:
        with self.lock:
            cur = self.conn.cursor()
            now = int(time.time())
            norm = normalize_uid(uid)
            cur.execute(
                "INSERT OR REPLACE INTO cards (card_id, name, role, created_at) VALUES (?, ?, ?, ?)",
                (norm, name, role, now)
            )
            cur.execute(
                "UPDATE scans SET known = 1, name = ? WHERE UPPER(card_id) = UPPER(?)",
                (name, norm)
            )
            self.conn.commit()

    def remove_card(self, uid: str) -> bool:
        with self.lock:
            cur = self.conn.cursor()
            norm = normalize_uid(uid)
            cur.execute("DELETE FROM cards WHERE card_id = ?", (norm,))
            deleted = cur.rowcount > 0
            self.conn.commit()
            return deleted

    def append_audit(self, event: str, **fields) -> Dict[str, Any]:
        with self.lock:
            cur = self.conn.cursor()
            now = int(time.time())
            entry = {"event": event, "ts": now, **fields}

            # Fetch last this_hash
            cur.execute("SELECT this_hash FROM audit ORDER BY id DESC LIMIT 1")
            row = cur.fetchone()
            prev_hash = row[0] if row else "0" * 64

            this_hash = compute_audit_hash(prev_hash, entry)
            entry_json = json.dumps(entry, sort_keys=True)

            cur.execute(
                "INSERT INTO audit (event, entry_json, prev_hash, this_hash, ts) VALUES (?, ?, ?, ?, ?)",
                (event, entry_json, prev_hash, this_hash, now)
            )
            self.conn.commit()
            return {
                "event": event,
                "entry": entry,
                "prev_hash": prev_hash,
                "this_hash": this_hash,
                "ts": now
            }

    def list_audit(self) -> List[Dict[str, Any]]:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT id, event, entry_json, prev_hash, this_hash, ts FROM audit ORDER BY id DESC")
            rows = cur.fetchall()
            return [
                {
                    "id": r[0],
                    "event": r[1],
                    "entry": json.loads(r[2]),
                    "prev_hash": r[3],
                    "this_hash": r[4],
                    "ts": r[5]
                }
                for r in rows
            ]

    def verify_chain(self) -> bool:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT id, entry_json, prev_hash, this_hash FROM audit ORDER BY id ASC")
            rows = cur.fetchall()
            records = [
                {"id": r[0], "entry_json": r[1], "prev_hash": r[2], "this_hash": r[3]}
                for r in rows
            ]
            return verify_audit_chain(records)

    def reset(self) -> None:
        with self.lock:
            cur = self.conn.cursor()
            cur.execute("SELECT seq FROM state WHERE id = 1")
            row = cur.fetchone()
            new_seq = (row[0] if row else 0) + 1
            now = int(time.time())
            cur.execute(
                "UPDATE state SET state = 'idle', path_count = 0, risk = 0, scenario = '', "
                "choke_point = NULL, pending_fix_json = NULL, analysis_json = NULL, seq = ?, updated_at = ? WHERE id = 1",
                (new_seq, now)
            )
            self.conn.commit()
