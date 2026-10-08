from typing import Dict, Any, List, Set, Tuple
import networkx as nx
from app.models import Scenario

def weight(G: nx.DiGraph, n: str) -> int:
    d = G.nodes[n]
    if "value" in d and d["value"] is not None:
        return d["value"]
    if d.get("privilege") == "admin":
        return 4
    return 1

def compute_severity(risk: int) -> str:
    if risk >= 85:
        return "Critical"
    elif risk >= 70:
        return "High"
    elif risk >= 40:
        return "Medium"
    else:
        return "Low"

def analyze_graph(scenario: Scenario, G: nx.DiGraph) -> Dict[str, Any]:
    entry = scenario.entry_points[0]
    jewel = scenario.crown_jewels[0]

    if entry not in G or jewel not in G:
        raw_paths = []
    else:
        raw_paths = list(nx.all_simple_paths(G, entry, jewel))

    # Sort paths by difficulty ascending, ties: path tuple
    raw_paths.sort(key=lambda p: (sum(G[a][b].get("difficulty", 1) for a, b in zip(p, p[1:])), str(p)))

    doms: Set[str] = set()
    if raw_paths and entry in G and jewel in G:
        try:
            idom = nx.immediate_dominators(G, entry)
            n = jewel
            # Safe walk that works whether or not idom contains the start node
            while n != entry and n in idom:
                n = idom[n]
                if n != entry:
                    doms.add(n)
        except Exception:
            pass

    path_details = []
    for p in raw_paths:
        diff = sum(G[a][b].get("difficulty", 1) for a, b in zip(p, p[1:]))
        E = 1.0 if G.nodes[p[0]].get("exposed") else 0.4
        X = 1 / (1 + 0.05 * diff)
        I = G.nodes[jewel].get("value", 5) / 10
        C = 1.1 if doms & set(p[1:-1]) else 1.0
        risk = round(100 * E * X * I * C)
        sev = compute_severity(risk)
        path_details.append({
            "nodes": p,
            "difficulty": diff,
            "hops": len(p) - 1,
            "risk": risk,
            "severity": sev,
        })

    # Path id = 1-based index after sorting by risk descending, then difficulty ascending
    path_details.sort(key=lambda x: (-x["risk"], x["difficulty"], str(x["nodes"])))
    for idx, p in enumerate(path_details, start=1):
        p["id"] = idx

    reach = nx.descendants(G, entry) if entry in G else set()
    blast_count = len(reach)
    blast_weighted = sum(weight(G, n) for n in reach)

    if path_details:
        overall_risk = max(r["risk"] for r in path_details)
    else:
        successors_count = len(list(G.successors(entry))) if entry in G else 0
        overall_risk = min(30, 4 * successors_count)

    bc = nx.betweenness_centrality(G)
    betweenness = {k: round(v, 3) for k, v in bc.items() if v > 0}

    return {
        "path_count": len(path_details),
        "paths": path_details,
        "risk": overall_risk,
        "dominators": sorted(doms),
        "blast_count": blast_count,
        "blast_weighted": blast_weighted,
        "betweenness": betweenness,
        "raw_bc": bc,
    }
