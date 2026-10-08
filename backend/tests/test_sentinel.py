import os
import tempfile
import pytest
from httpx import AsyncClient, ASGITransport
from app.config import settings
from app.store import set_repo
from app.store.sqlite_repo import SQLiteRepository
from app.engine.loader import load_scenario
from app.engine.remediation import run_full_analysis
from app.main import app
from app.sentinel import (
    ask_sentinel, validate_answer, list_paths, explain_path, get_choke_point,
    get_blast_radius, simulate_fix, get_status, get_recent_audit
)

@pytest.fixture
def populated_repo():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
        temp_db = tf.name

    repo = SQLiteRepository(db_path=temp_db, seed_cards="04A1B2C3:Security Lead")
    set_repo(repo)

    sc = load_scenario("educloud")
    analysis = run_full_analysis(sc)
    repo.set_analysis(analysis.model_dump())
    repo.set_state(
        increment_seq=True,
        state="unsafe",
        path_count=analysis.before.path_count,
        risk=analysis.before.risk,
        scenario=analysis.scenario,
        choke_point=analysis.choke_point.label
    )

    yield repo

    repo.close()
    if os.path.exists(temp_db):
        os.remove(temp_db)

@pytest.mark.asyncio
async def test_sentinel_template_mode(populated_repo):
    # Enforce air-gapped
    settings.AIR_GAPPED = 1
    res = await ask_sentinel("How does an attacker reach the parent portal database?")

    assert res["mode"] == "template"
    assert res["grounded"] is True
    assert "role_overpriv" in res["answer"]
    assert "db_parent_portal" in res["answer"]
    assert "role_overpriv" in res["cited"]
    assert "db_parent_portal" in res["cited"]

def test_sentinel_validator_rejects_hallucinations(populated_repo):
    repo = populated_repo
    analysis = repo.get_analysis()

    # Valid answer citing real resources
    valid_text = "The path traverses role_overpriv to access db_parent_portal."
    is_valid, cited = validate_answer(valid_text, analysis)
    assert is_valid is True
    assert "role_overpriv" in cited
    assert "db_parent_portal" in cited

    # Hallucinated answer citing unknown identifier
    invalid_text = "The attacker used role_superadmin_pwned to take over the account."
    is_valid, _ = validate_answer(invalid_text, analysis)
    assert is_valid is False

    # Hallucinated answer citing unknown number
    invalid_num = "There are 999 attack paths with risk score 450."
    is_valid_num, _ = validate_answer(invalid_num, analysis)
    assert is_valid_num is False

def test_sentinel_read_only_tools(populated_repo):
    repo = populated_repo
    repo.append_audit("test_event", reason="test")

    paths = list_paths()
    assert len(paths) == 3

    path1 = explain_path(1)
    assert path1["id"] == 1
    assert "role_overpriv" in path1["nodes"]

    choke = get_choke_point()
    assert choke["id"] == "role_overpriv"

    blast = get_blast_radius()
    assert blast["reduction_pct"] == 82
    assert blast["before_nodes"] == 7

    sim = simulate_fix("scope_passrole")
    assert sim["fix_id"] == "scope_passrole"
    assert sim["paths_after"] == 0

    st = get_status()
    assert st["state"] == "unsafe"
    assert st["path_count"] == 3

    recent = get_recent_audit(5)
    assert len(recent) >= 1
    assert recent[0]["event"] == "test_event"

@pytest.mark.asyncio
async def test_api_ask_endpoint(populated_repo):
    settings.AIR_GAPPED = 1
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        res = await ac.post("/api/ask", json={"question": "How to reach the db?"})
        assert res.status_code == 200
        data = res.json()
        assert data["mode"] == "template"
        assert "role_overpriv" in data["answer"]
        assert "db_parent_portal" in data["answer"]
        assert "role_overpriv" in data["cited"]
        assert "db_parent_portal" in data["cited"]

@pytest.mark.asyncio
async def test_sentinel_real_key_if_present(populated_repo):
    api_key = os.environ.get("GEMINI_API_KEY") or settings.GEMINI_API_KEY
    if not api_key:
        pytest.skip("No GEMINI_API_KEY provided; skipping live Gemini test")

    settings.GEMINI_API_KEY = api_key
    settings.AIR_GAPPED = 0

    res = await ask_sentinel("How can an attacker reach the parent portal database?")
    assert res["mode"] in ("gemini", "template")
    if res["mode"] == "gemini":
        assert "role_overpriv" in res["answer"].lower() or "role_overpriv" in res["cited"]
        assert res["grounded"] is True
