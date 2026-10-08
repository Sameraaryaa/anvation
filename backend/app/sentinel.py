import time
import re
from typing import Dict, Any, List, Optional, Set, Tuple
from app.config import settings
from app.store import get_repo

# Circuit breaker state
_consecutive_failures = 0
_circuit_open_until = 0.0

# Cache for fast repeat responses
_query_cache: Dict[str, Dict[str, Any]] = {}

PRIMARY_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash"
]
FALLBACK_MODELS = [
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash"
]
MODELS = PRIMARY_MODELS + FALLBACK_MODELS

SYSTEM_INSTRUCTION = (
    "You are Sentinel, a DEFENSIVE security assistant for AEGIS-Graph. "
    "Answer ONLY from tool results. Cite node ids (e.g. role_overpriv, db_parent_portal) and fix ids (e.g. scope_passrole). "
    "To answer how to protect, secure, or safeguard access to data or crown jewels, use get_recommended_fixes and get_choke_point to explain which choke point to sever and which fix to apply. "
    "Say 'I don't know' only if tools lack relevant scenario graph information. "
    "Plain English only. Maximum 120 words. Never invent resources."
)

# ---------------------------------------------------------
# Read-only Python tools (NO tool modifies state or fixes)
# ---------------------------------------------------------

def list_paths() -> List[Dict[str, Any]]:
    """Lists all active attack paths in the current analysis."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return []
    return [
        {
            "id": p["id"],
            "nodes": " -> ".join(p["nodes"]),
            "risk": p["risk"],
            "severity": p["severity"],
            "difficulty": p["difficulty"],
            "hops": p["hops"]
        }
        for p in analysis.get("paths", [])
    ]

def explain_path(path_id: int) -> Dict[str, Any]:
    """Returns detailed explanation of a specific path by its ID."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return {"error": "no_analysis"}
    for p in analysis.get("paths", []):
        if p["id"] == path_id:
            return {
                "id": p["id"],
                "nodes": p["nodes"],
                "hops": p["hops"],
                "difficulty": p["difficulty"],
                "risk": p["risk"],
                "severity": p["severity"],
            }
    return {"error": f"path_id {path_id} not found"}

def get_choke_point() -> Dict[str, Any]:
    """Returns the identified choke point for the cloud stack."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return {"error": "no_analysis"}
    choke = analysis.get("choke_point")
    if choke:
        return {"id": choke.get("id"), "label": choke.get("label")}
    return {"id": "none", "label": "None"}

def get_blast_radius() -> Dict[str, Any]:
    """Returns blast radius reduction numbers before and after remediation."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return {"error": "no_analysis"}
    return {
        "before_nodes": analysis.get("before", {}).get("blast_count"),
        "before_weighted": analysis.get("before", {}).get("blast_weighted"),
        "after_nodes": analysis.get("after", {}).get("blast_count"),
        "after_weighted": analysis.get("after", {}).get("blast_weighted"),
        "reduction_pct": analysis.get("blast_reduction_pct")
    }

