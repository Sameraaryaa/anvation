import re
from typing import Dict, Any, List
from app.models import Scenario

def parse_terraform_to_scenario(
    tf_code: str,
    scenario_id: str = "custom_tf_scenario",
    display_name: str = "Imported Terraform Infrastructure"
) -> Dict[str, Any]:
    """
    Parses Terraform HCL code (e.g. from CloudGoat or AWS IaC repositories)
    into a valid AEGIS-Graph Attack Scenario.
    """
    # Regex for resource "type" "name"
    res_pattern = re.compile(r'resource\s+"([^"]+)"\s+"([^"]+)"')
    found_resources = res_pattern.findall(tf_code)

    if not found_resources:
        raise ValueError("No Terraform resource blocks (resource \"...\") detected in the provided code.")

    nodes = []
    edges = []
    entry_points = ["internet"]
    crown_jewels = []

    # Entry point
    nodes.append({
        "id": "internet",
        "type": "internet",
        "label": "Internet",
        "exposed": True
    })

    compute_nodes = []
    role_nodes = []
    data_nodes = []

    code_no_comments = re.sub(r'#.*$', '', tf_code, flags=re.MULTILINE)
    code_no_comments = re.sub(r'//.*$', '', code_no_comments, flags=re.MULTILINE)
    code_no_comments = re.sub(r'/\*.*?\*/', '', code_no_comments, flags=re.DOTALL)

    for r_type, r_name in found_resources:
        clean_id = re.sub(r'[^a-zA-Z0-9_-]', '_', r_name.lower())

        if r_type in ("aws_instance", "aws_lambda_function", "aws_ecs_task_definition"):
            has_open_ingress = "0.0.0.0/0" in code_no_comments
            is_named_public = any(k in r_name.lower() for k in ("http", "proxy", "web", "public", "waf"))
            is_named_private = any(k in r_name.lower() for k in ("private", "internal", "backend", "isolated"))
            is_pub = (has_open_ingress or is_named_public) and not is_named_private

            node = {
                "id": clean_id,
                "type": "compute",
                "label": f"EC2: {r_name}" if "instance" in r_type else f"Compute: {r_name}",
                "public": is_pub,
                "misconfig": ["exposed_service", "unrestricted_metadata"] if is_pub else []
            }
            nodes.append(node)
            compute_nodes.append(clean_id)

        elif r_type in ("aws_iam_role", "aws_iam_user", "aws_iam_policy", "aws_iam_role_policy"):
            is_overpriv = any(k in code_no_comments.lower() for k in (
                "s3fullaccess", "administratoraccess", "admin", "action = [\"*\"]",
                "action = \"*\"", "actions = [\"*\"]", "\"action\": \"*\"",
                "\"action\": [\"*\"]", "passrole", "overpriv"
            ))
            node = {
                "id": clean_id,
                "type": "role",
                "label": f"Role: {r_name}",
                "misconfig": ["overprivileged_policy"] if is_overpriv else []
            }
            nodes.append(node)
            role_nodes.append(clean_id)

        elif r_type in ("aws_s3_bucket", "aws_db_instance", "aws_rds_cluster", "aws_secretsmanager_secret"):
            node = {
                "id": clean_id,
                "type": "data",
                "label": f"S3: {r_name}" if "s3" in r_type else f"RDS: {r_name}",
                "crown_jewel": True,
                "value": 10,
                "sensitivity": "confidential_data"
            }
            nodes.append(node)
            data_nodes.append(clean_id)
            crown_jewels.append(clean_id)

    # Fallback crown jewel if only compute/IAM was defined
    if not crown_jewels:
        cj_id = "target_cloud_asset"
        nodes.append({
            "id": cj_id,
            "type": "data",
            "label": "Protected Cloud Asset",
            "crown_jewel": True,
            "value": 10
        })
        data_nodes.append(cj_id)
        crown_jewels.append(cj_id)

    public_compute_nodes = [c for c in compute_nodes if any(n["id"] == c and n.get("public") for n in nodes)]
    overpriv_role_nodes = [r for r in role_nodes if any(n["id"] == r and n.get("misconfig") for n in nodes)]

    # Build Attack Edges
    # 1. Internet -> Compute (only to publicly reachable compute nodes)
    if public_compute_nodes:
        for comp in public_compute_nodes:
            edges.append({
                "from": "internet",
                "to": comp,
                "type": "EXPOSED_TO_INTERNET",
                "technique": "T1190",
                "difficulty": 2
            })
    elif role_nodes and overpriv_role_nodes:
        edges.append({
            "from": "internet",
            "to": overpriv_role_nodes[0],
            "type": "EXPOSED_CREDENTIAL",
            "technique": "T1552",
            "difficulty": 1
        })
    elif not compute_nodes and not role_nodes:
        if "0.0.0.0/0" in tf_code or "public" in tf_code.lower():
            edges.append({
                "from": "internet",
                "to": crown_jewels[0],
                "type": "PUBLIC_RESOURCE_ACCESS",
                "technique": "T1530",
                "difficulty": 1
            })

    # 2. Compute -> Role
    if public_compute_nodes and role_nodes:
        for i, comp in enumerate(public_compute_nodes):
            assigned_role = role_nodes[min(i, len(role_nodes) - 1)]
            edges.append({
                "from": comp,
                "to": assigned_role,
                "type": "INSTANCE_PROFILE_CREDS",
                "technique": "T1078.004",
                "difficulty": 2,
                "fixable": True,
                "fix": "scope_iam_permissions"
            })

    # 3. Role -> Data (only if role has overprivileged or wildcard permissions)
    roles_to_connect = overpriv_role_nodes if overpriv_role_nodes else (role_nodes if not overpriv_role_nodes and not role_nodes else [])

    target_fix_edge = []
    if public_compute_nodes and role_nodes and overpriv_role_nodes:
        target_fix_edge = [[public_compute_nodes[0], role_nodes[0]]]
    elif public_compute_nodes and data_nodes:
        target_fix_edge = [[public_compute_nodes[0], data_nodes[0]]]
    elif roles_to_connect and data_nodes:
        target_fix_edge = [[roles_to_connect[0], data_nodes[0]]]
    elif role_nodes and data_nodes:
        target_fix_edge = [[role_nodes[0], data_nodes[0]]]
    elif overpriv_role_nodes:
        target_fix_edge = [["internet", overpriv_role_nodes[0]]]
    elif data_nodes:
        target_fix_edge = [["internet", data_nodes[0]]]

    if roles_to_connect and data_nodes:
        for r in roles_to_connect:
            for d in data_nodes:
                is_fix_target = [r, d] in target_fix_edge
                edges.append({
                    "from": r,
                    "to": d,
                    "type": "CAN_READ_DATA",
                    "technique": "T1530",
                    "difficulty": 1,
                    "fixable": is_fix_target,
                    "fix": "scope_iam_permissions" if is_fix_target else None
                })
    elif public_compute_nodes and data_nodes and not role_nodes:
        for c in public_compute_nodes:
            for d in data_nodes:
                edges.append({
                    "from": c,
                    "to": d,
                    "type": "DIRECT_STORAGE_ACCESS",
                    "technique": "T1530",
                    "difficulty": 1,
                    "fixable": True,
                    "fix": "scope_iam_permissions"
                })

    remediations = {}
    if target_fix_edge:
        target_res = data_nodes[0] if data_nodes else "target_asset"
        remediations["scope_iam_permissions"] = {
            "title": "Least-Privilege Scoping on Terraform Resources",
            "detail": f"Restrict broad policies to explicit resource ARNs ({target_res}) and enforce IMDSv2 session tokens.",
            "removes_edges": target_fix_edge,
            "iam_before": {
                "Effect": "Allow",
                "Action": ["s3:*", "rds:*"],
                "Resource": "*"
            },
            "iam_after": {
                "Effect": "Allow",
                "Action": ["s3:GetObject"],
                "Resource": f"arn:aws:s3:::{target_res}/*"
            },
            "terraform_after": f"resource \"aws_iam_role_policy\" \"remediated\" {{\n  name = \"least-privilege-policy\"\n  policy = jsonencode({{\n    Version = \"2012-10-17\"\n    Statement = [{{\n      Effect = \"Allow\"\n      Action = [\"s3:GetObject\"]\n      Resource = \"arn:aws:s3:::{target_res}/*\"\n    }}]\n  }})\n}}",
            "rego": "package aws.iam\ndeny[msg] {\n  input.Action == \"*\"\n  msg := \"Wildcard actions prohibited in production Terraform\"\n}"
        }

    result = {
        "scenario": scenario_id,
        "display_name": display_name,
        "entry_points": entry_points,
        "crown_jewels": crown_jewels,
        "nodes": nodes,
        "edges": edges,
        "remediations": remediations
    }

    # Validate against Scenario schema
    Scenario.model_validate(result)
    return result
