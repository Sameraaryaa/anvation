import React, { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { Core } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {
  ShieldAlert, ShieldCheck, Activity, Bot, Sparkles, Send, Clock,
  CheckCircle2, WifiOff, Radio, Play, Pause, ArrowRight, CornerDownRight,
  Layers, Lock, Database, Server, RefreshCw
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { Card } from '../components/Card';
import { StatTile } from '../components/StatTile';
import { SeverityBadge } from '../components/SeverityBadge';
import { EmptyState } from '../components/EmptyState';
import { AskResponse } from '../types';

// Register dagre layout plugin
cytoscape.use(dagre);

/**
 * Intelligent text wrapper that cleanly breaks on hyphens, underscores,
 * colons, slashes, or whitespace, ensuring no line overflows node boxes.
 */
function wrapNodeLabel(text: string, maxLen: number = 20): string[] {
  if (!text) return [];
  const paragraphs = text.split('\n');
  const result: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= maxLen) {
      result.push(para);
      continue;
    }

    // Tokenize preserving separators (hyphens, underscores, dots, colons, spaces)
    const tokens = para.match(/([^\s\-_:.]+|[\s\-_:.])/g) || [para];
    let currentLine = '';

    for (const token of tokens) {
      if ((currentLine + token).length <= maxLen) {
        currentLine += token;
      } else {
        if (currentLine.trim()) {
          result.push(currentLine.trim());
          currentLine = token.trimStart();
        } else {
          // Token is individually longer than maxLen, chunk by character
          let remaining = token;
          while (remaining.length > maxLen) {
            result.push(remaining.slice(0, maxLen));
            remaining = remaining.slice(maxLen);
          }
          currentLine = remaining;
        }
      }
    }
    if (currentLine.trim()) {
      result.push(currentLine.trim());
    }
  }

  return result;
}

interface Packet {
  sourceId: string;
  targetId: string;
  progress: number;
  speed: number;
  color: string;
  pathId: number;
  isChoke: boolean;
}

