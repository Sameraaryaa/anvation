from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.config import settings
from app.store import get_repo, normalize_uid
from app.engine.loader import load_scenario, list_scenarios, save_scenario
from app.engine.remediation import run_full_analysis
from app.api.device import execute_approval

router = APIRouter(prefix="/api", tags=["dashboard"])

class AnalyzeRequest(BaseModel):
    scenario: str

class CommandRequest(BaseModel):
    command: str

class CardCreateRequest(BaseModel):
    card_id: str
    name: str
    role: Optional[str] = "approver"

class SimulateBadgeRequest(BaseModel):
    card_id: str
    fix_id: Optional[str] = None

class AskRequest(BaseModel):
    question: str

@router.post("/analyze")
async def analyze_endpoint(body: AnalyzeRequest):
    repo = get_repo()
    try:
        sc = load_scenario(body.scenario)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"error": f"scenario '{body.scenario}' not found"})

    analysis = run_full_analysis(sc)
    repo.set_analysis(analysis.model_dump())

    # Set pending fix if fixes available
    if analysis.recommended_fixes:
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
    else:
        repo.set_pending_fix(None)

    state_str = "unsafe" if analysis.before.path_count > 0 else "safe"
    choke_label = analysis.choke_point.label if analysis.choke_point else None

    repo.set_state(
        increment_seq=True,
        state=state_str,
        path_count=analysis.before.path_count,
        risk=analysis.before.risk,
        scenario=analysis.scenario,
        choke_point=choke_label
    )

    repo.append_audit(
        "analysis_run",
        scenario=analysis.scenario,
        path_count=analysis.before.path_count,
        risk=analysis.before.risk
    )

    return analysis.model_dump()

@router.get("/analysis")
async def get_latest_analysis():
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return JSONResponse(status_code=404, content={"error": "no_analysis"})
    return analysis

@router.get("/paths")
async def get_paths_endpoint():
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        st = repo.get_state()
        sc_id = st.get("scenario") or "educloud"
        try:
            sc = load_scenario(sc_id)
            an = run_full_analysis(sc)
            analysis = an.model_dump()
            repo.set_analysis(analysis)
        except Exception:
            return {
                "scenario": sc_id,
                "display_name": sc_id,
                "risk": 0,
                "paths": [],
                "graph": {"nodes": [], "edges": []},
                "choke_point": None,
                "applied": False,
                "recommended_fixes": []
            }
    
    paths = analysis.get("paths", [])
    for p in paths:
        if "severity" not in p:
            r = p.get("risk", analysis.get("before", {}).get("risk", 50))
            if r >= 80:
                p["severity"] = "Critical"
            elif r >= 60:
                p["severity"] = "High"
            elif r >= 30:
                p["severity"] = "Medium"
            else:
                p["severity"] = "Low"
        else:
            # Capitalize severity for display consistency
            p["severity"] = p["severity"].capitalize()

    return {
        "scenario": analysis.get("scenario"),
        "display_name": analysis.get("display_name"),
        "risk": analysis.get("before", {}).get("risk", 0),
        "paths": paths,
        "graph": analysis.get("graph", {"nodes": [], "edges": []}),
        "choke_point": analysis.get("choke_point"),
        "applied": analysis.get("applied", False),
        "recommended_fixes": analysis.get("recommended_fixes", [])
    }

@router.get("/scenarios")
async def get_scenarios():
    return list_scenarios()

