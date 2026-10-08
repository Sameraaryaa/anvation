import time
from typing import Dict, Any, List, Tuple, Set, Optional
import networkx as nx
from app.models import (
    Scenario, Analysis, AnalysisNode, AnalysisEdge, AnalysisPath,
    ChokePoint, RecommendedFix, BeforeAfter, AnalysisTimings
)
from app.engine.graph import build_graph
from app.engine.analysis import analyze_graph

def find_mincut_fixes(scenario: Scenario, G: nx.DiGraph) -> Tuple[List[str], List[Tuple[str, str]]]:
    entry = scenario.entry_points[0]
    jewel = scenario.crown_jewels[0]

    if entry not in G or jewel not in G or not nx.has_path(G, entry, jewel):
        return [], []

    H = nx.DiGraph()
    for a, b, d in G.edges(data=True):
        # 1 if fixable else 1000
        cap = 1 if d.get("fixable") else 1000
        H.add_edge(a, b, capacity=cap)

    cut_val, (S, T) = nx.minimum_cut(H, entry, jewel)
    cut_edges = [(a, b) for a, b in H.edges() if a in S and b in T]

    # Check if cut has non-fixable edge (capacity >= 1000)
    has_non_fixable = any(not G[a][b].get("fixable") for a, b in cut_edges)

    fix_ids = []
    if not has_non_fixable and cut_val < 1000:
        for a, b in cut_edges:
            f = G[a][b].get("fix")
            if f and f not in fix_ids:
                fix_ids.append(f)
        return fix_ids, cut_edges

    # Fallback: greedy hitting-set
    # Repeatedly remove the fixable edge that lies on the most remaining paths
    remaining_paths = list(nx.all_simple_paths(G, entry, jewel))
    chosen_fixes = []
    chosen_edges = []

    while remaining_paths:
        # Count frequency of fixable edges
        edge_counts: Dict[Tuple[str, str], int] = {}
        for p in remaining_paths:
            for i in range(len(p) - 1):
                edge = (p[i], p[i+1])
                if G[edge[0]][edge[1]].get("fixable"):
                    edge_counts[edge] = edge_counts.get(edge, 0) + 1

        if not edge_counts:
            break  # No more fixable edges

        # Pick edge with max path coverage
        best_edge = max(edge_counts.items(), key=lambda x: x[1])[0]
        chosen_edges.append(best_edge)
        f = G[best_edge[0]][best_edge[1]].get("fix")
        if f and f not in chosen_fixes:
            chosen_fixes.append(f)

        # Filter remaining paths
        remaining_paths = [p for p in remaining_paths if not any(
            (p[i], p[i+1]) == best_edge for i in range(len(p) - 1)
        )]

    if chosen_fixes:
        return chosen_fixes, chosen_edges

    # Autonomous Remediation Synthesis:
    # If no pre-tagged fixable edges exist, compute optimal min-cut on G
    H_uniform = nx.DiGraph()
    for a, b in G.edges():
        H_uniform.add_edge(a, b, capacity=1)
    _, (S_u, T_u) = nx.minimum_cut(H_uniform, entry, jewel)
    auto_cut_edges = [(a, b) for a, b in H_uniform.edges() if a in S_u and b in T_u and G.has_edge(a, b)]
    if not auto_cut_edges:
        p = list(nx.all_simple_paths(G, entry, jewel))[0]
        auto_cut_edges = [(p[-2], p[-1])]

    # Look for existing fix in scenario.remediations that covers any cut edge or has empty removes_edges
    found_fid = None
    for fid, r in scenario.remediations.items():
        if r.removes_edges and any(tuple(e) in auto_cut_edges for e in r.removes_edges):
            found_fid = fid
            break
        elif not r.removes_edges:
            r.removes_edges = [list(e) for e in auto_cut_edges]
            found_fid = fid
            break

    if not found_fid:
        if scenario.remediations:
            first_key = list(scenario.remediations.keys())[0]
            scenario.remediations[first_key].removes_edges = [list(e) for e in auto_cut_edges]
            found_fid = first_key
        else:
            clean_sc = "".join(c if c.isalnum() else "_" for c in scenario.scenario).strip("_")
            found_fid = f"remediate_{clean_sc}"
            from app.models import Remediation
            u_node = auto_cut_edges[0][0]
            v_node = auto_cut_edges[0][1]
            scenario.remediations[found_fid] = Remediation(
                title=f"Sever Attack Path: {u_node} -> {v_node}",
                detail=f"Automated least-privilege scoping revoking unauthorized path between {u_node} and {v_node}.",
                removes_edges=[list(e) for e in auto_cut_edges],
                iam_before={"Effect": "Allow", "Action": "*", "Resource": "*"},
                iam_after={"Effect": "Deny", "Action": "*", "Resource": f"arn:aws:::resource/{v_node}"},
                terraform_after=f"# AEGIS Auto-Remediation\n# Severed {u_node} -> {v_node}\n",
                rego=f"package aegis.policy\ndeny[msg] {{ input.target == \"{v_node}\"; msg := \"Path severed\" }}"
            )

    # Tag edges in G
    for a, b in auto_cut_edges:
        G[a][b]["fixable"] = True
        G[a][b]["fix"] = found_fid

    return [found_fid], auto_cut_edges

