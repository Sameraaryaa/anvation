import React, { useState, useEffect } from 'react';
import {
  Radio, CheckCircle, ChevronDown, ChevronUp, KeyRound, Wifi
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { Card } from '../components/Card';
import { Pill } from '../components/Pill';
import { useToast } from '../context/ToastContext';
import { CardInfo, ConfigResponse, PendingFixResponse } from '../types';

export const Hardware: React.FC = () => {
  const { devices, status, refreshAnalysis } = useApp();
  const { addToast } = useToast();

  const [queuedCommands, setQueuedCommands] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [simulating, setSimulating] = useState(false);
  const [showWiring, setShowWiring] = useState(false);
  const [animationTick, setAnimationTick] = useState(0);
  const [pendingFix, setPendingFix] = useState<PendingFixResponse | null>(null);

  // Load config, cards & pending fix info
  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
    api.getCards().then((res) => {
      setCards(res);
      if (res.length > 0) setSelectedCardId(res[0].card_id);
    }).catch(console.error);
  }, []);

  // Fetch pending fix when status changes
  useEffect(() => {
    if (status?.pending_fix) {
      api.getPendingFix().then(setPendingFix).catch(() => setPendingFix(null));
    } else {
      setPendingFix(null);
    }
  }, [status?.pending_fix, status?.seq]);

  // Animation ticker for LED matrix blinking and bouncing (500ms)
  useEffect(() => {
    const timer = setInterval(() => {
      setAnimationTick((t) => t + 1);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const handleSendCommand = async (deviceId: string, command: 'identify' | 'self_test') => {
    try {
      await api.sendCommand(deviceId, command);
      setQueuedCommands((prev) => ({ ...prev, [deviceId]: command }));
      addToast({
        type: 'info',
        title: 'Command Queued',
        message: `Command "${command}" queued for ${deviceId}. Delivered on next heartbeat (≤10 s).`,
      });
      // Clear after 10s
      setTimeout(() => {
        setQueuedCommands((prev) => {
          const next = { ...prev };
          delete next[deviceId];
          return next;
        });
      }, 10000);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Command Failed',
        message: err.message,
      });
    }
  };

  const handleSimulateBadge = async () => {
    if (!selectedCardId) return;
    setSimulating(true);
    try {
      const res = await api.simulateBadge(selectedCardId);
      if (res.applied) {
        addToast({
          type: 'success',
          title: 'Simulated Approval Succeeded',
          message: `Fix applied as approver "${res.approver}". Risk is now ${res.risk}.`,
        });
        await refreshAnalysis();
      } else {
        addToast({
          type: 'warning',
          title: 'Simulation Rejected',
          message: res.reason || 'Approval failed',
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Simulation Error',
        message: err.message,
      });
    } finally {
      setSimulating(false);
    }
  };

  const esp32 = devices.find((d) => d.device_id === 'esp32-console-01');
  const unoq = devices.find((d) => d.device_id === 'unoq-status-01');

  // Matrix pattern calculation (8 rows x 13 cols)
  const renderUnoMatrix = () => {
    const matrix: boolean[][] = Array(8).fill(false).map(() => Array(13).fill(false));
    const isUnoOnline = unoq?.online ?? false;
    const isBlinkOn = animationTick % 2 === 0;

    const DIGIT_FONT: Record<string, number[]> = {
      '0': [7, 5, 5, 5, 7],
      '1': [2, 6, 2, 2, 7],
      '2': [7, 1, 7, 4, 7],
      '3': [7, 1, 7, 1, 7],
      '4': [5, 5, 7, 1, 1],
      '5': [7, 4, 7, 1, 7],
      '6': [7, 4, 7, 5, 7],
      '7': [7, 1, 2, 2, 2],
      '8': [7, 5, 7, 5, 7],
      '9': [7, 5, 7, 1, 7],
      '?': [7, 1, 3, 0, 2],
    };

    const drawDigit = (digitChar: string, startCol: number) => {
      const rows = DIGIT_FONT[digitChar] || DIGIT_FONT['?'];
      rows.forEach((val, rIdx) => {
        const row = rIdx + 1; // rows 1..5
        if (row < 8) {
          // 3-bit: mask 4, 2, 1
          if (val & 4) matrix[row][startCol] = true;
          if (val & 2) matrix[row][startCol + 1] = true;
          if (val & 1) matrix[row][startCol + 2] = true;
        }
      });
    };

    if (!isUnoOnline) {
      // Offline pattern: Blinking '?' at col 5
      if (isBlinkOn) {
        drawDigit('?', 5);
      }
    } else if (status?.state === 'safe') {
      // Safe: Tick mark at exact coords
      const tickCoords = [
        [3, 3], [4, 4], [5, 5], [4, 6], [3, 7], [2, 8], [1, 9],
        [4, 3], [5, 4], [6, 5], [5, 6], [4, 7], [3, 8], [2, 9]
      ];
      tickCoords.forEach(([r, c]) => {
        if (r < 8 && c < 13) matrix[r][c] = true;
      });
    } else if (status?.state === 'unsafe') {
      // Unsafe:
      // X on columns 0-4 rows 1-5 (blinks 500ms)
      if (isBlinkOn) {
        const xCoords = [
          [1, 0], [2, 1], [3, 2], [4, 3], [5, 4],
          [1, 4], [2, 3], [3, 2], [4, 1], [5, 0]
        ];
        xCoords.forEach(([r, c]) => { matrix[r][c] = true; });
      }

      // Digits for path count (1 digit at col 8, 2 digits at cols 6 & 10)
      const countStr = String(status.path_count ?? 0);
      if (countStr.length === 1) {
        drawDigit(countStr[0], 8);
      } else if (countStr.length >= 2) {
        drawDigit(countStr[0], 6);
        drawDigit(countStr[1], 10);
      }

      // Bottom row (row 7): lit round(risk * 13 / 100) cells
      const litCols = Math.round(((status.risk ?? 0) * 13) / 100);
      for (let c = 0; c < Math.min(13, litCols); c++) {
        matrix[7][c] = true;
      }
    } else {
      // Idle: 2-pixel-tall dot bouncing across rows 3-4
      const bounceCol = animationTick % 13;
      matrix[3][bounceCol] = true;
      matrix[4][bounceCol] = true;
    }

    return matrix;
  };

  // Status LED colours for UNO Q (LED3 and LED4)
  const getUnoLeds = () => {
    if (!unoq?.online) return { color: 'bg-amber', label: 'OFFLINE' };
    if (status?.state === 'safe') return { color: 'bg-green', label: 'SAFE' };
    if (status?.state === 'unsafe') return { color: 'bg-red', label: 'UNSAFE' };
    return { color: 'bg-blue', label: 'IDLE' };
  };

  const unoLeds = getUnoLeds();
  const matrix = renderUnoMatrix();

  // Helper for Wi-Fi RSSI bars
  const renderRssiBars = (rssi: number | null) => {
    if (rssi === null) return <span className="text-mute font-mono">—</span>;
    const bars = rssi >= -60 ? 4 : rssi >= -70 ? 3 : rssi >= -80 ? 2 : 1;
    return (
      <div className="flex items-center gap-1.5 font-mono">
        <div className="flex items-end gap-0.5 h-3">
          <span className={`w-1 rounded-sm ${bars >= 1 ? 'h-1.5 bg-green' : 'h-1.5 bg-line'}`} />
          <span className={`w-1 rounded-sm ${bars >= 2 ? 'h-2 bg-green' : 'h-2 bg-line'}`} />
          <span className={`w-1 rounded-sm ${bars >= 3 ? 'h-2.5 bg-green' : 'h-2.5 bg-line'}`} />
          <span className={`w-1 rounded-sm ${bars >= 4 ? 'h-3 bg-green' : 'h-3 bg-line'}`} />
        </div>
        <span>{rssi} dBm</span>
      </div>
    );
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Hardware Integration</h1>
        <p className="text-xs text-mute mt-0.5">
          Real-time mirror and telemetry for ESP32 Physical Approval Console and Arduino UNO Q Status Board
        </p>
      </div>

      {/* Demo Fallback Box (if ALLOW_BROWSER_APPROVAL=1) */}
      {config?.allow_browser_approval && (
        <Card className="border-amber/50 bg-ambersoft/30 p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber text-white flex items-center justify-center shrink-0">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber">
                  Demo Fallback · Browser RFID Simulator
                </h4>
                <p className="text-xs text-slate">
                  Simulate tapping an enrolled RFID badge when physical hardware is in transit.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={selectedCardId}
                onChange={(e) => setSelectedCardId(e.target.value)}
                className="bg-white border border-amber/40 rounded-xl px-3 py-1.5 text-xs font-semibold text-ink focus:outline-none"
              >
                {cards.map((c) => (
                  <option key={c.card_id} value={c.card_id}>
                    {c.card_id} ({c.name})
                  </option>
                ))}
              </select>

              <button
                onClick={handleSimulateBadge}
                disabled={simulating || !status?.pending_fix}
                className="px-4 py-2 bg-amber hover:bg-amber/90 text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {simulating ? 'Simulating...' : 'Simulate badge tap'}
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Main Hardware Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Device 1: ESP32-S3 Physical Approval Console */}
        <Card className="flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-line mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-base text-ink">ESP32-S3 Approval Console</h3>
                  <span className="text-xs font-mono text-mute">(esp32-console-01)</span>
                </div>
                <p className="text-xs text-mute mt-0.5">Physical RFID Reader & TFT Display</p>
              </div>

              {esp32 ? (
                <Pill
                  label={esp32.online ? 'ONLINE' : 'OFFLINE'}
                  variant={esp32.online ? 'green' : 'red'}
                />
              ) : (
                <Pill label="NOT SEEN YET" variant="slate" />
              )}
            </div>

            {esp32 ? (
              <div className="space-y-4">
                {/* Device Telemetry Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">Last Seen</span>
                    <div className="font-semibold text-ink mt-0.5">{esp32.age_s} s ago</div>
                  </div>
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">IP Address</span>
                    <div className="font-semibold text-ink mt-0.5 font-mono">{esp32.ip || '—'}</div>
                  </div>
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">Wi-Fi RSSI</span>
                    <div className="font-semibold text-ink mt-0.5">
                      {renderRssiBars(esp32.rssi)}
                    </div>
                  </div>
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">Firmware</span>
                    <div className="font-semibold text-ink mt-0.5 font-mono">v{esp32.fw} ({esp32.uptime_s}s)</div>
                  </div>
                </div>

                {/* Components Health */}
                <div className="p-3 bg-bg rounded-xl border border-line space-y-1.5 text-xs">
                  <div className="text-[10px] text-mute uppercase font-bold mb-1">Component Diagnostics</div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(esp32.components || {}).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${val === 'ok' || val.startsWith('0x') ? 'bg-green' : 'bg-red'}`} />
                        <span className="text-slate uppercase font-medium text-[11px]">{key}:</span>
                        <span className="font-mono text-[11px] text-ink font-semibold">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* TFT Mirror (Aspect 480x320) */}
                <div className="mt-4">
                  <div className="text-xs font-bold text-slate mb-1.5 flex items-center justify-between">
                    <span>LIVE TFT DISPLAY MIRROR</span>
                    <span className="text-[10px] text-mute font-mono">480×320 ILI9341</span>
                  </div>

                  <div className="bg-white border-4 border-slate/30 rounded-2xl p-6 shadow-inner text-center font-mono select-none h-60 flex flex-col justify-center items-center aspect-[480/320] max-w-sm mx-auto">
                    {status?.state === 'safe' ? (
                      <div className="space-y-2">
                        <div className="w-12 h-12 rounded-full bg-greensoft text-green flex items-center justify-center mx-auto">
                          <CheckCircle className="w-7 h-7" />
                        </div>
                        <h2 className="text-xl font-black text-green tracking-wide">SYSTEM SAFE</h2>
                        <p className="text-xs text-slate">All attack paths severed</p>
                      </div>
                    ) : status?.state === 'unsafe' ? (
                      <div className="space-y-2 max-w-xs">
                        <div className="text-sm font-black text-red uppercase tracking-wider">
                          {status.path_count} ATTACK PATHS · RISK {status.risk}
                        </div>
                        {pendingFix?.title && (
                          <div className="text-xs font-bold text-ink bg-slate/10 px-2 py-1 rounded">
                            {pendingFix.title}
                          </div>
                        )}
                        <div className="text-xs font-bold text-amber">
                          TAP BADGE TO APPROVE
                        </div>
                        <div className="text-[10px] text-mute font-semibold">
                          Paths {pendingFix?.paths_before ?? status.path_count} &rarr; {pendingFix?.paths_after ?? 0} / Risk {pendingFix?.risk_before ?? status.risk} &rarr; {pendingFix?.risk_after ?? 12}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1 text-slate">
                        <div className="text-base font-bold text-ink">AEGIS-Graph Ready</div>
                        <div className="text-xs">Waiting for analysis</div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-mute text-xs bg-bg rounded-xl border border-line">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="font-semibold text-slate">Not seen yet</p>
                <p className="mt-1">check hotspot, AEGIS_API_BASE and DEVICE_KEY</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-5 pt-3 border-t border-line flex items-center justify-between">
            <span className="text-[11px] text-mute">
              {queuedCommands['esp32-console-01'] ? (
                <span className="text-amber font-semibold">queued - device reacts within 10 s</span>
              ) : (
                'Interactive controls'
              )}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleSendCommand('esp32-console-01', 'identify')}
                disabled={!esp32?.online}
                className="px-3 py-1.5 text-xs font-semibold bg-bg hover:bg-line text-slate hover:text-ink rounded-xl border border-line transition-colors disabled:opacity-40"
              >
                Identify
              </button>
              <button
                onClick={() => handleSendCommand('esp32-console-01', 'self_test')}
                disabled={!esp32?.online}
                className="px-3 py-1.5 text-xs font-semibold bg-bg hover:bg-line text-slate hover:text-ink rounded-xl border border-line transition-colors disabled:opacity-40"
              >
                Self-test
              </button>
            </div>
          </div>
        </Card>

        {/* Device 2: Arduino UNO Q Status Board */}
        <Card className="flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="flex items-start justify-between pb-3 border-b border-line mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-base text-ink">Arduino UNO Q Status Board</h3>
                  <span className="text-xs font-mono text-mute">(unoq-status-01)</span>
                </div>
                <p className="text-xs text-mute mt-0.5">8×13 LED Matrix & Dual RGB Status Indicator</p>
              </div>

              {unoq ? (
                <Pill
                  label={unoq.online ? 'ONLINE' : 'OFFLINE'}
                  variant={unoq.online ? 'green' : 'red'}
                />
              ) : (
                <Pill label="NOT SEEN YET" variant="slate" />
              )}
            </div>

            {unoq ? (
              <div className="space-y-4">
                {/* Telemetry */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">Last Seen</span>
                    <div className="font-semibold text-ink mt-0.5">{unoq.age_s} s ago</div>
                  </div>
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">IP Address</span>
                    <div className="font-semibold text-ink mt-0.5 font-mono">{unoq.ip || '—'}</div>
                  </div>
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">Firmware</span>
                    <div className="font-semibold text-ink mt-0.5 font-mono">v{unoq.fw}</div>
                  </div>
                  <div className="bg-bg p-2.5 rounded-xl border border-line">
                    <span className="text-[10px] text-mute uppercase font-bold">Uptime</span>
                    <div className="font-semibold text-ink mt-0.5 font-mono">{unoq.uptime_s} s</div>
                  </div>
                </div>

                {/* Components */}
                <div className="p-3 bg-bg rounded-xl border border-line space-y-1.5 text-xs">
                  <div className="text-[10px] text-mute uppercase font-bold mb-1">Component Diagnostics</div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(unoq.components || {}).map(([key, val]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${val === 'ok' ? 'bg-green' : 'bg-red'}`} />
                        <span className="text-slate uppercase font-medium text-[11px]">{key}:</span>
                        <span className="font-mono text-[11px] text-ink font-semibold">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 8x13 LED Matrix Mirror */}
                <div className="mt-4">
                  <div className="text-xs font-bold text-slate mb-1.5 flex items-center justify-between">
                    <span>LIVE 8×13 LED-MATRIX MIRROR</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-mute">LED3 & LED4:</span>
                      <div className="flex items-center gap-1">
                        <span className={`w-2.5 h-2.5 rounded-full ${unoLeds.color} ring-2 ring-white shadow`} title="LED3" />
                        <span className={`w-2.5 h-2.5 rounded-full ${unoLeds.color} ring-2 ring-white shadow`} title="LED4" />
                      </div>
                      <span className="text-[10px] font-bold text-ink uppercase">{unoLeds.label}</span>
                    </div>
                  </div>

                  {/* Matrix Display Box (Navy bg, blue LED dots) */}
                  <div className="bg-[#0A0E24] border-4 border-[#1A2044] rounded-2xl p-5 shadow-2xl h-60 flex flex-col justify-center items-center overflow-hidden">
                    <div className="grid gap-1.5" style={{ gridTemplateRows: 'repeat(8, minmax(0, 1fr))' }}>
                      {matrix.map((row, rIdx) => (
                        <div key={rIdx} className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
                          {row.map((cell, cIdx) => (
                            <div
                              key={cIdx}
                              className={`w-3 h-3 rounded-full transition-colors duration-150 ${
                                cell
                                  ? 'bg-[#38BDF8] shadow-[0_0_6px_#38BDF8]'
                                  : 'bg-[#151D3B]'
                              }`}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-mute text-xs bg-bg rounded-xl border border-line">
                <Radio className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="font-semibold text-slate">Not seen yet</p>
                <p className="mt-1">check hotspot, AEGIS_API_BASE and DEVICE_KEY</p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-5 pt-3 border-t border-line flex items-center justify-between">
            <span className="text-[11px] text-mute">
              {queuedCommands['unoq-status-01'] ? (
                <span className="text-amber font-semibold">queued - device reacts within 10 s</span>
              ) : (
                'Interactive controls'
              )}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => handleSendCommand('unoq-status-01', 'identify')}
                disabled={!unoq?.online}
                className="px-3 py-1.5 text-xs font-semibold bg-bg hover:bg-line text-slate hover:text-ink rounded-xl border border-line transition-colors disabled:opacity-40"
              >
                Identify
              </button>
              <button
                onClick={() => handleSendCommand('unoq-status-01', 'self_test')}
                disabled={!unoq?.online}
                className="px-3 py-1.5 text-xs font-semibold bg-bg hover:bg-line text-slate hover:text-ink rounded-xl border border-line transition-colors disabled:opacity-40"
              >
                Self-test
              </button>
            </div>
          </div>
        </Card>
      </div>

      {/* Collapsible Pinout Wiring Reference */}
      <Card className="p-4">
        <button
          onClick={() => setShowWiring(!showWiring)}
          className="w-full flex items-center justify-between text-left font-bold text-xs uppercase tracking-wider text-slate"
        >
          <span>Physical Pinout Wiring Reference</span>
          {showWiring ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showWiring && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6 pt-3 border-t border-line text-xs font-mono">
            <div>
              <h4 className="font-bold text-ink mb-2">ESP32-S3 TFT Display (ILI9341 SPI)</h4>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line text-mute text-[10px]">
                    <th className="py-1">Pin</th>
                    <th className="py-1">GPIO</th>
                    <th className="py-1">Function</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  <tr><td className="py-1">D/C</td><td>GPIO 9</td><td>Data / Command</td></tr>
                  <tr><td className="py-1">CS</td><td>GPIO 10</td><td>Chip Select</td></tr>
                  <tr><td className="py-1">SDI</td><td>GPIO 11</td><td>SPI Data In (MOSI)</td></tr>
                  <tr><td className="py-1">SCK</td><td>GPIO 12</td><td>SPI Clock</td></tr>
                  <tr><td className="py-1">LED</td><td>GPIO 13</td><td>Backlight (PWM)</td></tr>
                  <tr><td className="py-1">RESET</td><td>GPIO 14</td><td>Hardware Reset</td></tr>
                  <tr><td className="py-1">VCC / GND</td><td>5V / G</td><td>Power</td></tr>
                </tbody>
              </table>
            </div>

            <div>
              <h4 className="font-bold text-ink mb-2">ESP32-S3 RFID Reader (RC522 SPI)</h4>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line text-mute text-[10px]">
                    <th className="py-1">Pin</th>
                    <th className="py-1">GPIO</th>
                    <th className="py-1">Function</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  <tr><td className="py-1">SDA</td><td>GPIO 4</td><td>RFID Chip Select</td></tr>
                  <tr><td className="py-1">SCK</td><td>GPIO 5</td><td>SPI Clock</td></tr>
                  <tr><td className="py-1">MOSI</td><td>GPIO 6</td><td>SPI Data Out</td></tr>
                  <tr><td className="py-1">MISO</td><td>GPIO 7</td><td>SPI Data In</td></tr>
                  <tr><td className="py-1">RST</td><td>GPIO 15</td><td>Reset</td></tr>
                  <tr><td className="py-1">3.3V / GND</td><td>3V3 / G</td><td>Power (3.3V strictly)</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </main>
  );
};
