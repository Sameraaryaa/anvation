import os
import tempfile
import pytest
from app.store.sqlite_repo import SQLiteRepository
from app.store.base import normalize_uid

def test_sqlite_repository_contract():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        temp_db = tf.name

    try:
        repo = SQLiteRepository(db_path=temp_db, seed_cards="04A1B2C3:Security Lead")

        # Initial state
        st = repo.get_state()
        assert st["state"] == "idle"
        assert st["path_count"] == 0
        assert st["seq"] == 0
        assert st["pending_fix"] is False

        # Seed card present
        cards = repo.list_cards()
        assert len(cards) == 1
        assert cards[0]["card_id"] == "04A1B2C3"
        assert cards[0]["name"] == "Security Lead"

        # Update state with increment_seq
        st2 = repo.set_state(increment_seq=True, state="unsafe", path_count=3, risk=88, scenario="educloud")
        assert st2["seq"] == 1
        assert st2["state"] == "unsafe"
        assert st2["path_count"] == 3
        assert st2["risk"] == 88

        # Pending fix
        pfix = {"fix_id": "scope_passrole", "title": "Scope passrole"}
        repo.set_pending_fix(pfix)
        assert repo.get_pending_fix() == pfix
        assert repo.get_state()["pending_fix"] is True

        repo.set_pending_fix(None)
        assert repo.get_pending_fix() is None
        assert repo.get_state()["pending_fix"] is False

        # Devices & Heartbeats
        hb = {
            "device_id": "esp32-console-01",
            "device_type": "esp32_console",
            "fw": "1.0.0",
            "ip": "192.168.1.10",
            "rssi": -55,
            "uptime_s": 100,
            "components": {"tft": "ok"}
        }
        repo.upsert_device(hb, "127.0.0.1")
        devs = repo.list_devices()
        assert len(devs) == 1
        assert devs[0]["device_id"] == "esp32-console-01"
        assert devs[0]["online"] is True

        # Commands
        repo.queue_command("esp32-console-01", "identify")
        cmd = repo.pop_command("esp32-console-01")
        assert cmd == "identify"
        assert repo.pop_command("esp32-console-01") == "none"

        # Cards management & normalisation
        repo.add_card("11:22:33:44", "Admin User", "admin")
        c = repo.get_card("11223344")
        assert c is not None
        assert c["name"] == "Admin User"
        assert repo.remove_card("11 22 33 44") is True
        assert repo.get_card("11223344") is None

        # Scans
        repo.add_scan("DEADBEEF", "esp32-console-01", False, None, "scan")
        scans = repo.recent_scans(10)
        assert len(scans) == 1
        assert scans[0]["card_id"] == "DEADBEEF"
        assert scans[0]["known"] is False

        # Reset
        repo.reset()
        st_reset = repo.get_state()
        assert st_reset["state"] == "idle"
        assert st_reset["path_count"] == 0
        assert st_reset["seq"] == 2  # Incremented on reset

    finally:
        if 'repo' in locals():
            repo.close()
        if os.path.exists(temp_db):
            os.remove(temp_db)

def test_audit_hash_chain_tamper_detection():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        temp_db = tf.name

    try:
        repo = SQLiteRepository(db_path=temp_db)

        # Append 3 audit records
        repo.append_audit("analysis_run", scenario="educloud", risk=88)
        repo.append_audit("approve_denied", card_id="DEADBEEF")
        repo.append_audit("fix_applied", fix_id="scope_passrole", approver="Security Lead")

        # Must verify valid
        audit_records = repo.list_audit()
        assert len(audit_records) == 3
        assert repo.verify_chain() is True

        # Tamper with middle row in database
        cur = repo.conn.cursor()
        cur.execute("UPDATE audit SET entry_json = '{\"tampered\": true}' WHERE id = 2")
        repo.conn.commit()

        # Must fail verification
        assert repo.verify_chain() is False

    finally:
        if 'repo' in locals():
            repo.close()
        if os.path.exists(temp_db):
            os.remove(temp_db)