def run_full_analysis(scenario: Scenario) -> Analysis:
    t0 = time.perf_counter()
    G = build_graph(scenario)
    entry = scenario.entry_points[0]
    jewel = scenario.crown_jewels[0]

    before = analyze_graph(scenario, G)
    fix_ids, cut_edges = find_mincut_fixes(scenario, G)

    # Determine choke point:
    # Section 3.3: Choke point = tail node of the min-cut edge if it is a dominator;
    # otherwise the dominator with highest betweenness centrality.
    tails = [a for a, b in cut_edges if a in before["dominators"]]
    bc = before["raw_bc"]
    if tails:
        choke_node_id = tails[0]
    elif before["dominators"]:
        choke_node_id = max(before["dominators"], key=lambda n: bc.get(n, 0))
    else:
        choke_node_id = None

    # Counterfactual graph
    H = G.copy()
    for fid in fix_ids:
        remed = scenario.remediations.get(fid)
        if remed:
            for a, b in remed.removes_edges:
                if H.has_edge(a, b):
                    H.remove_edge(a, b)

    after = analyze_graph(scenario, H)

    # If paths still remain, greedy fallback until 0 paths
    if after["path_count"] > 0:
        more_fixes, _ = find_mincut_fixes(scenario, H)
        for fid in more_fixes:
            if fid not in fix_ids:
                fix_ids.append(fid)
                remed = scenario.remediations.get(fid)
                if remed:
                    for a, b in remed.removes_edges:
                        if H.has_edge(a, b):
                            H.remove_edge(a, b)
        after = analyze_graph(scenario, H)

    # Blast reduction percentage
    if before["blast_weighted"] > 0:
        blast_reduction_pct = round(100 * (before["blast_weighted"] - after["blast_weighted"]) / before["blast_weighted"])
    else:
        blast_reduction_pct = 0

    elapsed_ms = max(1, round((time.perf_counter() - t0) * 1000))

    # Build node map & AnalysisNodes
    node_dict = {n.id: n for n in scenario.nodes}
    choke_point_obj = None
    if choke_node_id and choke_node_id in node_dict:
        choke_point_obj = ChokePoint(
            id=choke_node_id,
            label=node_dict[choke_node_id].label or choke_node_id
        )

    # Check which nodes are on paths
    on_path_nodes: Set[str] = set()
    for p in before["paths"]:
        for n in p["nodes"]:
            on_path_nodes.add(n)

    reachable_nodes = (nx.descendants(G, entry) | {entry}) if entry in G else set()

    analysis_nodes = []
    for n in scenario.nodes:
        an = AnalysisNode(
            id=n.id,
            label=n.label or n.id,
            type=n.type,
            entry=n.id in scenario.entry_points,
            crown_jewel=n.id in scenario.crown_jewels,
            choke=n.id == choke_node_id,
            dominator=n.id in before["dominators"],
            on_path=n.id in on_path_nodes,
            reachable=n.id in reachable_nodes,
            misconfig=n.misconfig if n.misconfig else None,
            privilege=n.privilege,
            value=n.value,
            name_ref=n.name_ref,
            sensitivity=n.sensitivity,
            public=bool(n.public),
            exposed=bool(n.exposed),
        )
        analysis_nodes.append(an)

    # Build AnalysisEdges
    # Map edge to path ids
    edge_paths_map: Dict[Tuple[str, str], List[int]] = {}
    for p in before["paths"]:
        p_id = p["id"]
        for i in range(len(p["nodes"]) - 1):
            e = (p["nodes"][i], p["nodes"][i+1])
            edge_paths_map.setdefault(e, []).append(p_id)

    analysis_edges = []
    for e in scenario.edges:
        u = e.from_
        v = e.to
        edge_id = f"{u}->{v}"
        ae = AnalysisEdge(
            id=edge_id,
            source=u,
            target=v,
            type=e.type,
            technique=e.technique,
            difficulty=e.difficulty,
            fixable=bool(e.fixable),
            fix=e.fix,
            paths=edge_paths_map.get((u, v), []),
            removed=False,
        )
        analysis_edges.append(ae)

    # Build RecommendedFixes
    recommended_fixes = []
    for fid in fix_ids:
        r = scenario.remediations.get(fid)
        if r:
            rf = RecommendedFix(
                fix_id=fid,
                title=r.title,
                detail=r.detail,
                iam_before=r.iam_before,
                iam_after=r.iam_after,
                terraform_after=r.terraform_after,
                rego=r.rego,
                removes_edges=r.removes_edges,
            )
            recommended_fixes.append(rf)

    analysis_paths = [AnalysisPath(**p) for p in before["paths"]]

    return Analysis(
        scenario=scenario.scenario,
        display_name=scenario.display_name,
        applied=False,
        nodes=analysis_nodes,
        edges=analysis_edges,
        paths=analysis_paths,
        paths_before=None,
        choke_point=choke_point_obj,
        dominators=before["dominators"],
        recommended_fixes=recommended_fixes,
        before=BeforeAfter(
            path_count=before["path_count"],
            risk=before["risk"],
            blast_count=before["blast_count"],
            blast_weighted=before["blast_weighted"]
        ),
        after=BeforeAfter(
            path_count=after["path_count"],
            risk=after["risk"],
            blast_count=after["blast_count"],
            blast_weighted=after["blast_weighted"]
        ),
        blast_reduction_pct=blast_reduction_pct,
        timings=AnalysisTimings(analysis_ms=elapsed_ms)
    )

