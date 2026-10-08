import time
import json
import logging
from typing import Optional
from fastapi import APIRouter, Request, Header, HTTPException
from fastapi.responses import JSONResponse

from app.config import settings
from app.store import get_repo, normalize_uid
from app.models import (
    StatusResponse, PendingFixResponse, ApproveRequest, ScanRequest, HeartbeatRequest,
    Analysis
)
from app.engine.loader import load_scenario
from app.engine.remediation import apply_fixes

logger = logging.getLogger("aegis.device")

router = APIRouter(prefix="/api", tags=["device"])

def verify_device_key(request: Request):
    key = request.headers.get("X-Device-Key")
    if key != settings.DEVICE_KEY:
        raise HTTPException(status_code=401, detail="bad_device_key")

@router.get("/status", response_model=StatusResponse)
async def get_status():
    repo = get_repo()
    st = repo.get_state()
    return StatusResponse(
        state=st["state"],
        path_count=st["path_count"],
        risk=st["risk"],
        scenario=st["scenario"],
        choke_point=st["choke_point"],
        pending_fix=st["pending_fix"],
        seq=st["seq"],
        updated_at=st["updated_at"]
    )

@router.get("/pending_fix")
async def get_pending_fix():
    repo = get_repo()
    pfix = repo.get_pending_fix()
    if not pfix or not pfix.get("fix_id"):
        # Auto-heal pending fix from analysis if state is unsafe
        an = repo.get_analysis()
        st = repo.get_state()
        if an and an.get("recommended_fixes") and st.get("path_count", 0) > 0 and st.get("state") != "safe":
            top = an["recommended_fixes"][0]
            pfix = {
                "fix_id": top["fix_id"],
                "title": top["title"],
                "detail": top.get("detail", ""),
                "risk_before": an.get("before", {}).get("risk", 100),
                "risk_after": an.get("after", {}).get("risk", 0),
                "paths_before": an.get("before", {}).get("path_count", 1),
                "paths_after": an.get("after", {}).get("path_count", 0),
            }
            repo.set_pending_fix(pfix)
            return pfix
        return {"fix_id": None}
    return {
        "fix_id": pfix.get("fix_id"),
        "title": pfix.get("title"),
        "detail": pfix.get("detail"),
        "risk_before": pfix.get("risk_before"),
        "risk_after": pfix.get("risk_after"),
        "paths_before": pfix.get("paths_before"),
        "paths_after": pfix.get("paths_after")
    }

def execute_approval(card_id: str, fix_id: str, device_id: str):
    repo = get_repo()
    norm_card = normalize_uid(card_id)

    pending = repo.get_pending_fix()
    # Auto-heal pending fix if missing but analysis has fixes
    if not pending or not pending.get("fix_id"):
        an = repo.get_analysis()
        st = repo.get_state()
        if an and an.get("recommended_fixes") and st.get("path_count", 0) > 0 and st.get("state") != "safe":
            top = an["recommended_fixes"][0]
            pending = {
                "fix_id": top["fix_id"],
                "title": top["title"],
                "detail": top.get("detail", ""),
                "risk_before": an.get("before", {}).get("risk", 100),
                "risk_after": an.get("after", {}).get("risk", 0),
                "paths_before": an.get("before", {}).get("path_count", 1),
                "paths_after": an.get("after", {}).get("path_count", 0),
            }
            repo.set_pending_fix(pending)

    if not norm_card or not fix_id:
        return 400, {"applied": False, "reason": "card_id_and_fix_id_required"}

    if not pending or not pending.get("fix_id"):
        return 409, {"applied": False, "reason": "no_pending_fix"}

    if pending.get("fix_id") != fix_id:
        return 409, {"applied": False, "reason": "fix_mismatch", "pending_fix_id": pending.get("fix_id")}

    card = repo.get_card(norm_card)
    if not card:
        repo.add_scan(norm_card, device_id, False, None, "approve_denied")
        repo.append_audit("approve_denied", card_id=norm_card, device_id=device_id, fix_id=fix_id)
        return 403, {"applied": False, "reason": "unknown_card", "card_id": norm_card}

    approver = card.get("name", "Security Lead")
    # Apply fix to stored analysis
    analysis_dict = repo.get_analysis()
    if analysis_dict:
        try:
            scenario_id = analysis_dict.get("scenario")
            sc = load_scenario(scenario_id)
            analysis = Analysis.model_validate(analysis_dict)
            post_analysis = apply_fixes(analysis, sc)
            repo.set_analysis(post_analysis.model_dump())
            risk_after = post_analysis.after.risk
            path_count_after = post_analysis.after.path_count
        except Exception:
            risk_after = pending.get("risk_after", 12)
            path_count_after = pending.get("paths_after", 0)
    else:
        risk_after = pending.get("risk_after", 12)
        path_count_after = pending.get("paths_after", 0)

    state_str = "safe" if path_count_after == 0 else "unsafe"

    # Side effects
    repo.set_pending_fix(None)
    repo.set_state(increment_seq=True, state=state_str, path_count=path_count_after, risk=risk_after)

    repo.append_audit(
        "fix_applied",
        approver=approver,
        card_id=norm_card,
        fix_id=fix_id,
        device_id=device_id,
        paths_before=pending.get("paths_before"),
        paths_after=path_count_after,
        risk_before=pending.get("risk_before"),
        risk_after=risk_after
    )
    repo.add_scan(norm_card, device_id, True, approver, "approve")

    return 200, {
        "applied": True,
        "approver": approver,
        "fix_id": fix_id,
        "state": state_str,
        "path_count": path_count_after,
        "risk": risk_after
    }

