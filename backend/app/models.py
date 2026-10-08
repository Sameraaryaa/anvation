from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, ConfigDict

# Scenario Models

class Node(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    type: str
    label: Optional[str] = None
    exposed: Optional[bool] = False
    public: Optional[bool] = False
    misconfig: Optional[List[str]] = Field(default_factory=list)
    privilege: Optional[str] = None
    sensitivity: Optional[str] = None
    crown_jewel: Optional[bool] = False
    value: Optional[int] = None
    name_ref: Optional[str] = None

class Edge(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    type: Optional[str] = None
    technique: Optional[str] = None
    difficulty: int = 1
    fixable: Optional[bool] = False
    fix: Optional[str] = None

class Remediation(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    title: str
    detail: str
    removes_edges: List[List[str]]
    iam_before: Optional[Dict[str, Any]] = None
    iam_after: Optional[Dict[str, Any]] = None
    terraform_after: Optional[str] = None
    rego: Optional[str] = None

class Scenario(BaseModel):
    scenario: str
    display_name: str
    entry_points: List[str]
    crown_jewels: List[str]
    nodes: List[Node]
    edges: List[Edge]
    remediations: Dict[str, Remediation] = Field(default_factory=dict)

# Analysis & API Models

class AnalysisNode(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    label: str
    type: str
    entry: bool = False
    crown_jewel: bool = False
    choke: bool = False
    dominator: bool = False
    on_path: bool = False
    reachable: bool = True
    misconfig: Optional[List[str]] = None
    privilege: Optional[str] = None
    value: Optional[int] = None
    name_ref: Optional[str] = None
    sensitivity: Optional[str] = None
    public: Optional[bool] = False
    exposed: Optional[bool] = False

class AnalysisEdge(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    source: str
    target: str
    type: Optional[str] = None
    technique: Optional[str] = None
    difficulty: int = 1
    fixable: bool = False
    fix: Optional[str] = None
    paths: List[int] = Field(default_factory=list)
    removed: bool = False

class AnalysisPath(BaseModel):
    id: int
    nodes: List[str]
    hops: int
    difficulty: int
    risk: int
    severity: str

class ChokePoint(BaseModel):
    id: str
    label: str

class RecommendedFix(BaseModel):
    model_config = ConfigDict(extra="allow")

    fix_id: str
    title: str
    detail: str
    iam_before: Optional[Dict[str, Any]] = None
    iam_after: Optional[Dict[str, Any]] = None
    terraform_after: Optional[str] = None
    rego: Optional[str] = None
    removes_edges: List[List[str]]

class BeforeAfter(BaseModel):
    path_count: int
    risk: int
    blast_count: int
    blast_weighted: int

class AnalysisTimings(BaseModel):
    analysis_ms: int

class Analysis(BaseModel):
    scenario: str
    display_name: str
    applied: bool = False
    nodes: List[AnalysisNode]
    edges: List[AnalysisEdge]
    paths: List[AnalysisPath]
    paths_before: Optional[List[AnalysisPath]] = None
    choke_point: Optional[ChokePoint] = None
    dominators: List[str]
    recommended_fixes: List[RecommendedFix]
    before: BeforeAfter
    after: BeforeAfter
    blast_reduction_pct: int
    timings: AnalysisTimings

# Device API Models

class StatusResponse(BaseModel):
    state: str               # "idle" | "unsafe" | "safe"
    path_count: int          # 0..99
    risk: int                # 0..100
    scenario: str            # "" when idle
    choke_point: Optional[str] = None
    pending_fix: bool
    seq: int
    updated_at: int

class PendingFixResponse(BaseModel):
    fix_id: Optional[str] = None
    title: Optional[str] = None
    detail: Optional[str] = None
    risk_before: Optional[int] = None
    risk_after: Optional[int] = None
    paths_before: Optional[int] = None
    paths_after: Optional[int] = None

class ApproveRequest(BaseModel):
    fix_id: Optional[str] = None
    card_id: Optional[str] = None
    device_id: Optional[str] = "esp32-console-01"

class ScanRequest(BaseModel):
    card_id: Optional[str] = None
    device_id: Optional[str] = "esp32-console-01"

class HeartbeatRequest(BaseModel):
    device_id: str
    device_type: str
    fw: Optional[str] = "1.0.0"
    ip: Optional[str] = ""
    rssi: Optional[int] = None
    uptime_s: Optional[int] = 0
    components: Optional[Dict[str, Any]] = Field(default_factory=dict)
