import os
import json
from pathlib import Path
from typing import List, Dict
from app.models import Scenario

def get_scenarios_dir() -> Path:
    current = Path(__file__).resolve().parent
    # Check possible scenarios directories
    candidates = [
        current.parent.parent / "scenarios",
        current.parent.parent.parent / "backend" / "scenarios",
        Path("backend/scenarios"),
        Path("scenarios"),
    ]
    for p in candidates:
        if p.exists() and p.is_dir():
            return p.resolve()
    # Default fallback
    return (current.parent.parent / "scenarios").resolve()

def load_scenario(name: str) -> Scenario:
    # Strip extension if passed
    if name.endswith(".json"):
        name = name[:-5]
    scenarios_dir = get_scenarios_dir()
    file_path = scenarios_dir / f"{name}.json"
    if not file_path.exists():
        raise FileNotFoundError(f"Scenario '{name}' not found at {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return Scenario.model_validate(data)

def list_scenarios() -> List[Dict[str, str]]:
    scenarios_dir = get_scenarios_dir()
    results = []
    if not scenarios_dir.exists():
        return results
    for f in scenarios_dir.glob("*.json"):
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
                results.append({
                    "id": data.get("scenario", f.stem),
                    "display_name": data.get("display_name", f.stem)
                })
        except Exception:
            results.append({"id": f.stem, "display_name": f.stem})
    return sorted(results, key=lambda x: x["id"])

def save_scenario(data: dict) -> Scenario:
    if "scenario" not in data or not data["scenario"]:
        raise ValueError("Missing 'scenario' ID field")
    sc_id = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in str(data["scenario"]).lower().strip())
    data["scenario"] = sc_id
    if "display_name" not in data or not data["display_name"]:
        data["display_name"] = sc_id.replace("_", " ").title()

    scenario = Scenario.model_validate(data)
    scenarios_dir = get_scenarios_dir()
    scenarios_dir.mkdir(parents=True, exist_ok=True)
    file_path = scenarios_dir / f"{scenario.scenario}.json"
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(scenario.model_dump(by_alias=True), f, indent=2)
    return scenario