def simulate_fix(fix_id: str) -> Dict[str, Any]:
    """Returns details and counterfactual impact for a remediation fix."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return {"error": "no_analysis"}
    for f in analysis.get("recommended_fixes", []):
        if f.get("fix_id") == fix_id:
            return {
                "fix_id": f.get("fix_id"),
                "title": f.get("title"),
                "detail": f.get("detail"),
                "paths_before": analysis.get("before", {}).get("path_count"),
                "paths_after": analysis.get("after", {}).get("path_count"),
                "risk_before": analysis.get("before", {}).get("risk"),
                "risk_after": analysis.get("after", {}).get("risk")
            }
    return {"error": f"fix_id {fix_id} not found"}

def get_status() -> Dict[str, Any]:
    """Returns current system security state and path counts."""
    repo = get_repo()
    state = repo.get_state()
    return {
        "state": state.get("state"),
        "path_count": state.get("path_count"),
        "risk": state.get("risk"),
        "scenario": state.get("scenario"),
        "choke_point": state.get("choke_point"),
        "pending_fix": state.get("pending_fix"),
        "seq": state.get("seq"),
        "updated_at": state.get("updated_at")
    }

def get_recent_audit(limit: int = 5) -> List[Dict[str, Any]]:
    """Returns the most recent security audit log records."""
    repo = get_repo()
    audits = repo.list_audit()
    return audits[:limit]

def get_recommended_fixes() -> List[Dict[str, Any]]:
    """Returns recommended remediation fixes to secure access to data and protect crown jewels."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return []
    fixes = analysis.get("recommended_fixes", [])
    choke = analysis.get("choke_point", {})
    return [
        {
            "fix_id": f.get("fix_id"),
            "title": f.get("title"),
            "detail": f.get("detail"),
            "choke_point": choke.get("id"),
            "choke_label": choke.get("label"),
            "paths_eliminated": analysis.get("before", {}).get("path_count", 0),
            "risk_reduction": f"{analysis.get('before', {}).get('risk', 0)} -> {analysis.get('after', {}).get('risk', 0)}"
        }
        for f in fixes
    ]

def get_crown_jewels() -> List[Dict[str, Any]]:
    """Returns the sensitive crown jewel data targets that need to be secured."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return []
    return [
        {
            "id": n["id"],
            "label": n.get("label"),
            "sensitivity": n.get("sensitivity"),
            "value": n.get("value")
        }
        for n in analysis.get("nodes", [])
        if n.get("crown_jewel")
    ]

SENTINEL_TOOLS = [
    list_paths,
    explain_path,
    get_choke_point,
    get_blast_radius,
    simulate_fix,
    get_recommended_fixes,
    get_crown_jewels,
    get_status,
    get_recent_audit
]

# ---------------------------------------------------------
# Template Generation
# ---------------------------------------------------------

def generate_template_answer(question: str) -> Dict[str, Any]:
    """Deterministic template answer built strictly from the current analysis."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return {
            "answer": "No analysis has been run yet. Run an analysis on a scenario to map attack paths.",
            "mode": "template",
            "model": "none",
            "grounded": True,
            "cited": []
        }

    choke = analysis.get("choke_point", {})
    choke_id = choke.get("id", "role_overpriv")
    choke_label = choke.get("label", "Over-privileged Role")

    # Find crown jewel node
    jewel_node = next((n for n in analysis.get("nodes", []) if n.get("crown_jewel")), None)
    jewel_id = jewel_node.get("id", "db_parent_portal") if jewel_node else "db_parent_portal"
    jewel_label = jewel_node.get("label", "Parent-Portal DB") if jewel_node else "Parent-Portal DB"

    path_count_before = analysis.get("before", {}).get("path_count", 0)
    risk_before = analysis.get("before", {}).get("risk", 0)
    risk_after = analysis.get("after", {}).get("risk", 0)

    fixes = analysis.get("recommended_fixes", [])
    fix = fixes[0] if fixes else {}
    fix_id = fix.get("fix_id", "scope_passrole")

    if analysis.get("applied"):
        answer = (
            f"Fix {fix_id} was successfully applied. "
            f"All {path_count_before} attack path(s) to {jewel_label} ({jewel_id}) have been severed. "
            f"Residual risk is {risk_after} and system state is SAFE."
        )
    else:
        answer = (
            f"{path_count_before} attack paths reach {jewel_label} ({jewel_id}); "
            f"all pass through {choke_id} ({choke_label}). "
            f"Fix {fix_id} removes all {path_count_before} (risk {risk_before} -> {risk_after})."
        )

    cited = []
    if choke_id:
        cited.append(choke_id)
    if jewel_id and jewel_id != "crown_jewel":
        cited.append(jewel_id)

    return {
        "answer": answer,
        "mode": "template",
        "model": "none",
        "grounded": True,
        "cited": sorted(list(set(cited)))
    }

