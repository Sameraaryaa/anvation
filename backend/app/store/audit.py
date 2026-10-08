import hashlib
import json
from typing import Dict, Any, List

def compute_audit_hash(prev_hash: str, entry: Dict[str, Any]) -> str:
    """
    Computes SHA-256 hash according to Section 6.3:
    this_hash = sha256((prev + json.dumps(entry, sort_keys=True)).encode()).hexdigest()
    """
    prev = prev_hash if prev_hash else "0" * 64
    payload = prev + json.dumps(entry, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

def verify_audit_chain(records: List[Dict[str, Any]]) -> bool:
    """
    Verifies that all audit records (in chronological order, id ascending)
    form an unbroken cryptographic hash chain.
    """
    if not records:
        return True

    expected_prev = "0" * 64
    for r in records:
        if r["prev_hash"] != expected_prev:
            return False

        # Parse entry_json
        entry = json.loads(r["entry_json"])
        computed = compute_audit_hash(expected_prev, entry)
        if computed != r["this_hash"]:
            return False

        expected_prev = r["this_hash"]

    return True
