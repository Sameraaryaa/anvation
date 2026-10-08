import os
import tempfile
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.config import settings
from app.store import set_repo
from app.store.sqlite_repo import SQLiteRepository
from app.engine.loader import load_scenario
from app.engine.remediation import run_full_analysis

@pytest.fixture
def client():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        temp_db = tf.name

    repo = SQLiteRepository(db_path=temp_db, seed_cards="04A1B2C3:Security Lead")
    set_repo(repo)

    with TestClient(app) as c:
        yield c, repo

    repo.close()
    if os.path.exists(temp_db):
        os.remove(temp_db)

def test_device_contract_sequence(client):
    c, repo = client

    # 1. Health
    r = c.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["service"] == "aegis"

    # 2. Status Idle
    r = c.get("/api/status")
    assert r.status_code == 200
    st = r.json()
    assert st["state"] == "idle"
    assert st["path_count"] == 0
    assert st["risk"] == 0
    assert st["pending_fix"] is False

    # 3. Heartbeat without key -> 401
    hb_payload = {
        "device_id": "esp32-console-01",
        "device_type": "esp32_console",
        "fw": "1.0.0",
        "uptime_s": 120
    }
    r = c.post("/api/device/heartbeat", json=hb_payload)
    assert r.status_code == 401
    assert r.json()["error"] == "bad_device_key"

    # Valid heartbeat
    headers = {"X-Device-Key": settings.DEVICE_KEY, "X-Device-Id": "esp32-console-01"}
    r = c.post("/api/device/heartbeat", json=hb_payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert r.json()["command"] == "none"

    # 4. Simulate running analysis on educloud
    sc = load_scenario("educloud")
    analysis = run_full_analysis(sc)
    repo.set_analysis(analysis.model_dump())
    first_fix = analysis.recommended_fixes[0]
    pfix = {
        "fix_id": first_fix.fix_id,
        "title": first_fix.title,
        "detail": first_fix.detail,
        "risk_before": analysis.before.risk,
        "risk_after": analysis.after.risk,
        "paths_before": analysis.before.path_count,
        "paths_after": analysis.after.path_count,
    }
    repo.set_pending_fix(pfix)
    repo.set_state(
        increment_seq=True,
        state="unsafe",
        path_count=analysis.before.path_count,
        risk=analysis.before.risk,
        scenario=analysis.scenario,
        choke_point=analysis.choke_point.label if analysis.choke_point else None
    )

    # Verify pending fix endpoint
    r = c.get("/api/pending_fix")
    assert r.status_code == 200
    assert r.json()["fix_id"] == "scope_passrole"
    assert r.json()["risk_before"] == 88
    assert r.json()["risk_after"] == 12

    # Status is now unsafe
    r = c.get("/api/status")
    st = r.json()
    assert st["state"] == "unsafe"
    assert st["path_count"] == 3
    assert st["risk"] == 88
    assert st["pending_fix"] is True

    # 5. Approve with unknown card DEADBEEF -> 403
    app_payload = {"fix_id": "scope_passrole", "card_id": "DEADBEEF", "device_id": "esp32-console-01"}
    r = c.post("/api/approve", json=app_payload, headers=headers)
    assert r.status_code == 403
    assert r.json()["applied"] is False
    assert r.json()["reason"] == "unknown_card"
    assert r.json()["card_id"] == "DEADBEEF"

    # 6. Queue command and verify delivery on heartbeat
    repo.queue_command("esp32-console-01", "identify")
    r = c.post("/api/device/heartbeat", json=hb_payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["command"] == "identify"

    # Next heartbeat gets none
    r = c.post("/api/device/heartbeat", json=hb_payload, headers=headers)
    assert r.status_code == 200
    assert r.json()["command"] == "none"

    # 7. Approve with enrolled card 04A1B2C3 -> 200
    app_payload["card_id"] = "04A1B2C3"
    r = c.post("/api/approve", json=app_payload, headers=headers)
    assert r.status_code == 200
    data = r.json()
    assert data["applied"] is True
    assert data["approver"] == "Security Lead"
    assert data["fix_id"] == "scope_passrole"
    assert data["state"] == "safe"
    assert data["path_count"] == 0
    assert data["risk"] == 12

    # Verify status changed to safe
    r = c.get("/api/status")
    st = r.json()
    assert st["state"] == "safe"
    assert st["path_count"] == 0
    assert st["risk"] == 12
    assert st["pending_fix"] is False

    # Pending fix is now cleared
    r = c.get("/api/pending_fix")
    assert r.json()["fix_id"] is None

    # 8. Approve again -> 409 no_pending_fix
    r = c.post("/api/approve", json=app_payload, headers=headers)
    assert r.status_code == 409
    assert r.json()["applied"] is False
    assert r.json()["reason"] == "no_pending_fix"

    # 9. RFID scan of known card -> known true
    r = c.post("/api/rfid/scan", json={"card_id": "04A1B2C3"}, headers=headers)
    assert r.status_code == 200
    assert r.json()["known"] is True
    assert r.json()["name"] == "Security Lead"

    # 10. Audit chain valid with 2+ entries
    audit = repo.list_audit()
    assert len(audit) >= 2
    assert repo.verify_chain() is True
