import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import { StatusResponse, DeviceInfo, ScenarioMeta, Analysis } from './types';
import { useToast } from './context/ToastContext';

// ---------------------------------------------------------------------
// State & Action Types
// ---------------------------------------------------------------------

export interface AppState {
  status: StatusResponse | null;
  devices: DeviceInfo[];
  scenarios: ScenarioMeta[];
  selectedScenario: string;
  analysis: Analysis | null;
  loading: boolean;
}

export type AppAction =
  | { type: 'SET_STATUS'; payload: StatusResponse | null }
  | { type: 'SET_DEVICES'; payload: DeviceInfo[] }
  | { type: 'SET_SCENARIOS'; payload: ScenarioMeta[] }
  | { type: 'SET_SELECTED_SCENARIO'; payload: string }
  | { type: 'SET_ANALYSIS'; payload: Analysis | null }
  | { type: 'SET_LOADING'; payload: boolean };

const initialState: AppState = {
  status: null,
  devices: [],
  scenarios: [],
  selectedScenario: 'educloud',
  analysis: null,
  loading: false,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_STATUS':
      return { ...state, status: action.payload };
    case 'SET_DEVICES':
      return { ...state, devices: action.payload };
    case 'SET_SCENARIOS':
      return { ...state, scenarios: action.payload };
    case 'SET_SELECTED_SCENARIO':
      return { ...state, selectedScenario: action.payload };
    case 'SET_ANALYSIS':
      return { ...state, analysis: action.payload };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    default:
      return state;
  }
}

// ---------------------------------------------------------------------
// Context Interface
// ---------------------------------------------------------------------

export interface AppContextType extends AppState {
  setSelectedScenario: (sc: string) => void;
  runAnalysis: (scenarioId?: string) => Promise<void>;
  resetAll: () => Promise<void>;
  refreshAnalysis: () => Promise<void>;
  refreshScenarios: () => Promise<void>;
}

const AppStateContext = createContext<AppContextType | undefined>(undefined);