export const Overview: React.FC = () => {
  const { analysis, status, devices, runAnalysis } = useApp();
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<Core | null>(null);
  const packetCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);

  // Packet animation toggle
  const [packetsEnabled, setPacketsEnabled] = useState(true);

  // Tooltip state for edge hover
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: any;
  }>({ visible: false, x: 0, y: 0, content: null });

  // Sentinel state
  const [question, setQuestion] = useState('');
  const [sentinelAnswer, setSentinelAnswer] = useState<AskResponse | null>(null);
  const [sentinelLoading, setSentinelLoading] = useState(false);

  // Approval audit metadata for status line
  const [approvalInfo, setApprovalInfo] = useState<{
    approver: string;
    time: string;
    secondsAfterAnalysis?: number;
  } | null>(null);

  // Check if console is online
  const consoleDevice = devices.find((d) => d.device_id === 'esp32-console-01');
  const consoleOnline = consoleDevice?.online ?? false;

  // Fetch audit when analysis is applied to find approver & timestamp
  const fetchApprovalMetadata = useCallback(async () => {
    try {
      const auditRes = await api.getAudit();
      const entries = auditRes.entries;
      const fixEntry = entries.find((e) => e.event === 'fix_applied');
      const analysisEntry = entries.find((e) => e.event === 'analysis_run');

      if (fixEntry) {
        const d = new Date(fixEntry.ts * 1000);
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const delta = analysisEntry ? Math.max(1, fixEntry.ts - analysisEntry.ts) : 4;
        setApprovalInfo({
          approver: fixEntry.entry?.approver || 'Security Lead',
          time: timeStr,
          secondsAfterAnalysis: delta,
        });
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (analysis?.applied) {
      fetchApprovalMetadata();
    } else {
      setApprovalInfo(null);
    }
  }, [analysis?.applied, fetchApprovalMetadata]);

  // Cytoscape initialization and layout updates
  useEffect(() => {
    if (!cyRef.current || !analysis) return;

    const elements: cytoscape.ElementDefinition[] = [];

    // Map nodes to path IDs
    const nodePathsMap: Record<string, number[]> = {};
    (analysis.paths || []).forEach((path) => {
      path.nodes.forEach((nId) => {
        if (!nodePathsMap[nId]) nodePathsMap[nId] = [];
        if (!nodePathsMap[nId].includes(path.id)) {
          nodePathsMap[nId].push(path.id);
        }
      });
    });

    const formatMisconfig = (m: string): string => {
      const dict: Record<string, string> = {
        sg_open_world: '0.0.0.0/0 - SSRF',
        weak_sandbox: 'public - escape',
        key_in_client_code: 'in client code',
        passrole_wildcard: 'iam:PassRole *',
        ssrf_vulnerable_proxy: '0.0.0.0/0 - SSRF',
        tokenless_imds_hop_limit_unrestricted: 'IMDSv1 tokenless',
        s3_wildcard_read: 's3:* read',
        overprivileged_policy: 'AdministratorAccess',
        exposed_service: 'exposed service',
        unrestricted_metadata: 'unrestricted metadata',
      };
      return dict[m] || m.replace(/[_-]/g, ' ');
    };

    const formatSensitivity = (s: string): string => {
      const dict: Record<string, string> = {
        children_pii: "children's records",
        pci_credit_cards: 'cardholder data',
        confidential_data: 'confidential data',
        uploads: 'uploads',
      };
      return dict[s] || s.replace(/[_-]/g, ' ');
    };

    // Add Nodes
    analysis.nodes.forEach((node) => {
      const primaryTitle = node.label || node.id;
      const paths = nodePathsMap[node.id] || [];

      let shape: cytoscape.Css.NodeShape = 'round-rectangle';
      let bgColor = '#FFFFFF';
      let borderColor = '#CBD5E1';
      let borderWidth = 2;
      let borderStyle: cytoscape.Css.LineStyle = 'solid';
      let textColor = '#202124';

      const subLines: string[] = [];

      if (node.entry) {
        shape = 'ellipse';
        borderColor = '#D93025';
        borderWidth = 2.5;
        bgColor = '#FCE8E6';
        textColor = '#C5221F';
        subLines.push('ENTRY POINT');
      } else if (node.crown_jewel) {
        shape = 'round-rectangle';
        borderColor = '#D93025';
        borderWidth = 2.5;
        bgColor = '#FCE8E6';
        textColor = '#C5221F';
        if (node.sensitivity) {
          subLines.push(formatSensitivity(node.sensitivity));
        }
        subLines.push('CROWN JEWEL');
      } else if (node.choke) {
        shape = 'round-rectangle';
        borderColor = '#F2990A';
        borderWidth = 3;
        bgColor = '#FEF7E0';
        textColor = '#B06000';
        if (node.misconfig && node.misconfig.length > 0) {
          subLines.push(node.misconfig.map(formatMisconfig).join(' | '));
        }
        if (node.name_ref) {
          subLines.push(node.name_ref);
        } else if (node.privilege) {
          subLines.push(node.privilege === 'admin' ? 'full access' : node.privilege);
        }
      } else {
        // Normal intermediate or blast radius nodes
        if (node.misconfig && node.misconfig.length > 0) {
          subLines.push(node.misconfig.map(formatMisconfig).join(' | '));
        } else if (node.privilege) {
          subLines.push(node.privilege === 'admin' ? 'full access' : `privilege: ${node.privilege}`);
        } else if (node.name_ref) {
          subLines.push(node.name_ref);
        } else if (node.sensitivity) {
          subLines.push(formatSensitivity(node.sensitivity));
        } else if (node.public) {
          subLines.push('public');
        }

        // Color border according to which attack path traverses it
        if (paths.length === 1) {
          if (paths[0] === 1) borderColor = '#1A73E8'; // Google Blue Path 1
          else if (paths[0] === 2) borderColor = '#7C3AED'; // Violet Path 2
          else if (paths[0] === 3) borderColor = '#0891B2'; // Cyan Path 3
          else borderColor = '#4F5775';
          borderWidth = 2;
        } else if (paths.length >= 2) {
          borderColor = '#D93025'; // Converging critical attack path
          borderWidth = 2.5;
        } else {
          // Off-path / blast radius
          borderColor = '#CBD5E1';
          borderStyle = 'dashed';
          borderWidth = 1.5;
          textColor = '#5F6368';
          if (subLines.length === 0) {
            subLines.push('blast radius');
          }
        }
      }

      // Format lines with word wrap so text NEVER overflows node box
      const wrappedTitle = wrapNodeLabel(primaryTitle, 20);
      const allLines: string[] = [];

      if (node.choke) {
        allLines.push('CHOKE POINT');
      }
      allLines.push(...wrappedTitle);
      for (const s of subLines) {
        allLines.push(...wrapNodeLabel(s, 20));
      }

      const fullLabel = allLines.join('\n');
      const maxLineLen = Math.max(...allLines.map((l) => l.length), 0);
      const lineCount = allLines.length;

      let width = 170;
      let height = 72;

      if (node.entry) {
        shape = 'ellipse';
        borderColor = '#D93025';
        borderWidth = 2.5;
        width = 100;
        height = 100;
      } else {
        // Generous box padding: character width ~8.5px + 48px padding
        width = Math.max(170, Math.min(340, Math.round(maxLineLen * 8.6 + 48)));
        height = Math.max(72, lineCount * 19 + 32);

        if (node.crown_jewel) {
          shape = 'round-rectangle';
          borderColor = '#D93025';
          borderWidth = 2.5;
          bgColor = '#FCE8E6';
          textColor = '#C5221F';
          width = Math.max(width, 180);
          height = Math.max(height, 80);
        } else if (node.choke) {
          shape = 'round-rectangle';
          borderColor = '#F2990A';
          borderWidth = 3;
          bgColor = '#FEF7E0';
          textColor = '#B06000';
          width = Math.max(width, 190);
          height = Math.max(height, 90);
        }
      }

      const textMaxWidth = Math.max(width - 24, 100);
      const opacity = analysis.applied && !node.reachable ? 0.35 : 1.0;

      elements.push({
        data: {
          id: node.id,
          label: fullLabel,
          type: node.type,
          nodeData: node,
          shape,
          width,
          height,
          textMaxWidth,
          bgColor,
          borderColor,
          borderWidth,
          borderStyle,
          textColor,
          opacity,
        },
        style: {
          shape,
          width,
          height,
          label: fullLabel,
          'text-max-width': `${textMaxWidth}px`,
          'background-color': bgColor,
          'border-color': borderColor,
          'border-width': borderWidth,
          'border-style': borderStyle,
          'color': textColor,
          'opacity': opacity,
        },
      });
    });

    // Add Edges
    analysis.edges.forEach((edge) => {
      let lineColor = '#94A3B8';
      let width = 1.5;
      let lineStyle: cytoscape.Css.LineStyle = 'solid';
      let label = '';

      if (edge.removed) {
        lineStyle = 'dashed';
        lineColor = '#94A3B8';
        label = 'fixed';
      } else if (edge.paths.length >= 2) {
        lineColor = '#D93025';
        width = 3.5;
      } else if (edge.paths.includes(1)) {
        lineColor = '#1A73E8'; // Google Blue
        width = 2.5;
      } else if (edge.paths.includes(2)) {
        lineColor = '#7C3AED';
        width = 2.5;
      } else if (edge.paths.includes(3)) {
        lineColor = '#0891B2';
        width = 2.5;
      } else {
        lineStyle = 'dashed';
        lineColor = '#CBD5E1';
      }

      elements.push({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: label,
          edgeData: edge,
        },
        style: {
          'line-color': lineColor,
          'target-arrow-color': lineColor,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'width': width,
          'line-style': lineStyle,
          'label': label,
          'font-size': 10,
          'text-background-color': '#FFFFFF',
          'text-background-opacity': 0.85,
          'text-background-padding': 2,
        },
      });
    });

    if (cyInstance.current) {
      cyInstance.current.destroy();
    }

    const cy = cytoscape({
      container: cyRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'font-family': 'Inter, system-ui, -apple-system, sans-serif',
            'font-size': '11px',
            'font-weight': 600,
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': 'data(textMaxWidth)' as any,
            'line-height': 1.3,
            'text-justification': 'center',
            'shape': 'data(shape)' as any,
            'width': 'data(width)' as any,
            'height': 'data(height)' as any,
            'background-color': 'data(bgColor)',
            'border-color': 'data(borderColor)',
            'border-width': 'data(borderWidth)' as any,
            'border-style': 'data(borderStyle)' as any,
            'color': 'data(textColor)',
            'opacity': 'data(opacity)' as any,
            'padding': '10px',
            'transition-property': 'background-color, border-color, opacity',
            'transition-duration': 300,
          },
        },
        {
          selector: 'edge',
          style: {
            'arrow-scale': 1.25,
          },
        },
      ],
      layout: {
        name: 'dagre',
        rankDir: 'LR',
        nodeSep: 55,
        rankSep: 110,
        padding: 40,
      } as any,
      wheelSensitivity: 0.2,
      maxZoom: 2.0,
      minZoom: 0.35,
    });

    cy.ready(() => {
      cy.fit(undefined, 35);
    });

    // Edge hover tooltips
    cy.on('mouseover', 'edge', (e) => {
      const edge = e.target;
      const data = edge.data('edgeData');
      const pos = e.renderedPosition;
      setTooltip({
        visible: true,
        x: pos.x,
        y: pos.y,
        content: data,
      });
    });

    cy.on('mouseout', 'edge', () => {
      setTooltip((prev) => ({ ...prev, visible: false }));
    });

    cyInstance.current = cy;

    return () => {
      if (cyInstance.current) {
        cyInstance.current.destroy();
        cyInstance.current = null;
      }
    };
  }, [analysis]);

  // Animated Telemetry & Attack Packets Loop
  useEffect(() => {
    if (!analysis || !packetCanvasRef.current) return;
    const canvas = packetCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Build active packets along paths
    const packets: Packet[] = [];
    const activePaths = analysis.paths || [];

    if (activePaths.length > 0) {
      activePaths.forEach((p) => {
        for (let i = 0; i < p.nodes.length - 1; i++) {
          const u = p.nodes[i];
          const v = p.nodes[i + 1];
          const isChoke = analysis.choke_point?.id === u || analysis.choke_point?.id === v;
          const color = analysis.applied
            ? '#1E8E3E' // Google Green
            : isChoke
            ? '#F2990A' // Google Amber
            : p.id === 1
            ? '#D93025' // Google Red
            : '#1A73E8'; // Google Blue

          // 2 packets per active edge, staggered
          packets.push({
            sourceId: u,
            targetId: v,
            progress: (i * 0.25) % 1.0,
            speed: 0.009 + (p.id * 0.002),
            color,
            pathId: p.id,
            isChoke,
          });
          packets.push({
            sourceId: u,
            targetId: v,
            progress: ((i * 0.25) + 0.5) % 1.0,
            speed: 0.009 + (p.id * 0.002),
            color,
            pathId: p.id,
            isChoke,
          });
        }
      });
    }

    let isRunning = true;

    const renderPackets = () => {
      if (!isRunning) return;

      const cy = cyInstance.current;
      if (!cy || !packetsEnabled) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        animFrameRef.current = requestAnimationFrame(renderPackets);
        return;
      }

      // Ensure canvas matches container dimensions
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      packets.forEach((pkt) => {
        pkt.progress += pkt.speed;
        if (pkt.progress > 1.0) pkt.progress = 0;

        const nodeU = cy.getElementById(pkt.sourceId);
        const nodeV = cy.getElementById(pkt.targetId);

        if (!nodeU || !nodeV || nodeU.length === 0 || nodeV.length === 0) return;

        const posU = nodeU.renderedPosition();
        const posV = nodeV.renderedPosition();

        const x = posU.x + (posV.x - posU.x) * pkt.progress;
        const y = posU.y + (posV.y - posU.y) * pkt.progress;

        // Draw packet halo
        ctx.save();
        ctx.shadowColor = pkt.color;
        ctx.shadowBlur = 8;

        // Core dot
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();

        // Glowing outer pulse ring
        ctx.strokeStyle = pkt.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 4.5, 0, Math.PI * 2);
        ctx.stroke();

        // Trail dot
        const trailX = x - (posV.x - posU.x) * 0.04;
        const trailY = y - (posV.y - posU.y) * 0.04;
        ctx.fillStyle = pkt.color;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(trailX, trailY, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      });

      animFrameRef.current = requestAnimationFrame(renderPackets);
    };

    animFrameRef.current = requestAnimationFrame(renderPackets);

    return () => {
      isRunning = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [analysis, packetsEnabled]);

  const handleAskSentinel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setSentinelLoading(true);
    try {
      const res = await api.askSentinel(question);
      setSentinelAnswer(res);
    } catch {
      setSentinelAnswer({
        answer: 'Failed to contact Sentinel engine.',
        grounded: false,
        cited: [],
        mode: 'template',
        model: 'gemini-2.5-flash-lite',
      });
    } finally {
      setSentinelLoading(false);
    }
  };

  const askPreset = async (promptText: string) => {
    setQuestion(promptText);
    setSentinelLoading(true);
    try {
      const res = await api.askSentinel(promptText);
      setSentinelAnswer(res);
    } catch {
      setSentinelAnswer({
        answer: 'Failed to query Sentinel.',
        grounded: false,
        cited: [],
        mode: 'template',
        model: 'gemini-2.5-flash-lite',
      });
    } finally {
      setSentinelLoading(false);
    }
  };

  if (!analysis) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <EmptyState onAction={() => runAnalysis()} />
      </main>
    );
  }

  const pfix = analysis.recommended_fixes?.[0];
  const activePaths = analysis.paths || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Security Command Center
            </span>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-semibold text-blue-600">
              Attack Graph Intelligence
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <span>{analysis.display_name}</span>
            {analysis.applied ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> SYSTEM SAFE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-rose-50 text-rose-700 px-2.5 py-0.5 rounded-full border border-rose-200">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-600" /> OPEN ATTACK VECTORS
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Directed acyclic graph representation showing entry-to-crown-jewel threat vectors and minimum-cut choke point
          </p>
        </div>

        {/* Choke Point & Status Pill */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200/80 text-xs font-semibold text-amber-800">
            <Activity className="w-3.5 h-3.5 text-amber-600" />
            <span>Choke Point:</span>
            <span className="font-bold underline decoration-amber-400">
              {analysis.choke_point ? analysis.choke_point.label : 'None'}
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Attack Graph (Left) & Security Analytics (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Cytoscape Attack Graph with Packet Overlay */}
        <div className="lg:col-span-8 bg-white border border-slate-200/80 rounded-xl shadow-xs overflow-hidden flex flex-col h-[650px] relative">
          {/* Graph Header Bar */}
          <div className="px-4 py-2.5 border-b border-slate-200/80 bg-slate-50/80 backdrop-blur flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Attack Topology
              </span>
              <span className="text-[11px] text-slate-400 font-mono hidden sm:inline">
                Dagre Directed Flow
              </span>
            </div>

            {/* Packets Toggle & Legend */}
            <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
              {/* Animated Packets Toggle */}
              <button
                type="button"
                onClick={() => setPacketsEnabled(!packetsEnabled)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-all ${
                  packetsEnabled
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-slate-100 text-slate-500 border-slate-200'
                }`}
                title="Toggle live animated attack packet visualization"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${packetsEnabled ? 'bg-blue-600 animate-ping' : 'bg-slate-400'}`} />
                <span>Packets: {packetsEnabled ? 'Streaming' : 'Paused'}</span>
              </button>

              {/* Legend */}
              <div className="hidden md:flex items-center gap-2.5 text-[11px] text-slate-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full border border-rose-500 bg-rose-100" /> Entry
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-amber-100 border border-amber-500" /> Choke
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded bg-rose-100 border border-rose-500" /> Crown Jewel
                </span>
              </div>
            </div>
          </div>

          {/* Graph Canvas Container with Packet Overlay */}
          <div className="w-full flex-1 bg-[#FAFAFC] relative overflow-hidden">
            <div ref={cyRef} className="w-full h-full absolute inset-0" />
            <canvas
              ref={packetCanvasRef}
              className="w-full h-full absolute inset-0 pointer-events-none z-10"
            />
          </div>

          {/* Floating Tooltip */}
          {tooltip.visible && tooltip.content && (
            <div
              className="absolute z-30 pointer-events-none bg-white border border-slate-200 rounded-lg shadow-md p-3 text-xs w-64 transform -translate-x-1/2 -translate-y-full mb-2"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <div className="font-bold text-slate-900 mb-1 flex items-center justify-between">
                <span>{tooltip.content.type || 'Connection'}</span>
                <span className="text-blue-600 font-mono">{tooltip.content.technique || 'T1000'}</span>
              </div>
              <div className="text-slate-600 text-[11px] space-y-0.5">
                <div>Difficulty: <b className="text-slate-900">{tooltip.content.difficulty}</b></div>
                {tooltip.content.fix && (
                  <div>Fix available: <b className="text-emerald-600">{tooltip.content.fix}</b></div>
                )}
                {tooltip.content.paths?.length > 0 && (
                  <div>Traversed by: <b className="text-slate-900">Path #{tooltip.content.paths.join(', #')}</b></div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Security Analytics & Fix Panel */}
        <div className="lg:col-span-4 space-y-4">
          {/* Stat Tiles */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Risk Metric"
              value={analysis.applied ? analysis.after.risk : analysis.before.risk}
              max={100}
              showBar
              severity={
                (analysis.applied ? analysis.after.risk : analysis.before.risk) >= 85
                  ? 'Critical'
                  : (analysis.applied ? analysis.after.risk : analysis.before.risk) >= 70
                  ? 'High'
                  : (analysis.applied ? analysis.after.risk : analysis.before.risk) >= 40
                  ? 'Medium'
                  : 'Low'
              }
            />
            <StatTile
              label="Blast Radius"
              value={`${analysis.applied ? analysis.after.blast_count : analysis.before.blast_count} nodes`}
              subValue={`${analysis.applied ? analysis.after.blast_weighted : analysis.before.blast_weighted} weighted`}
              color="blue"
            />
          </div>

          {/* Recommended Min-Cut Fix Card */}
          <Card className="border-amber-200/80 bg-gradient-to-b from-amber-50/50 to-white p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                1
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber-800">
                  Recommended Remediation
                </h3>
                <p className="text-xs font-semibold text-slate-800">
                  Breaks all {analysis.before.path_count} attack path(s) at choke point
                </p>
              </div>
            </div>

            {pfix && (
              <div className="mt-2 p-3 bg-white border border-amber-200/80 rounded-lg space-y-1 shadow-2xs">
                <div className="font-bold text-xs text-slate-900">{pfix.title}</div>
                <p className="text-xs text-slate-600 leading-snug">{pfix.detail}</p>
                <div className="pt-1.5 text-[11px] font-mono text-slate-500 flex items-center gap-1">
                  <span>Severed:</span>
                  <span className="text-slate-900 font-semibold">
                    {pfix.removes_edges.map(([u, v]) => `${u} -> ${v}`).join(', ')}
                  </span>
                </div>
              </div>
            )}

            {/* Approval Hardware Status */}
            <div className="mt-3 pt-2.5 border-t border-amber-200/60 text-xs">
              {analysis.applied ? (
                <div className="flex items-center gap-2 text-emerald-700 font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Approved by {approvalInfo?.approver || 'Security Lead'}
                    {approvalInfo?.time ? ` at ${approvalInfo.time}` : ''}
                  </span>
                </div>
              ) : status?.pending_fix ? (
                consoleOnline ? (
                  <div className="flex items-center gap-2 text-amber-700 font-semibold">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                    </span>
                    <span>Waiting for badge tap on physical console (esp32-console-01)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-rose-700 font-semibold">
                    <WifiOff className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Console offline - verify ESP32 Wi-Fi connection</span>
                  </div>
                )
              ) : (
                <span className="text-slate-500">No fix pending approval.</span>
              )}
            </div>
          </Card>

          {/* Attack Paths List */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Discovered Vectors ({activePaths.length})
              </h3>
              {analysis.applied && (
                <span className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> All Severed
                </span>
              )}
            </div>

            <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
              {activePaths.map((p, idx) => {
                const colors = ['bg-blue-600', 'bg-purple-600', 'bg-cyan-600'];
                const badgeBg = colors[idx % colors.length];

                return (
                  <div
                    key={p.id}
                    className={`p-2.5 rounded-lg border text-xs transition-colors ${
                      analysis.applied ? 'border-slate-200 bg-slate-50/70 opacity-70' : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${badgeBg}`}>
                          {p.id}
                        </span>
                        <span className="font-semibold text-slate-900">Path #{p.id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 font-mono">
                          diff {p.difficulty} - {p.hops} hops
                        </span>
                        <SeverityBadge severity={p.severity} />
                      </div>
                    </div>

                    <div className="font-mono text-[11px] text-slate-600 break-words flex items-center flex-wrap gap-1 leading-snug">
                      {p.nodes.map((nodeId, nIdx) => (
                        <React.Fragment key={nIdx}>
                          <span className={nodeId === analysis.choke_point?.id ? 'text-amber-700 font-bold bg-amber-50 px-1 rounded' : ''}>
                            {nodeId}
                          </span>
                          {nIdx < p.nodes.length - 1 && <span className="text-slate-400">{'->'}</span>}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* Sentinel AI Assistant (Google Gemini Style) */}
      <Card className="p-5 border-slate-200/80 bg-white shadow-xs">
        <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-slate-200/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200/60 flex items-center justify-center shadow-2xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Sentinel AI Security Copilot
              </h3>
              <p className="text-[11px] text-slate-500">
                Grounded in mathematical graph proofs and IAM policies (Gemini 2.5 Flash Lite)
              </p>
            </div>
          </div>

          {sentinelAnswer && (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">
                <CheckCircle2 className="w-3 h-3" /> Grounded in graph
              </span>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                {sentinelAnswer.mode}
              </span>
            </div>
          )}
        </div>

        {/* Answer Display */}
        {sentinelAnswer ? (
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 mb-3 text-xs leading-relaxed text-slate-800">
            <p className="font-medium whitespace-pre-line">{sentinelAnswer.answer}</p>
            {sentinelAnswer.cited?.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-slate-200 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-slate-500 font-semibold">Cited Resources:</span>
                {sentinelAnswer.cited.map((token) => (
                  <span key={token} className="text-[10px] font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded text-blue-700 font-semibold">
                    {token}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="py-1 mb-2 text-xs text-slate-500">
            Ask questions about attack paths, choke points, or remediations:
          </div>
        )}

        {/* Preset Chips */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button
            type="button"
            onClick={() => askPreset('How can an attacker reach the protected crown jewel database?')}
            className="text-[11px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200 transition-colors"
          >
            Attack path to DB?
          </button>
          <button
            type="button"
            onClick={() => askPreset('What is the choke point and how does the fix resolve it?')}
            className="text-[11px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200 transition-colors"
          >
            Choke point explanation
          </button>
          <button
            type="button"
            onClick={() => askPreset('What is the blast radius reduction?')}
            className="text-[11px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md border border-slate-200 transition-colors"
          >
            Blast radius reduction
          </button>
        </div>

        {/* Query Input */}
        <form onSubmit={handleAskSentinel} className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask Sentinel AI about graph topology or remediations..."
            className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
          <button
            type="submit"
            disabled={sentinelLoading || !question.trim()}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50 shadow-xs"
          >
            {sentinelLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            <span>Ask</span>
          </button>
        </form>
      </Card>
    </div>
  );
};
