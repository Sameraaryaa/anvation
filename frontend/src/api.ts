import {
  HealthResponse, StatusResponse, PendingFixResponse, ApproveResponse,
  RfidScanResponse, HeartbeatResponse, ScenarioMeta, DeviceInfo, CardInfo,
  ScanRecord, AuditResponse, Analysis, ConfigResponse, AskResponse
} from './types';

const BASE_URL = '';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    let errBody: any;
    try {
      errBody = await res.json();
    } catch {
      errBody = { error: res.statusText };
    }
    const error = new Error(errBody.error || errBody.reason || `HTTP error ${res.status}`);
    (error as any).status = res.status;
    (error as any).data = errBody;
    throw error;
  }
  return res.json();
}

export const api = {
  // -------------------------------------------------------------
  // Section 4: Device Hardware Endpoints
  // -------------------------------------------------------------
  getHealth: () => fetchJson<HealthResponse>('/api/health'),

  getStatus: () => fetchJson<StatusResponse>('/api/status'),

  getPendingFix: () => fetchJson<PendingFixResponse>('/api/pending_fix'),

  approve: (fix_id: string, card_id: string, device_id = 'esp32-console-01', device_key = 'aegis-demo-key-change-me') =>
    fetchJson<ApproveResponse>('/api/approve', {
      method: 'POST',
      headers: { 'X-Device-Key': device_key, 'X-Device-Id': device_id },
      body: JSON.stringify({ fix_id, card_id, device_id }),
    }),

  scanRfid: (card_id: string, device_id = 'esp32-console-01', device_key = 'aegis-demo-key-change-me') =>
    fetchJson<RfidScanResponse>('/api/rfid/scan', {
      method: 'POST',
      headers: { 'X-Device-Key': device_key, 'X-Device-Id': device_id },
      body: JSON.stringify({ card_id, device_id }),
    }),

  heartbeat: (payload: {
    device_id: string;
    device_type: string;
    fw: string;
    ip: string;
    rssi?: number | null;
    uptime_s: number;
    components: Record<string, string>;
  }, device_key = 'aegis-demo-key-change-me') =>
    fetchJson<HeartbeatResponse>('/api/device/heartbeat', {
      method: 'POST',
      headers: { 'X-Device-Key': device_key, 'X-Device-Id': payload.device_id },
      body: JSON.stringify(payload),
    }),

  // -------------------------------------------------------------
  // Section 5: Dashboard Browser Endpoints
  // -------------------------------------------------------------
  getScenarios: () => fetchJson<ScenarioMeta[]>('/api/scenarios'),

  runAnalysis: (scenario: string) =>
    fetchJson<Analysis>('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ scenario }),
    }),

  getAnalysis: () => fetchJson<Analysis>('/api/analysis'),

  reset: () => fetchJson<{ ok: boolean }>('/api/reset', { method: 'POST' }),

  getDevices: () => fetchJson<DeviceInfo[]>('/api/devices'),

  sendCommand: (deviceId: string, command: 'identify' | 'self_test') =>
    fetchJson<{ ok: boolean; queued: string; note: string }>(`/api/devices/${deviceId}/command`, {
      method: 'POST',
      body: JSON.stringify({ command }),
    }),

  getCards: () => fetchJson<CardInfo[]>('/api/cards'),

  addCard: (card_id: string, name: string, role = 'approver') =>
    fetchJson<{ ok: boolean }>('/api/cards', {
      method: 'POST',
      body: JSON.stringify({ card_id, name, role }),
    }),

  deleteCard: (card_id: string) =>
    fetchJson<{ ok: boolean }>(`/api/cards/${card_id}`, { method: 'DELETE' }),

  getRecentScans: () => fetchJson<ScanRecord[]>('/api/rfid/recent'),

  getAudit: () => fetchJson<AuditResponse>('/api/audit'),

  getConfig: () => fetchJson<ConfigResponse>('/api/config'),

  simulateBadge: (card_id: string, fix_id?: string) =>
    fetchJson<ApproveResponse>('/api/dev/simulate_badge', {
      method: 'POST',
      body: JSON.stringify({ card_id, fix_id }),
    }),

  askSentinel: (question: string) =>
    fetchJson<AskResponse>('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),

  importScenario: (data: any) =>
    fetchJson<{ ok: boolean; scenario: string; display_name: string; message: string }>('/api/scenarios/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