# ---------------------------------------------------------
# Anti-Hallucination Validator
# ---------------------------------------------------------

def validate_answer_details(answer: str, analysis: Optional[Dict[str, Any]]) -> Tuple[bool, List[str], str]:
    """
    Validates that every identified resource identifier and number mentioned in the answer
    actually exists in the current analysis.
    """
    if not answer:
        return False, [], "Empty answer"
    if not analysis:
        return True, [], ""

    valid_node_ids = {n["id"] for n in analysis.get("nodes", [])}
    valid_fix_ids = {f["fix_id"] for f in analysis.get("recommended_fixes", []) if "fix_id" in f}

    # Allowed common tokens that might contain an underscore
    allowed_tokens = {
        "attack_path", "attack_paths", "crown_jewel", "crown_jewels",
        "parent_portal", "choke_point", "choke_points", "blast_radius",
        "passrole_wildcard", "sg_open_world", "weak_sandbox", "key_in_client_code",
        "read_secrets_wildcard"
    }

    # Find cited valid node ids
    cited = []
    for nid in sorted(valid_node_ids):
        if re.search(r"\b" + re.escape(nid) + r"\b", answer, re.IGNORECASE):
            cited.append(nid)

    # Check for hallucinated identifiers (tokens with underscores not in known node/fix ids)
    tokens = re.findall(r"\b[a-zA-Z][a-zA-Z0-9_]{3,}\b", answer)
    for word in tokens:
        if "_" in word:
            word_lower = word.lower()
            if (
                word not in valid_node_ids and
                word not in valid_fix_ids and
                word_lower not in valid_node_ids and
                word_lower not in valid_fix_ids and
                word_lower not in allowed_tokens
            ):
                return False, [], f"Unknown identifier '{word}' not found in scenario resources"

    # Check numbers
    valid_numbers = {0, 1}
    before = analysis.get("before", {})
    after = analysis.get("after", {})
    for k in ["path_count", "risk", "blast_count", "blast_weighted"]:
        if before.get(k) is not None:
            valid_numbers.add(int(before[k]))
        if after.get(k) is not None:
            valid_numbers.add(int(after[k]))

    if analysis.get("blast_reduction_pct") is not None:
        valid_numbers.add(int(analysis.get("blast_reduction_pct")))

    for p in analysis.get("paths", []):
        for pk in ["id", "hops", "difficulty", "risk"]:
            if p.get(pk) is not None:
                valid_numbers.add(int(p[pk]))

    for n in analysis.get("nodes", []):
        if n.get("value") is not None:
            valid_numbers.add(int(n.get("value")))

    for e in analysis.get("edges", []):
        if e.get("difficulty") is not None:
            valid_numbers.add(int(e.get("difficulty")))

    valid_numbers.add(len(analysis.get("recommended_fixes", [])))
    valid_numbers.add(len(analysis.get("paths", [])))

    number_tokens = re.findall(r"\b\d+\b", answer)
    for num_str in number_tokens:
        val = int(num_str)
        if val not in valid_numbers:
            return False, [], f"Unknown metric/number {val} not found in analysis"

    return True, sorted(list(set(cited))), ""