@router.post("/approve")
async def approve_fix(request: Request, body: ApproveRequest):
    key = request.headers.get("X-Device-Key")
    if key != settings.DEVICE_KEY:
        return JSONResponse(status_code=401, content={"error": "bad_device_key"})

    status_code, data = execute_approval(
        card_id=body.card_id or "",
        fix_id=body.fix_id or "",
        device_id=body.device_id or "esp32-console-01"
    )
    return JSONResponse(status_code=status_code, content=data)

@router.post("/rfid/scan")
async def rfid_scan(request: Request, body: ScanRequest):
    key = request.headers.get("X-Device-Key")
    if key != settings.DEVICE_KEY:
        return JSONResponse(status_code=401, content={"error": "bad_device_key"})

    norm_card = normalize_uid(body.card_id or "")
    device_id = body.device_id or "esp32-console-01"
    repo = get_repo()
    card = repo.get_card(norm_card)

    known = card is not None
    name = card.get("name") if card else None

    repo.add_scan(norm_card, device_id, known, name, "scan")

    return {
        "known": known,
        "name": name,
        "card_id": norm_card
    }

@router.post("/device/heartbeat")
async def device_heartbeat(request: Request, body: HeartbeatRequest):
    key = request.headers.get("X-Device-Key")
    if key != settings.DEVICE_KEY:
        return JSONResponse(status_code=401, content={"error": "bad_device_key"})

    repo = get_repo()
    remote_ip = request.client.host if request.client else "unknown"
    repo.upsert_device(body.model_dump(), remote_ip)

    cmd = repo.pop_command(body.device_id) or "none"

    return {
        "ok": True,
        "command": cmd,
        "server_time": int(time.time())
    }

@router.post("/device/log")
@router.post("/device/logs")
async def post_device_log(request: Request):
    device_id = request.headers.get("X-Device-Id") or "esp32-console-01"
    level = "info"
    message = ""
    raw_json_str = ""

    try:
        body_bytes = await request.body()
        if body_bytes:
            body_str = body_bytes.decode("utf-8", errors="replace")
            try:
                data = json.loads(body_str)
                if isinstance(data, dict):
                    raw_json_str = body_str
                    device_id = str(data.get("device_id") or data.get("device") or data.get("id") or device_id)
                    level = str(data.get("level") or data.get("severity") or level)
                    message = str(data.get("message") or data.get("msg") or data.get("log") or data.get("text") or data.get("payload") or body_str)
                elif isinstance(data, list):
                    raw_json_str = body_str
                    message = json.dumps(data)
                else:
                    message = str(data)
            except Exception:
                message = body_str
                if "=" in body_str and not body_str.startswith("{"):
                    try:
                        from urllib.parse import parse_qs
                        parsed = parse_qs(body_str)
                        if "message" in parsed:
                            message = parsed["message"][0]
                        elif "msg" in parsed:
                            message = parsed["msg"][0]
                        elif "log" in parsed:
                            message = parsed["log"][0]
                        if "device_id" in parsed:
                            device_id = parsed["device_id"][0]
                    except Exception:
                        pass
    except Exception as e:
        message = f"Error reading log body: {e}"

    if not message and request.query_params:
        qp = dict(request.query_params)
        message = qp.get("msg") or qp.get("message") or qp.get("log") or str(qp)
        device_id = qp.get("device_id") or device_id

    if not message:
        message = "device_event"

    remote_ip = request.client.host if request.client else "unknown"
    logger.info(f"ESP32 Log [{device_id}@{remote_ip}] [{level.upper()}]: {message}")

    repo = get_repo()
    try:
        repo.add_device_log(device_id, level, message, raw_json_str)
    except Exception as e:
        logger.warning(f"Failed to persist device log: {e}")

    return {
        "ok": True,
        "status": "logged",
        "device_id": device_id,
        "ts": int(time.time())
    }

@router.get("/device/log")
@router.get("/device/logs")
async def get_device_logs(limit: int = 50, device_id: Optional[str] = None):
    repo = get_repo()
    logs = repo.get_device_logs(limit=limit, device_id=device_id)
    return {
        "ok": True,
        "logs": logs,
        "count": len(logs)
    }
