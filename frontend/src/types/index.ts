export interface StatusResponse {
  state: 'idle' | 'unsafe' | 'safe';
  path_count: number;
  risk: number;
  scenario: string;
  choke_point: string | null;
  pending_fix: boolean;
  seq: number;
  updated_at: number;
}

export interface PendingFixResponse {
  fix_id: string | null;
  title?: string;
  detail?: string;
  risk_before?: number;
  risk_after?: number;
  paths_before?: number;
  paths_after?: number;
}

export interface HealthResponse {
  ok: boolean;
  ts: number;
  service: string;
  version: string;
}

export interface ApproveResponse {
  applied: boolean;
  approver?: string;
  fix_id?: string;
  state?: string;
  path_count?: number;
  risk?: number;
  reason?: string;
  card_id?: string;
  pending_fix_id?: string;
}

export interface RfidScanResponse {
  known: boolean;
  name: string | null;
  card_id: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  command: string;
  server_time: number;
}

export interface ScenarioMeta {
  id: string;
  display_name: string;
}

export interface DeviceComponentMap {
  [key: string]: string;
}

export interface DeviceInfo {
  device_id: string;
  device_type: string;
  fw: string;
  ip: string;
  rssi: number | null;
  uptime_s: number;
  components: DeviceComponentMap;
  remote_ip: string;
  last_seen: number;
  age_s: number;
  online: boolean;
}

export interface CardInfo {
  card_id: string;
  name: string;
  role: string;
  created_at: number;
}

export interface ScanRecord {
  card_id: string;
  device_id: string;
  known: boolean;
  name: string | null;
  context: string;
  ts: number;
}

export interface AuditRecord {
  id: number;
  event: string;
  entry: Record<string, any>;
  prev_hash: string;
  this_hash: string;
  ts: number;
}

export interface AuditResponse {
  entries: AuditRecord[];
  chain_valid: boolean;
}

export interface AnalysisNode {
  id: string;
  label: string;
  type: string;
  entry: boolean;
  crown_jewel: boolean;
  choke: boolean;
  dominator: boolean;
  on_path: boolean;
  reachable: boolean;
  misconfig?: string[];
  privilege?: string;
  value?: number;
  name_ref?: string;
  sensitivity?: string;
  public?: boolean;
  exposed?: boolean;
}

export interface AnalysisEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  technique?: string;
  difficulty: number;
  fixable: boolean;
  fix?: string;
  paths: number[];
  removed: boolean;
}

export interface AnalysisPath {
  id: number;
  nodes: string[];
  hops: number;
  difficulty: number;
  risk: number;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
}

export interface RecommendedFix {
  fix_id: string;
  title: string;
  detail: string;
  iam_before?: Record<string, any>;
  iam_after?: Record<string, any>;
  terraform_after?: string;
  rego?: string;
  removes_edges: [string, string][];
}

export interface BeforeAfter {
  path_count: number;
  risk: number;
  blast_count: number;
  blast_weighted: number;
}

export interface Analysis {
  scenario: string;
  display_name: string;
  applied: boolean;
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
  paths: AnalysisPath[];
  paths_before?: AnalysisPath[];
  choke_point?: { id: string; label: string };
  dominators: string[];
  recommended_fixes: RecommendedFix[];
  before: BeforeAfter;
  after: BeforeAfter;
  blast_reduction_pct: number;
  timings: { analysis_ms: number };
}

export interface ConfigResponse {
  allow_browser_approval: boolean;
  air_gapped: boolean;
  db_mode: string;
}

export interface AskResponse {
  answer: string;
  mode: 'gemini' | 'template';
  model: string;
  grounded: boolean;
  cited: string[];
}