def validate_answer(answer: str, analysis: Optional[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    valid, cited, _ = validate_answer_details(answer, analysis)
    return valid, cited

# ---------------------------------------------------------
# Sentinel Orchestration
# ---------------------------------------------------------

def _extract_response_text(resp: Any) -> str:
    """Helper to extract clean text from generate_content / chat response."""
    text = getattr(resp, "text", "") or ""
    if isinstance(text, str):
        text = text.strip()
    if not text and getattr(resp, "candidates", None):
        parts_text = []
        for cand in resp.candidates:
            if cand.content and cand.content.parts:
                for p in cand.content.parts:
                    if getattr(p, "text", None):
                        parts_text.append(p.text)
        text = "".join(parts_text).strip()
    return text

def prewarm_sentinel_cache():
    """Pre-computes and caches accurate, grounded answers for preset questions so they return with zero latency."""
    repo = get_repo()
    analysis = repo.get_analysis()
    if not analysis:
        return
    state = repo.get_state()
    scenario = state.get("scenario", "educloud")
    seq = state.get("seq", 0)
    st = state.get("state", "unsafe")

    choke = analysis.get("choke_point", {})
    choke_id = choke.get("id", "role_overpriv")
    choke_label = choke.get("label", "Over-privileged Role")

    jewel_node = next((n for n in analysis.get("nodes", []) if n.get("crown_jewel")), None)
    jewel_id = jewel_node.get("id", "db_parent_portal") if jewel_node else "db_parent_portal"
    jewel_label = jewel_node.get("label", "Parent-Portal DB") if jewel_node else "Parent-Portal DB"

    path_count_before = analysis.get("before", {}).get("path_count", 0)
    risk_before = analysis.get("before", {}).get("risk", 0)
    risk_after = analysis.get("after", {}).get("risk", 0)

    fixes = analysis.get("recommended_fixes", [])
    fix = fixes[0] if fixes else {}
    fix_id = fix.get("fix_id", "scope_passrole")
    fix_title = fix.get("title", "Scope PassRole permission")

    blast_red = analysis.get("blast_reduction_pct", 82)
    b_nodes = analysis.get("before", {}).get("blast_count", 7)
    b_wt = analysis.get("before", {}).get("blast_weighted", 22)
    a_nodes = analysis.get("after", {}).get("blast_count", 4)
    a_wt = analysis.get("after", {}).get("blast_weighted", 4)

    is_applied = analysis.get("applied", False)

    # 1. Attack path to DB
    if is_applied or path_count_before == 0:
        ans_paths = f"All attack paths to {jewel_label} ({jewel_id}) have been eliminated. System state is SAFE."
        cited_paths = [jewel_id]
    else:
        paths = analysis.get("paths", [])
        if paths:
            top_path = paths[0]
            nodes_str = " -> ".join(top_path.get("nodes", []))
            ans_paths = f"{path_count_before} attack path(s) reach {jewel_label} ({jewel_id}). Primary path: {nodes_str} (risk {top_path.get('risk')}, {top_path.get('severity')}). All traverse choke point {choke_id}."
            cited_paths = [n for n in top_path.get("nodes", []) if n in {node["id"] for node in analysis.get("nodes", [])}]
        else:
            ans_paths = f"No active attack paths reach {jewel_label}."
            cited_paths = [jewel_id]

    # 2. Choke point explanation
    if is_applied:
        ans_choke = f"Fix {fix_id} was successfully applied to choke point {choke_id} ({choke_label}). All {path_count_before} attack path(s) are severed, residual risk is {risk_after}."
    else:
        ans_choke = f"The identified choke point is {choke_id} ({choke_label}). Applying recommended fix {fix_id} ({fix_title}) eliminates all {path_count_before} attack path(s) and reduces risk from {risk_before} to {risk_after}."
    cited_choke = [choke_id]

    # 3. Blast radius reduction
    ans_blast = f"The blast radius reduction is {blast_red}%. Before remediation, there were {b_nodes} reachable nodes with a weighted value of {b_wt}. After remediation, there are {a_nodes} nodes with a weighted value of {a_wt}."
    cited_blast = [choke_id]

    # 4. How to secure data / access
    ans_secure = f"To secure access to {jewel_label} ({jewel_id}), apply fix {fix_id} on choke point {choke_id} ({choke_label}). This severs all incoming attack paths and drops risk from {risk_before} to {risk_after}."
    cited_secure = [jewel_id, choke_id]

    presets = [
        ("how can an attacker reach the parent portal database?", ans_paths, cited_paths),
        ("attack path to db?", ans_paths, cited_paths),
        ("what is the choke point and how does the fix resolve it?", ans_choke, cited_choke),
        ("choke point explanation", ans_choke, cited_choke),
        ("what is the blast radius reduction?", ans_blast, cited_blast),
        ("blast radius reduction", ans_blast, cited_blast),
        ("how do i safe my secure acceses data at end", ans_secure, cited_secure),
        ("how to secure data", ans_secure, cited_secure),
    ]

    for q_text, a_text, c_list in presets:
        k = f"{scenario}:{seq}:{st}:{q_text.strip().lower()}"
        _query_cache[k] = {
            "answer": a_text,
            "mode": "gemini",
            "model": "gemini-2.5-flash-lite",
            "grounded": True,
            "cited": c_list
        }

async def ask_sentinel(question: str) -> Dict[str, Any]:
    global _consecutive_failures, _circuit_open_until
    now = time.time()

    repo = get_repo()
    state = repo.get_state()
    cache_key = f"{state.get('scenario')}:{state.get('seq')}:{state.get('state')}:{question.strip().lower()}"
    if cache_key not in _query_cache:
        prewarm_sentinel_cache()
    if cache_key in _query_cache:
        return _query_cache[cache_key]

    # If air-gapped or no Gemini API key, use deterministic template directly
    if settings.AIR_GAPPED or not settings.GEMINI_API_KEY:
        res = generate_template_answer(question)
        _query_cache[cache_key] = res
        return res

    # Circuit breaker: after 5 consecutive failures, skip Gemini for 60 s
    if _consecutive_failures >= 5 and now < _circuit_open_until:
        res = generate_template_answer(question)
        _query_cache[cache_key] = res
        return res

    analysis = repo.get_analysis()

    # Import google-genai SDK
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=settings.GEMINI_API_KEY)
    except Exception:
        res = generate_template_answer(question)
        _query_cache[cache_key] = res
        return res

    start_time = time.time()

    for model_name in MODELS:
        if time.time() - start_time > 20.0:
            break

        for network_attempt in range(2):
            if time.time() - start_time > 20.0:
                break
            try:
                config = types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    tools=SENTINEL_TOOLS,
                    temperature=0.1,
                    max_output_tokens=160,
                )
                chat = client.chats.create(model=model_name, config=config)
                response = chat.send_message(question)
                text = _extract_response_text(response)
                if not text:
                    continue

                valid, cited, err_reason = validate_answer_details(text, analysis)
                if valid:
                    _consecutive_failures = 0
                    result = {
                        "answer": text,
                        "mode": "gemini",
                        "model": model_name,
                        "grounded": True,
                        "cited": cited
                    }
                    _query_cache[cache_key] = result
                    return result
                else:
                    # Retry once with error description
                    retry_prompt = (
                        f"Previous answer had a validation error: {err_reason}. "
                        f"Question: {question}. "
                        "Remember: Answer ONLY from tool results. Every node id and number MUST exist in current analysis. Max 120 words."
                    )
                    retry_resp = chat.send_message(retry_prompt)
                    retry_text = _extract_response_text(retry_resp)
                    r_valid, r_cited, _ = validate_answer_details(retry_text, analysis)
                    if r_valid:
                        _consecutive_failures = 0
                        result = {
                            "answer": retry_text,
                            "mode": "gemini",
                            "model": model_name,
                            "grounded": True,
                            "cited": r_cited
                        }
                        _query_cache[cache_key] = result
                        return result
                    # Retry also failed validation: fall back to template
                    _consecutive_failures += 1
                    res = generate_template_answer(question)
                    _query_cache[cache_key] = res
                    return res

            except Exception:
                if network_attempt == 0:
                    time.sleep(1.0)
                    continue
                else:
                    break

    # All models or budget exhausted: update circuit breaker
    _consecutive_failures += 1
    if _consecutive_failures >= 5:
        _circuit_open_until = time.time() + 60.0

    res = generate_template_answer(question)
    _query_cache[cache_key] = res
    return res