@router.post("/scenarios/import")
async def import_scenario_endpoint(body: Dict[str, Any]):
    try:
        # Check if terraform code is passed
        is_tf = (
            "terraform" in body
            or "tf_code" in body
            or body.get("format") == "terraform"
            or ("scenario" not in body and any("resource " in str(v) for v in body.values()))
        )
        if is_tf:
            tf_text = body.get("terraform") or body.get("tf_code") or str(list(body.values())[0])
            sc_id = body.get("scenario") or "imported_tf_scenario"
            dname = body.get("display_name") or "Imported Terraform Stack"
            from app.engine.tf_parser import parse_terraform_to_scenario
            scenario_dict = parse_terraform_to_scenario(tf_text, scenario_id=sc_id, display_name=dname)
            sc = save_scenario(scenario_dict)
        else:
            sc = save_scenario(body)

        repo = get_repo()
        repo.append_audit("scenario_imported", scenario=sc.scenario, display_name=sc.display_name)

        # Automatically analyze and stage fix immediately on import
        analysis = run_full_analysis(sc)
        repo.set_analysis(analysis.model_dump())

        if analysis.recommended_fixes and analysis.before.path_count > 0:
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
        else:
            repo.set_pending_fix(None)

        state_str = "unsafe" if analysis.before.path_count > 0 else "safe"
        choke_label = analysis.choke_point.label if analysis.choke_point else None

        repo.set_state(
            increment_seq=True,
            state=state_str,
            path_count=analysis.before.path_count,
            risk=analysis.before.risk,
            scenario=analysis.scenario,
            choke_point=choke_label
        )
        repo.append_audit(
            "analysis_run",
            scenario=analysis.scenario,
            path_count=analysis.before.path_count,
            risk=analysis.before.risk
        )

        return {
            "ok": True,
            "scenario": sc.scenario,
            "display_name": sc.display_name,
            "message": f"Scenario '{sc.display_name}' imported successfully"
        }
    except Exception as e:
        return JSONResponse(status_code=400, content={"error": f"Invalid scenario format: {str(e)}"})


@router.post("/reset")
async def reset_endpoint():
    repo = get_repo()
    repo.reset()
    return {"ok": True}

@router.get("/devices")
async def get_devices():
    repo = get_repo()
    return repo.list_devices()

@router.post("/devices/{device_id}/command")
async def queue_device_command(device_id: str, body: CommandRequest):
    if body.command not in ("identify", "self_test"):
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_command", "valid_commands": ["identify", "self_test"]}
        )
    repo = get_repo()
    repo.queue_command(device_id, body.command)
    return {
        "ok": True,
        "queued": body.command,
        "note": "delivered on next heartbeat (<=10 s)"
    }

@router.get("/cards")
async def get_cards():
    repo = get_repo()
    return repo.list_cards()

@router.post("/cards")
async def enroll_card(body: CardCreateRequest):
    repo = get_repo()
    uid = normalize_uid(body.card_id)
    repo.add_card(uid, body.name, body.role or "approver")
    repo.append_audit("card_enrolled", card_id=uid, name=body.name, role=body.role or "approver")
    return {"ok": True}

@router.delete("/cards/{card_id}")
async def delete_card(card_id: str):
    repo = get_repo()
    uid = normalize_uid(card_id)
    repo.remove_card(uid)
    repo.append_audit("card_removed", card_id=uid)
    return {"ok": True}

@router.get("/rfid/recent")
async def get_recent_scans():
    repo = get_repo()
    return repo.recent_scans(limit=20)

@router.get("/audit")
async def get_audit():
    repo = get_repo()
    entries = repo.list_audit()
    valid = repo.verify_chain()
    return {
        "entries": entries,
        "chain_valid": valid
    }

@router.get("/config")
async def get_config():
    return {
        "allow_browser_approval": bool(settings.ALLOW_BROWSER_APPROVAL),
        "air_gapped": bool(settings.AIR_GAPPED),
        "db_mode": settings.DB_MODE
    }

@router.post("/dev/simulate_badge")
async def simulate_badge(body: SimulateBadgeRequest):
    if not settings.ALLOW_BROWSER_APPROVAL:
        return JSONResponse(status_code=403, content={"error": "browser_approval_disabled"})

    repo = get_repo()
    fix_id = body.fix_id
    if not fix_id:
        pending = repo.get_pending_fix()
        fix_id = pending.get("fix_id") if pending else ""

    status_code, data = execute_approval(
        card_id=body.card_id,
        fix_id=fix_id,
        device_id="browser-sim"
    )
    return JSONResponse(status_code=status_code, content=data)

@router.post("/ask")
async def ask_endpoint(body: AskRequest):
    # Try Sentinel if available
    try:
        from app.sentinel import ask_sentinel
        return await ask_sentinel(body.question)
    except Exception as e:
        # Fallback template
        repo = get_repo()
        analysis = repo.get_analysis()
        if analysis:
            choke = analysis.get("choke_point", {}).get("id", "role_overpriv")
            return {
                "answer": f"Analysis shows {analysis.get('before', {}).get('path_count')} attack paths reaching the crown jewel, all passing through choke point {choke}.",
                "mode": "template",
                "model": "none",
                "grounded": True,
                "cited": [choke]
            }
        return {
            "answer": "No analysis has run yet. Run an analysis first to inspect attack paths.",
            "mode": "template",
            "model": "none",
            "grounded": True,
            "cited": []
        }
