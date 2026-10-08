import os
import tempfile
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.store import set_repo
from app.store.sqlite_repo import SQLiteRepository

@pytest.fixture
def client():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        temp_db = tf.name

    repo = SQLiteRepository(db_path=temp_db)
    set_repo(repo)

    with TestClient(app) as c:
        yield c, repo

    repo.close()
    if os.path.exists(temp_db):
        os.remove(temp_db)

def test_full_demo_e2e_lifecycle(client):
    c, repo = client
    dev_headers_esp = {
        "X-Device-Key": settings.DEVICE_KEY,
        "X-Device-Id": "esp32-console-01"
    }
    dev_headers_uno = {
        "X-Device-Key": settings.DEVICE_KEY,
        "X-Device-Id": "unoq-status-01"
    }

    # Step 1: System Reset
    r = c.post("/api/reset")
    assert r.status_code == 200
    r_st = c.get("/api/status")
    assert r_st.json()["state"] == "idle"
    assert r_st.json()["path_count"] == 0

    # Step 2: Trigger Analysis on EduCloud
    r_an = c.post("/api/analyze", json={"scenario": "educloud"})
    assert r_an.status_code == 200
    analysis_data = r_an.json()
    assert analysis_data["scenario"] == "educloud"
    assert analysis_data["before"]["path_count"] == 3
    assert analysis_data["before"]["risk"] == 88
    assert analysis_data["choke_point"]["id"] == "role_overpriv"

    # Verify status changed to unsafe
    r_st = c.get("/api/status")
    assert r_st.json()["state"] == "unsafe"
    assert r_st.json()["path_count"] == 3
    assert r_st.json()["risk"] == 88
    assert r_st.json()["pending_fix"] is True

    # Step 3: Two simulated heartbeats
    hb_esp = {
        "device_id": "esp32-console-01",
        "device_type": "esp32_console",
        "fw": "1.0.0",
        "ip": "192.168.43.57",
        "rssi": -48,
        "uptime_s": 300,
        "components": {"tft": "ok", "rfid": "ok", "rfid_version": "0x92", "wifi": "ok"}
    }
    r = c.post("/api/device/heartbeat", json=hb_esp, headers=dev_headers_esp)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    hb_uno = {
        "device_id": "unoq-status-01",
        "device_type": "unoq_status",
        "fw": "1.0.0",
        "ip": "192.168.43.58",
        "uptime_s": 250,
        "components": {"led_matrix": "ok", "rgb_leds": "ok", "bridge": "ok"}
    }
    r = c.post("/api/device/heartbeat", json=hb_uno, headers=dev_headers_uno)
    assert r.status_code == 200
    assert r.json()["ok"] is True

    # Check devices are online
    r_devs = c.get("/api/devices")
    devs = r_devs.json()
    assert len(devs) == 2
    assert all(d["online"] is True for d in devs)

    # Step 4: Unknown badge DEADBEEF tapped -> 403
    pfix_res = c.get("/api/pending_fix").json()
    assert pfix_res["fix_id"] == "scope_passrole"

    r_app_unknown = c.post(
        "/api/approve",
        json={"fix_id": "scope_passrole", "card_id": "DEADBEEF", "device_id": "esp32-console-01"},
        headers=dev_headers_esp
    )
    assert r_app_unknown.status_code == 403
    assert r_app_unknown.json()["reason"] == "unknown_card"

    # Step 5: Enrol card 04A1B2C3
    r_enrol = c.post("/api/cards", json={"card_id": "04A1B2C3", "name": "Security Lead", "role": "approver"})
    assert r_enrol.status_code == 200

    # Step 6: Approve fix with enrolled card -> 200
    r_app_success = c.post(
        "/api/approve",
        json={"fix_id": "scope_passrole", "card_id": "04A1B2C3", "device_id": "esp32-console-01"},
        headers=dev_headers_esp
    )
    assert r_app_success.status_code == 200
    app_res = r_app_success.json()
    assert app_res["applied"] is True
    assert app_res["approver"] == "Security Lead"
    assert app_res["fix_id"] == "scope_passrole"
    assert app_res["state"] == "safe"
    assert app_res["path_count"] == 0
    assert app_res["risk"] == 12

    # Step 7: Verify status is now safe/0/12
    r_st_safe = c.get("/api/status")
    st_safe = r_st_safe.json()
    assert st_safe["state"] == "safe"
    assert st_safe["path_count"] == 0
    assert st_safe["risk"] == 12
    assert st_safe["pending_fix"] is False

    # Step 8: Verify stored analysis is applied with removed edge
    r_an_after = c.get("/api/analysis")
    assert r_an_after.status_code == 200
    after_data = r_an_after.json()
    assert after_data["applied"] is True
    assert len(after_data["paths"]) == 0
    assert len(after_data["paths_before"]) == 3
    # Check removed edge
    removed_edges = [e for e in after_data["edges"] if e["removed"] is True]
    assert len(removed_edges) >= 1
    assert any(e["source"] == "role_overpriv" and e["target"] == "role_admin" for e in removed_edges)

    # Step 9: Verify audit hash chain
    r_audit = c.get("/api/audit")
    assert r_audit.status_code == 200
    audit_data = r_audit.json()
    assert audit_data["chain_valid"] is True
    events = [e["event"] for e in audit_data["entries"]]
    assert "fix_applied" in events
    assert "approve_denied" in events
    assert "card_enrolled" in events
    assert "analysis_run" in events

    # Step 10: Verify frontend dist serving
    r_ui = c.get("/")
    assert r_ui.status_code == 200
    assert "AEGIS-Graph" in r_ui.text
