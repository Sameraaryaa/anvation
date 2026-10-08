import time
import json
from typing import Dict, Any, List, Optional
from app.store.base import Repository, normalize_uid
from app.store.audit import compute_audit_hash, verify_audit_chain

class FirestoreRepository(Repository):
    def __init__(self, project_id: Optional[str] = None, prefix: str = "aegis", seed_cards: str = ""):
        from google.cloud import firestore
        self.db = firestore.Client(project=project_id) if project_id else firestore.Client()
        self.prefix = prefix
        self.state_ref = self.db.collection(f"{prefix}_state").document("current")
        self.cards_col = self.db.collection(f"{prefix}_cards")
        self.devices_col = self.db.collection(f"{prefix}_devices")
        self.commands_col = self.db.collection(f"{prefix}_commands")
        self.scans_col = self.db.collection(f"{prefix}_scans")
        self.audit_col = self.db.collection(f"{prefix}_audit")

        self._init_db(seed_cards)

    def _init_db(self, seed_cards: str):
        snap = self.state_ref.get()
        if not snap.exists:
            self.state_ref.set({
                "state": "idle", "path_count": 0, "risk": 0, "scenario": "",
                "choke_point": None, "pending_fix": False, "seq": 0, "updated_at": int(time.time()),
                "analysis_json": None, "pending_fix_json": None
            })

        if seed_cards:
            now = int(time.time())
            for pair in seed_cards.split(","):
                if ":" in pair:
                    raw_uid, name = pair.split(":", 1)
                    uid = normalize_uid(raw_uid)
                    if uid:
                        doc = self.cards_col.document(uid).get()
                        if not doc.exists:
                            self.cards_col.document(uid).set({
                                "card_id": uid, "name": name.strip(), "role": "approver", "created_at": now
                            })

    def get_state(self) -> Dict[str, Any]:
        snap = self.state_ref.get()
        data = snap.to_dict() or {}
        pending_fix = bool(data.get("pending_fix_json") and data.get("pending_fix_json") != "null")
        return {
            "state": data.get("state", "idle"),
            "path_count": data.get("path_count", 0),
            "risk": data.get("risk", 0),
            "scenario": data.get("scenario", ""),
            "choke_point": data.get("choke_point"),
            "pending_fix": pending_fix,
            "seq": data.get("seq", 0),
            "updated_at": data.get("updated_at", int(time.time()))
        }

    def set_state(self, increment_seq: bool = False, **fields) -> Dict[str, Any]:
        snap = self.state_ref.get()
        data = snap.to_dict() or {}
        current_seq = data.get("seq", 0)
        new_seq = current_seq + (1 if increment_seq else 0)
        now = int(time.time())

        updates = dict(fields)
        updates["seq"] = new_seq
        updates["updated_at"] = now
        self.state_ref.update(updates)
        return self.get_state()

    def set_analysis(self, obj: Optional[Dict[str, Any]]) -> None:
        json_str = json.dumps(obj) if obj else None
        self.state_ref.update({"analysis_json": json_str})

    def get_analysis(self) -> Optional[Dict[str, Any]]:
        snap = self.state_ref.get()
        data = snap.to_dict() or {}
        val = data.get("analysis_json")
        return json.loads(val) if val else None

    def set_pending_fix(self, obj: Optional[Dict[str, Any]]) -> None:
        json_str = json.dumps(obj) if obj else None
        self.state_ref.update({"pending_fix_json": json_str})

    def get_pending_fix(self) -> Optional[Dict[str, Any]]:
        snap = self.state_ref.get()
        data = snap.to_dict() or {}
        val = data.get("pending_fix_json")
        return json.loads(val) if val else None

    def upsert_device(self, heartbeat: Dict[str, Any], remote_ip: str) -> None:
        now = int(time.time())
        device_id = heartbeat.get("device_id")
        doc_data = {
            "device_id": device_id,
            "device_type": heartbeat.get("device_type"),
            "fw": heartbeat.get("fw"),
            "ip": heartbeat.get("ip"),
            "rssi": heartbeat.get("rssi"),
            "uptime_s": heartbeat.get("uptime_s"),
            "components": heartbeat.get("components", {}),
            "remote_ip": remote_ip,
            "last_seen": now
        }
        self.devices_col.document(device_id).set(doc_data)

    def list_devices(self) -> List[Dict[str, Any]]:
        docs = self.devices_col.stream()
        now = int(time.time())
        res = []
        for d in docs:
            item = d.to_dict()
            last_seen = item.get("last_seen", 0)
            age_s = max(0, now - last_seen)
            item["age_s"] = age_s
            item["online"] = (age_s <= 25)
            res.append(item)
        return res

    def queue_command(self, device_id: str, cmd: str) -> None:
        self.commands_col.document(device_id).set({"command": cmd, "queued_at": int(time.time())})

    def pop_command(self, device_id: str) -> Optional[str]:
        doc_ref = self.commands_col.document(device_id)
        snap = doc_ref.get()
        if snap.exists:
            cmd = snap.to_dict().get("command", "none")
            doc_ref.delete()
            return cmd
        return "none"

    def add_device_log(self, device_id: str, level: str, message: str, raw_json: str = "") -> None:
        try:
            self.db.collection(f"{self.prefix}_device_logs").add({
                "device_id": device_id,
                "level": level,
                "message": message,
                "raw_json": raw_json,
                "ts": int(time.time())
            })
        except Exception:
            pass

    def get_device_logs(self, limit: int = 50, device_id: Optional[str] = None) -> List[Dict[str, Any]]:
        try:
            query = self.db.collection(f"{self.prefix}_device_logs").order_by("ts", direction="DESCENDING").limit(limit)
            return [doc.to_dict() for doc in query.stream()]
        except Exception:
            return []

    def add_scan(self, card_id: str, device_id: str, known: bool, name: Optional[str], context: str) -> None:
        now = int(time.time())
        uid = normalize_uid(card_id)
        self.scans_col.add({
            "card_id": uid, "device_id": device_id, "known": known, "name": name, "context": context, "ts": now
        })

    def recent_scans(self, limit: int = 20) -> List[Dict[str, Any]]:
        from google.cloud import firestore
        docs = self.scans_col.order_by("ts", direction=firestore.Query.DESCENDING).limit(limit).stream()
        return [d.to_dict() for d in docs]

    def list_cards(self) -> List[Dict[str, Any]]:
        from google.cloud import firestore
        docs = self.cards_col.order_by("created_at", direction=firestore.Query.DESCENDING).stream()
        return [d.to_dict() for d in docs]

    def get_card(self, uid: str) -> Optional[Dict[str, Any]]:
        norm = normalize_uid(uid)
        snap = self.cards_col.document(norm).get()
        return snap.to_dict() if snap.exists else None

    def add_card(self, uid: str, name: str, role: str = "approver") -> None:
        now = int(time.time())
        norm = normalize_uid(uid)
        self.cards_col.document(norm).set({
            "card_id": norm, "name": name, "role": role, "created_at": now
        })

    def remove_card(self, uid: str) -> bool:
        norm = normalize_uid(uid)
        ref = self.cards_col.document(norm)
        if ref.get().exists:
            ref.delete()
            return True
        return False

    def append_audit(self, event: str, **fields) -> Dict[str, Any]:
        from google.cloud import firestore
        now = int(time.time())
        entry = {"event": event, "ts": now, **fields}

        # Query last audit entry
        last_docs = list(self.audit_col.order_by("ts", direction=firestore.Query.DESCENDING).limit(1).stream())
        if last_docs:
            prev_hash = last_docs[0].to_dict().get("this_hash", "0" * 64)
            count = int(last_docs[0].id)
        else:
            prev_hash = "0" * 64
            count = 0

        this_hash = compute_audit_hash(prev_hash, entry)
        doc_id = f"{count + 1:06d}"
        doc_data = {
            "id": count + 1,
            "event": event,
            "entry_json": json.dumps(entry, sort_keys=True),
            "prev_hash": prev_hash,
            "this_hash": this_hash,
            "ts": now
        }
        self.audit_col.document(doc_id).set(doc_data)
        return {
            "event": event,
            "entry": entry,
            "prev_hash": prev_hash,
            "this_hash": this_hash,
            "ts": now
        }

    def list_audit(self) -> List[Dict[str, Any]]:
        from google.cloud import firestore
        docs = self.audit_col.order_by("ts", direction=firestore.Query.DESCENDING).stream()
        res = []
        for d in docs:
            data = d.to_dict()
            res.append({
                "id": data.get("id"),
                "event": data.get("event"),
                "entry": json.loads(data.get("entry_json", "{}")),
                "prev_hash": data.get("prev_hash"),
                "this_hash": data.get("this_hash"),
                "ts": data.get("ts")
            })
        return res

    def verify_chain(self) -> bool:
        from google.cloud import firestore
        docs = list(self.audit_col.order_by("ts", direction=firestore.Query.ASCENDING).stream())
        records = [d.to_dict() for d in docs]
        return verify_audit_chain(records)

    def reset(self) -> None:
        snap = self.state_ref.get()
        current_seq = (snap.to_dict() or {}).get("seq", 0) + 1
        now = int(time.time())
        self.state_ref.update({
            "state": "idle", "path_count": 0, "risk": 0, "scenario": "",
            "choke_point": None, "pending_fix_json": None, "analysis_json": None,
            "seq": current_seq, "updated_at": now
        })