def apply_fixes(analysis: Analysis, scenario: Scenario) -> Analysis:
    """Applies recommended fixes to produce the post-approval Analysis state."""
    # Find all edges to remove
    edges_to_remove: Set[Tuple[str, str]] = set()
    for rf in analysis.recommended_fixes:
        for u, v in rf.removes_edges:
            edges_to_remove.add((u, v))

    # Copy and rebuild graph without removed edges
    G = build_graph(scenario)
    for u, v in edges_to_remove:
        if G.has_edge(u, v):
            G.remove_edge(u, v)

    entry = scenario.entry_points[0]
    after_reachable = (nx.descendants(G, entry) | {entry}) if entry in G else set()

    # Update node reachability
    new_nodes = []
    for n in analysis.nodes:
        n_copy = n.model_copy()
        n_copy.reachable = n.id in after_reachable
        new_nodes.append(n_copy)

    # Update edge removed flags
    new_edges = []
    for e in analysis.edges:
        e_copy = e.model_copy()
        if (e.source, e.target) in edges_to_remove:
            e_copy.removed = True
        new_edges.append(e_copy)

    # Preserve old paths in paths_before, empty out current paths
    paths_before = analysis.paths_before if analysis.paths_before else analysis.paths

    return Analysis(
        scenario=analysis.scenario,
        display_name=analysis.display_name,
        applied=True,
        nodes=new_nodes,
        edges=new_edges,
        paths=[],
        paths_before=paths_before,
        choke_point=analysis.choke_point,
        dominators=analysis.dominators,
        recommended_fixes=analysis.recommended_fixes,
        before=analysis.before,
        after=analysis.after,
        blast_reduction_pct=analysis.blast_reduction_pct,
        timings=analysis.timings
    )
