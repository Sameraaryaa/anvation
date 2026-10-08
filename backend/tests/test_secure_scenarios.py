import pytest
from pathlib import Path
from app.engine.loader import load_scenario
from app.engine.remediation import run_full_analysis
from app.engine.tf_parser import parse_terraform_to_scenario
from app.models import Scenario

def test_secure_cloud_json():
    sc = load_scenario("secure_cloud")
    analysis = run_full_analysis(sc)
    
    assert analysis.before.path_count == 0, "Secure cloud should have 0 attack paths"
    assert analysis.before.risk <= 10, "Secure cloud risk should be minimal"
    assert analysis.choke_point is None, "Secure cloud should have no choke point"
    assert len(analysis.recommended_fixes) == 0, "No fixes needed for secure cloud"

def test_secure_terraform_file():
    tf_path = Path(__file__).resolve().parent.parent.parent / "secure_architecture.tf"
    assert tf_path.exists(), "secure_architecture.tf must exist"
    
    tf_content = tf_path.read_text(encoding="utf-8")
    sc_dict = parse_terraform_to_scenario(
        tf_code=tf_content,
        scenario_id="secure_tf_import",
        display_name="Secure Terraform Architecture"
    )
    
    sc = Scenario.model_validate(sc_dict)
    analysis = run_full_analysis(sc)
    
    assert analysis.before.path_count == 0, "Secure terraform should have 0 attack paths"
    assert analysis.before.risk <= 10, "Secure terraform risk should be minimal"
    assert analysis.choke_point is None, "Secure terraform should have no choke point"