// ---------------------------------------------------------------------
// Provider Component
// ---------------------------------------------------------------------

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const { addToast } = useToast();
  const navigate = useNavigate();

  // Poll tracking references
  const prevSeqRef = useRef<number | null>(null);
  const prevDevicesOnlineRef = useRef<Record<string, boolean>>({});
  const lastSeenAuditIdRef = useRef<number | null>(null);

  const refreshScenarios = useCallback(async () => {
    try {
      const data = await api.getScenarios();
      dispatch({ type: 'SET_SCENARIOS', payload: data });
    } catch (err) {
      console.error('Failed to reload scenarios', err);
    }
  }, []);

  // Load scenarios on mount
  useEffect(() => {
    refreshScenarios().then(() => {
      // initial load done
    });
  }, [refreshScenarios]);


  // Fetch analysis helper
  const fetchAnalysis = useCallback(async () => {
    try {
      const data = await api.getAnalysis();
      dispatch({ type: 'SET_ANALYSIS', payload: data });
    } catch (err: any) {
      if (err.status !== 404) {
        console.error('Failed to load analysis', err);
      }
      dispatch({ type: 'SET_ANALYSIS', payload: null });
    }
  }, []);

  // Run analysis action
  const runAnalysis = async (scenarioId?: string) => {
    const sc = scenarioId || state.selectedScenario;
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      const result = await api.runAnalysis(sc);
      dispatch({ type: 'SET_ANALYSIS', payload: result });
      const st = await api.getStatus();
      dispatch({ type: 'SET_STATUS', payload: st });
      prevSeqRef.current = st.seq;
      addToast({
        type: 'info',
        title: 'Analysis Complete',
        message: `Discovered ${result.before.path_count} attack path(s) on ${result.display_name}. Risk score: ${result.before.risk}.`,
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Analysis Failed',
        message: err.message || 'Could not complete graph analysis',
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  // Reset action
  const resetAll = async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    try {
      await api.reset();
      dispatch({ type: 'SET_ANALYSIS', payload: null });
      const st = await api.getStatus();
      dispatch({ type: 'SET_STATUS', payload: st });
      prevSeqRef.current = st.seq;
      addToast({
        type: 'info',
        title: 'System Reset',
        message: 'System state reset to idle.',
      });
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Reset Failed',
        message: err.message,
      });
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  };

  // Audit event detector for toast alerts
  const checkAuditEvents = useCallback(async () => {
    try {
      const auditRes = await api.getAudit();
      const entries = auditRes.entries;
      if (entries.length === 0) return;

      const latest = entries[0];
      if (lastSeenAuditIdRef.current === null) {
        lastSeenAuditIdRef.current = latest.id;
        return;
      }

      if (latest.id > lastSeenAuditIdRef.current) {
        const newEntries = entries.filter((e) => e.id > (lastSeenAuditIdRef.current || 0));
        lastSeenAuditIdRef.current = latest.id;

        for (const e of newEntries) {
          if (e.event === 'fix_applied') {
            addToast({
              type: 'success',
              title: 'Fix Approved!',
              message: `Approved by ${e.entry.approver || 'Security Lead'} via ${e.entry.device_id || 'console'}. Attack paths severed!`,
            });
          } else if (e.event === 'approve_denied') {
            addToast({
              type: 'warning',
              title: 'Badge Access Denied',
              message: `Unknown badge ${e.entry.card_id} tapped on ${e.entry.device_id || 'console'}. Enrol this badge?`,
              action: {
                label: 'Go to Cards',
                onClick: () => navigate('/cards'),
              },
            });
          }
        }
      }
    } catch {
      // Ignore background network hiccup
    }
  }, [addToast, navigate]);

  // Polling: /api/status every 2 s (refetch /api/analysis when seq changes, paused when tab hidden)
  useEffect(() => {
    let timer: any;

    const pollStatus = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      try {
        const st = await api.getStatus();
        dispatch({ type: 'SET_STATUS', payload: st });

        if (prevSeqRef.current !== null && st.seq !== prevSeqRef.current) {
          await fetchAnalysis();
          await checkAuditEvents();
        } else if (prevSeqRef.current === null) {
          if (st.state !== 'idle') {
            await fetchAnalysis();
          }
        }
        prevSeqRef.current = st.seq;
      } catch {
        // network or server startup
      }
    };

    pollStatus();
    timer = setInterval(pollStatus, 2000);
    return () => clearInterval(timer);
  }, [fetchAnalysis, checkAuditEvents]);

  // Polling: /api/devices every 3 s (paused when tab hidden)
  useEffect(() => {
    let timer: any;

    const pollDevices = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      try {
        const devs = await api.getDevices();
        dispatch({ type: 'SET_DEVICES', payload: devs });

        // Compare consecutive polls to detect online/offline transitions
        const currentOnlineMap: Record<string, boolean> = {};
        for (const d of devs) {
          currentOnlineMap[d.device_id] = d.online;
          const wasOnline = prevDevicesOnlineRef.current[d.device_id];
          if (wasOnline !== undefined && wasOnline !== d.online) {
            addToast({
              type: d.online ? 'success' : 'warning',
              title: `Device ${d.online ? 'Online' : 'Offline'}`,
              message: `${d.device_id} is now ${d.online ? 'online' : 'offline'}.`,
            });
          }
        }
        prevDevicesOnlineRef.current = currentOnlineMap;
      } catch {
        // ignore
      }
    };

    pollDevices();
    timer = setInterval(pollDevices, 3000);
    return () => clearInterval(timer);
  }, [addToast]);

  const value: AppContextType = {
    ...state,
    setSelectedScenario: (sc: string) => dispatch({ type: 'SET_SELECTED_SCENARIO', payload: sc }),
    runAnalysis,
    resetAll,
    refreshAnalysis: fetchAnalysis,
    refreshScenarios,
  };

  return React.createElement(AppStateContext.Provider, { value }, children);
};

export const useApp = () => {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
};
