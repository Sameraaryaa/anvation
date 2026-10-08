import pytest
from app.engine.loader import load_scenario
from app.engine.remediation import run_full_analysis, apply_fixes

def test_educloud_oracle_numbers():
    sc = load_scenario("educloud")
    analysis = run_full_analysis(sc)

    # Before numbers
    assert analysis.before.path_count == 3
    assert analysis.before.risk == 88
    assert analysis.before.blast_count == 7
    assert analysis.before.blast_weighted == 22

    # After numbers
    assert analysis.after.path_count == 0
    assert analysis.after.risk == 12
    assert analysis.after.blast_count == 4
    assert analysis.after.blast_weighted == 4
    assert analysis.blast_reduction_pct == 82

    # Choke point
    assert analysis.choke_point is not None
    assert analysis.choke_point.id == "role_overpriv"
    assert "Over-privileged Role" in analysis.choke_point.label

    # Recommended fix
    assert len(analysis.recommended_fixes) == 1
    assert analysis.recommended_fixes[0].fix_id == "scope_passrole"
    assert analysis.recommended_fixes[0].removes_edges == [["role_overpriv", "role_admin"]]

    # Path details
    paths = analysis.paths
    assert len(paths) == 3

    p1 = paths[0]
    assert p1.id == 1
    assert p1.nodes == ["internet", "leaked_key", "role_overpriv", "role_admin", "db_parent_portal"]
    assert p1.difficulty == 5
    assert p1.hops == 4
    assert p1.risk == 88
    assert p1.severity == "Critical"

    p2 = paths[1]
    assert p2.id == 2
    assert p2.nodes in [
        ["internet", "web_app", "role_overpriv", "role_admin", "db_parent_portal"],
        ["internet", "code_runner", "role_overpriv", "role_admin", "db_parent_portal"]
    ]
    assert p2.difficulty == 8
    assert p2.hops == 4
    assert p2.risk == 79
    assert p2.severity == "High"

    p3 = paths[2]
    assert p3.id == 3
    assert p3.difficulty == 8
    assert p3.hops == 4
    assert p3.risk == 79
    assert p3.severity == "High"

    # Counterfactual applied state
    post_app = apply_fixes(analysis, sc)
    assert post_app.applied is True
    assert len(post_app.paths) == 0
    assert len(post_app.paths_before) == 3
    # Removed edge flag
    removed_edge = next((e for e in post_app.edges if e.source == "role_overpriv" and e.target == "role_admin"), None)
    assert removed_edge is not None
    assert removed_edge.removed is True

def test_miniconfig_oracle_numbers():
    sc = load_scenario("miniconfig")
    analysis = run_full_analysis(sc)

    # Before numbers
    assert analysis.before.path_count == 1
    assert analysis.before.risk == 79
    assert analysis.before.blast_count == 3
    assert analysis.before.blast_weighted == 11

    # After numbers
    assert analysis.after.path_count == 0
    assert analysis.after.risk == 4
    assert analysis.after.blast_count == 2
    assert analysis.after.blast_weighted == 2
    assert analysis.blast_reduction_pct == 82

    # Choke point
    assert analysis.choke_point is not None
    assert analysis.choke_point.id == "role_lambda"
    assert "Lambda Role" in analysis.choke_point.label

    # Recommended fix
    assert len(analysis.recommended_fixes) == 1
    assert analysis.recommended_fixes[0].fix_id == "scope_secrets"

    # Apply fixes
    post_app = apply_fixes(analysis, sc)
    assert post_app.applied is True
    assert len(post_app.paths) == 0
    assert len(post_app.paths_before) == 1
