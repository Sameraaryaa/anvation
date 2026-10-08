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

    repo = SQLiteRepository(db_path=temp_db, seed_cards="04A1B2C3:Security Lead")
    set_repo(repo)

    with TestClient(app) as c:
        yield c, repo

    repo.close()
    if os.path.exists(temp_db):
        os.remove(temp_db)

def test_dashboard_api_flow(client):
    c, repo = client

    # 1. Scenarios
    r = c.get("/api/scenarios")
    assert r.status_code == 200
    sc_list = r.json()
    assert any(s["id"] == "educloud" for s in sc_list)
    assert any(s["id"] == "miniconfig" for s in sc_list)

    # 2. Config
    r = c.get("/api/config")
    assert r.status_code == 200
    cfg = r.json()
    assert "allow_browser_approval" in cfg
    assert "air_gapped" in cfg
    assert "db_mode" in cfg

    # 3. Analyze educloud
    r = c.post("/api/analyze", json={"scenario": "educloud"})
    assert r.status_code == 200
    analysis = r.json()
    assert analysis["scenario"] == "educloud"
    assert analysis["before"]["path_count"] == 3
    assert analysis["before"]["risk"] == 88
    assert analysis["choke_point"]["id"] == "role_overpriv"
    assert len(analysis["recommended_fixes"]) == 1

    # Verify GET /api/analysis
    r_get = c.get("/api/analysis")
    assert r_get.status_code == 200
    assert r_get.json()["scenario"] == "educloud"

    # Status updated
    r_st = c.get("/api/status")
    assert r_st.json()["state"] == "unsafe"
    assert r_st.json()["path_count"] == 3
    assert r_st.json()["risk"] == 88
    assert r_st.json()["pending_fix"] is True

    # 4. Device command queue
    r_cmd = c.post("/api/devices/esp32-console-01/command", json={"command": "identify"})
    assert r_cmd.status_code == 200
    assert r_cmd.json()["queued"] == "identify"

    # Bad command
    r_bad = c.post("/api/devices/esp32-console-01/command", json={"command": "reboot_now"})
    assert r_bad.status_code == 400

    # 5. Cards CRUD & Scan Known
    r_enrol = c.post("/api/cards", json={"card_id": "99:AA:BB:CC", "name": "Dev Ops", "role": "approver"})
    assert r_enrol.status_code == 200
    r_cards = c.get("/api/cards")
    assert any(cd["card_id"] == "99AABBCC" and cd["name"] == "Dev Ops" for cd in r_cards.json())

    # Scan enrolled card -> known true
    dev_headers = {"X-Device-Key": settings.DEVICE_KEY, "X-Device-Id": "esp32-console-01"}
    r_scan = c.post("/api/rfid/scan", json={"card_id": "99AABBCC"}, headers=dev_headers)
    assert r_scan.status_code == 200
    assert r_scan.json()["known"] is True
    assert r_scan.json()["name"] == "Dev Ops"

    r_del = c.delete("/api/cards/99AABBCC")
    assert r_del.status_code == 200
    r_cards_after = c.get("/api/cards")
    assert not any(cd["card_id"] == "99AABBCC" for cd in r_cards_after.json())

    # 6. Audit
    r_audit = c.get("/api/audit")
    assert r_audit.status_code == 200
    assert r_audit.json()["chain_valid"] is True
    assert len(r_audit.json()["entries"]) >= 1

    # 7. Browser simulate_badge fallback
    settings.ALLOW_BROWSER_APPROVAL = 1
    # Analyze again to have pending fix
    c.post("/api/analyze", json={"scenario": "educloud"})
    r_sim = c.post("/api/dev/simulate_badge", json={"card_id": "04A1B2C3"})
    assert r_sim.status_code == 200
    assert r_sim.json()["applied"] is True
    assert r_sim.json()["approver"] == "Security Lead"

    # 8. Reset
    r_rst = c.post("/api/reset")
    assert r_rst.status_code == 200
    r_st_idle = c.get("/api/status")
    assert r_st_idle.json()["state"] == "idle"
    assert r_st_idle.json()["path_count"] == 0

    # 9. Import custom scenario
    custom_sc = {
        "scenario": "test_import_custom",
        "display_name": "Custom Test Stack",
        "entry_points": ["internet"],
        "crown_jewels": ["secret_db"],
        "nodes": [
            {"id": "internet", "type": "internet", "label": "Internet", "exposed": True},
            {"id": "server", "type": "compute", "label": "App Server"},
            {"id": "secret_db", "type": "data", "label": "Secret DB", "crown_jewel": True, "value": 10}
        ],
        "edges": [
            {"from": "internet", "to": "server", "type": "EXPOSED_TO_INTERNET", "difficulty": 1},
            {"from": "server", "to": "secret_db", "type": "SQL_QUERY", "difficulty": 1}
        ]
    }
    r_import = c.post("/api/scenarios/import", json=custom_sc)
    assert r_import.status_code == 200
    assert r_import.json()["ok"] is True
    assert r_import.json()["scenario"] == "test_import_custom"

    # Verify scenario shows up in list
    sc_list2 = c.get("/api/scenarios").json()
    assert any(s["id"] == "test_import_custom" for s in sc_list2)

    # 10. Import raw Terraform code
    tf_snippet = """
    resource "aws_iam_role" "app_role" {
      name = "my-overpriv-app-role"
    }
    resource "aws_instance" "web_server" {
      ami = "ami-12345"
    }
    resource "aws_s3_bucket" "prod_database_backup" {
      bucket = "prod-sensitive-backup"
    }
    """
    r_tf = c.post("/api/scenarios/import", json={
        "terraform": tf_snippet,
        "scenario": "test_imported_tf",
        "display_name": "Test Terraform Architecture"
    })
    assert r_tf.status_code == 200
    assert r_tf.json()["ok"] is True
    assert r_tf.json()["scenario"] == "test_imported_tf"

    # Verify pending_fix is immediately staged and available to device
    pfix_res = c.get("/api/pending_fix")
    assert pfix_res.status_code == 200
    assert pfix_res.json()["fix_id"] is not None
    assert pfix_res.json()["paths_before"] > 0
    assert pfix_res.json()["paths_after"] == 0

    # 11. Test IAM AssumeRole Terraform import with no EC2 instances
    iam_tf_snippet = """
    resource "aws_iam_role" "high_priv_role" {
      name = "privesc-AssumeRole-high-priv"
      managed_policy_arns = ["arn:aws:iam::aws:policy/AdministratorAccess"]
    }
    resource "aws_s3_bucket" "target_vault" {
      bucket = "confidential-target-vault"
    }
    """
    r_iam_tf = c.post("/api/scenarios/import", json={
        "terraform": iam_tf_snippet,
        "scenario": "test_iam_privesc_import",
        "display_name": "Terraform IAM Privesc"
    })
    assert r_iam_tf.status_code == 200
    assert r_iam_tf.json()["ok"] is True

    # Hardware console polls /api/pending_fix
    pfix_iam = c.get("/api/pending_fix").json()
    assert pfix_iam["fix_id"] is not None
    assert pfix_iam["paths_before"] == 1
    assert pfix_iam["paths_after"] == 0

    # Hardware console taps enrolled badge to approve
    app_headers = {"X-Device-Key": settings.DEVICE_KEY, "X-Device-Id": "esp32-console-01"}
    r_app = c.post("/api/approve", json={
        "fix_id": pfix_iam["fix_id"],
        "card_id": "04A1B2C3",
        "device_id": "esp32-console-01"
    }, headers=app_headers)
    assert r_app.status_code == 200
    assert r_app.json()["applied"] is True
    assert r_app.json()["state"] == "safe"
    assert r_app.json()["path_count"] == 0

    # Pending fix is now cleared
    assert c.get("/api/pending_fix").json()["fix_id"] is None



