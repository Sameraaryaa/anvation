#!/usr/bin/env python3
"""
tools/import_cloudgoat.py — CloudGoat Benchmark Importer for AEGIS-Graph
Inspects or imports scenarios from Rhino Security Labs CloudGoat into AEGIS-Graph.

Usage:
  python tools/import_cloudgoat.py --list
  python tools/import_cloudgoat.py --inspect ec2_ssrf
  python tools/import_cloudgoat.py --import-all
"""

import os
import sys
import json
import zipfile
import argparse
from pathlib import Path

DEFAULT_ZIP = Path(r"C:\Users\moune\Downloads\cloudgoat-abf1ba8f5e47d7ced750fdfa025d51c99f1a43ed.zip")
SCENARIOS_DIR = Path(__file__).resolve().parent.parent / "backend" / "scenarios"

def get_zip_path(custom_path=None) -> Path:
    if custom_path and Path(custom_path).exists():
        return Path(custom_path)
    if DEFAULT_ZIP.exists():
        return DEFAULT_ZIP
    # Look for any cloudgoat*.zip in Downloads
    downloads = Path(os.environ.get("USERPROFILE", "")) / "Downloads"
    matches = list(downloads.glob("cloudgoat*.zip"))
    if matches:
        return matches[0]
    raise FileNotFoundError("CloudGoat zip not found. Please provide --zip <path>")

def list_cloudgoat_scenarios(zip_path: Path):
    with zipfile.ZipFile(zip_path, 'r') as z:
        scenarios = set()
        for name in z.namelist():
            if "scenarios/aws/" in name:
                parts = name.split("scenarios/aws/")[1].split("/")
                if parts[0] and parts[0] != "scenario_template" and not parts[0].endswith(".py"):
                    scenarios.add(parts[0])
    return sorted(list(scenarios))

def inspect_scenario(zip_path: Path, scenario_name: str):
    with zipfile.ZipFile(zip_path, 'r') as z:
        readme_matches = [n for n in z.namelist() if f"scenarios/aws/{scenario_name}/README.md" in n]
        if not readme_matches:
            print(f"[-] No README found for scenario: {scenario_name}")
            return
        content = z.read(readme_matches[0]).decode('utf-8', errors='replace')
        print(f"\n{'='*70}\n Scenario: {scenario_name} (from CloudGoat)\n{'='*70}\n")
        print(content[:2500])
        if len(content) > 2500:
            print("\n... [truncated] ...")

def import_prebuilt_cloudgoat():
    SCENARIOS_DIR.mkdir(parents=True, exist_ok=True)
    imported = []
    
    # Check what CloudGoat scenarios are in backend/scenarios
    for f in SCENARIOS_DIR.glob("cloudgoat_*.json"):
        imported.append(f.stem)
    
    print(f"[+] Currently active CloudGoat benchmark scenarios in AEGIS-Graph:")
    for sc in imported:
        print(f"    - {sc}")
    print(f"[+] All scenarios are loaded automatically into GET /api/scenarios.")

def main():
    parser = argparse.ArgumentParser(description="AEGIS-Graph CloudGoat Scenario Importer")
    parser.add_argument("--zip", help="Path to CloudGoat zip file", default=None)
    parser.add_argument("--list", action="store_true", help="List all AWS scenarios in CloudGoat zip")
    parser.add_argument("--inspect", help="View README and attack flow for a specific scenario")
    parser.add_argument("--status", action="store_true", help="Show currently loaded CloudGoat scenarios")
    
    args = parser.parse_args()

    try:
        zp = get_zip_path(args.zip)
    except FileNotFoundError as e:
        print(f"[-] {e}")
        return

    if args.list:
        print(f"[+] Found CloudGoat archive: {zp.name}")
        scenarios = list_cloudgoat_scenarios(zp)
        print(f"[+] Total AWS Scenarios available ({len(scenarios)}):")
        for sc in scenarios:
            print(f"    - {sc}")
    elif args.inspect:
        inspect_scenario(zp, args.inspect)
    else:
        import_prebuilt_cloudgoat()

if __name__ == "__main__":
    main()
