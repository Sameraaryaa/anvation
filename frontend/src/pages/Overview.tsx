import React, { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { Core } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import {
  ShieldAlert, ShieldCheck, Zap, Bot, Sparkles, Send, Clock,
  CheckCircle2, WifiOff
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

export const Overview: React.FC = () => {
  const { analysis, status, devices, runAnalysis } = useApp();
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<Core | null>(null);

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
        sg_open_world: '0.0.0.0/0 · SSRF',
        weak_sandbox: 'public · sandbox esc.',
        key_in_client_code: 'in client code',
        passrole_wildcard: 'iam:PassRole *',
        ssrf_vulnerable_proxy: '0.0.0.0/0 · SSRF',
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
      let textColor = '#12152B';

      const subLines: string[] = [];

      if (node.entry) {
        shape = 'ellipse';
        borderColor = '#DC2626';
        borderWidth = 2.5;
        subLines.push('entry point');
      } else if (node.crown_jewel) {
        shape = 'round-rectangle';
        borderColor = '#DC2626';
        borderWidth = 2.5;
        bgColor = '#FEF2F2';
        textColor = '#991B1B';
        if (node.sensitivity) {
          subLines.push(formatSensitivity(node.sensitivity));
        }
        subLines.push('CROWN JEWEL ●');
      } else if (node.choke) {
        shape = 'round-rectangle';
        borderColor = '#D97706';
        borderWidth = 3;
        bgColor = '#FEF3C7';
        textColor = '#92400E';
        if (node.misconfig && node.misconfig.length > 0) {
          subLines.push(node.misconfig.map(formatMisconfig).join(' · '));
        }
        if (node.name_ref) {
          subLines.push(node.name_ref);
        } else if (node.privilege) {
          subLines.push(node.privilege === 'admin' ? 'full access' : node.privilege);
        }
      } else {
        // Normal intermediate or blast radius nodes
        if (node.misconfig && node.misconfig.length > 0) {
          subLines.push(node.misconfig.map(formatMisconfig).join(' · '));
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
          if (paths[0] === 1) borderColor = '#7C3AED'; // Violet Path 1
          else if (paths[0] === 2) borderColor = '#2563EB'; // Blue Path 2
          else if (paths[0] === 3) borderColor = '#0891B2'; // Cyan Path 3
          else borderColor = '#6366F1';
          borderWidth = 2;
        } else if (paths.length >= 2) {
          borderColor = '#475569'; // Converging attack path
          borderWidth = 2;
        } else {
          // Off-path / blast radius
          borderColor = '#CBD5E1';
          borderStyle = 'dashed';
          borderWidth = 1.5;
          textColor = '#64748B';
          if (subLines.length === 0) {
            subLines.push('blast radius');
          }
        }
      }

      // Compose full label
      let fullLabel = primaryTitle;
      if (node.choke) {
        fullLabel = `CHOKE POINT\n${primaryTitle}`;
        if (subLines.length > 0) {
          fullLabel += `\n${subLines.join('\n')}`;
        }
      } else if (subLines.length > 0) {
        fullLabel = `${primaryTitle}\n${subLines.join('\n')}`;
      }

      // Calculate dynamic dimensions so text never overflows the box
      const lines = fullLabel.split('\n');
      const maxLineLen = Math.max(...lines.map((l) => l.length), 0);
      const lineCount = lines.length;

      let width = 160;
      let height = 68;

      if (node.entry) {
        shape = 'ellipse';
        borderColor = '#DC2626';
        borderWidth = 2.5;
        width = 96;
        height = 96;
      } else {
        // Dynamic card width and height to comfortably enclose multi-line or long labels
        width = Math.max(160, Math.min(320, Math.round(maxLineLen * 8.2 + 36)));
        height = Math.max(68, lineCount * 19 + 24);

        if (node.crown_jewel) {
          shape = 'round-rectangle';
          borderColor = '#DC2626';
          borderWidth = 2.5;
          bgColor = '#FEF2F2';
          textColor = '#991B1B';
          width = Math.max(width, 168);
          height = Math.max(height, 74);
        } else if (node.choke) {
          shape = 'round-rectangle';
          borderColor = '#D97706';
          borderWidth = 3;
          bgColor = '#FEF3C7';
          textColor = '#92400E';
          width = Math.max(width, 178);
          height = Math.max(height, 86);
        }
      }

      const textMaxWidth = Math.max(width - 20, 80);

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
        // Shared attack route on 2+ paths
        lineColor = '#DC2626';
        width = 4;
      } else if (edge.paths.includes(1)) {
        lineColor = '#7C3AED'; // Path 1 Violet
        width = 2.5;
      } else if (edge.paths.includes(2)) {
        lineColor = '#2563EB'; // Path 2 Blue
        width = 2.5;
      } else if (edge.paths.includes(3)) {
        lineColor = '#0891B2'; // Path 3 Cyan
        width = 2.5;
      } else {
        // Non-path edge (blast radius only)
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
            'line-height': 1.25,
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
            'padding': '8px',
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
        nodeSep: 45,
        rankSep: 95,
        padding: 35,
      } as any,
      wheelSensitivity: 0.2, // Prevent sensitivity spikes
      maxZoom: 2.0,
      minZoom: 0.4,
    });

    // Fit to view on load
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
      }
    };
  }, [analysis]);

  // Sentinel submit handler
  const handleAskSentinel = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!question.trim()) return;

    setSentinelLoading(true);
    try {
      const res = await api.askSentinel(question);
      setSentinelAnswer(res);
    } catch (err: any) {
      console.error(err);
    } finally {
      setSentinelLoading(false);
    }
  };

  const askPreset = async (q: string) => {
    setQuestion(q);
    setSentinelLoading(true);
    try {
      const res = await api.askSentinel(q);
      setSentinelAnswer(res);
    } catch (err: any) {
      console.error(err);
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

  const pfix = analysis.recommended_fixes[0];
  const activePaths = analysis.applied ? (analysis.paths_before || []) : analysis.paths;

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Banner: Scenario Title & Status Overview */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight flex items-center gap-2">
            <span>{analysis.display_name}</span>
            {analysis.applied ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-greensoft text-green px-2.5 py-0.5 rounded-full border border-green/20">
                <ShieldCheck className="w-3.5 h-3.5" /> SYSTEM SAFE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold bg-redsoft text-red px-2.5 py-0.5 rounded-full border border-red/20">
                <ShieldAlert className="w-3.5 h-3.5" /> UNSAFE · PATHS OPEN
              </span>
            )}
          </h1>
          <p className="text-xs text-mute mt-0.5">
            Directed acyclic attack graph · entry to crown jewel simple paths with immediate dominator cut
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate">Choke point:</span>
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-ambersoft text-amber border border-amber/30">
            <Zap className="w-3.5 h-3.5" />
            {analysis.choke_point ? analysis.choke_point.label : 'None'}
          </span>
        </div>
      </div>

      {/* Main Grid: Graph (left) | Side Panel (right 380px) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Cytoscape Attack Graph (~65%) */}
        <div className="lg:col-span-8 bg-card border border-line rounded-card shadow-card overflow-hidden flex flex-col h-[640px] relative">
          <div className="px-4 py-3 border-b border-line bg-white/80 backdrop-blur flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate">Attack Path Graph</span>
              <span className="text-[11px] text-mute font-mono">Dagre Left-to-Right</span>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-3 text-[11px] font-semibold text-mute">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full border border-red bg-red/10" /> Entry
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-ambersoft border border-amber" /> Choke
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded bg-redsoft border border-red" /> Jewel
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-red" /> Shared Route
              </span>
            </div>
          </div>

          {/* Graph Canvas */}
          <div ref={cyRef} className="w-full flex-1 bg-[#FAFAFC]" />

          {/* Floating Tooltip */}
          {tooltip.visible && tooltip.content && (
            <div
              className="absolute z-30 pointer-events-none bg-white border border-line rounded-xl shadow-lg p-3 text-xs w-64 transform -translate-x-1/2 -translate-y-full mb-2"
              style={{ left: tooltip.x, top: tooltip.y }}
            >
              <div className="font-bold text-ink mb-1 flex items-center justify-between">
                <span>{tooltip.content.type || 'Connection'}</span>
                <span className="text-violet font-mono">{tooltip.content.technique || 'T1000'}</span>
              </div>
              <div className="text-slate text-[11px] space-y-0.5">
                <div>Difficulty: <b className="text-ink">{tooltip.content.difficulty}</b></div>
                {tooltip.content.fix && (
                  <div>Fix available: <b className="text-green">{tooltip.content.fix}</b></div>
                )}
                {tooltip.content.paths?.length > 0 && (
                  <div>Traversed by paths: <b className="text-ink">{tooltip.content.paths.join(', ')}</b></div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: Side Panel (380px) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Risk Score & Blast Radius Tiles */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Overall Risk"
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

          {/* Smallest Fix Card (Amber) */}
          <Card className="border-amber/40 bg-gradient-to-b from-ambersoft/40 to-white">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-amber text-white flex items-center justify-center">
                <Zap className="w-4 h-4 fill-white" />
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-amber">Recommended Min-Cut Fix</h3>
                <p className="text-sm font-extrabold text-ink leading-tight">1 fix breaks all {analysis.before.path_count} paths</p>
              </div>
            </div>

            {pfix && (
              <div className="mt-2 p-3 bg-white border border-amber/20 rounded-xl space-y-1">
                <div className="font-bold text-xs text-ink">{pfix.title}</div>
                <p className="text-xs text-slate">{pfix.detail}</p>
                <div className="pt-2 text-[11px] font-mono text-mute flex items-center gap-1">
                  <span>Removes:</span>
                  <span className="text-ink font-semibold">
                    {pfix.removes_edges.map(([u, v]) => `${u} → ${v}`).join(', ')}
                  </span>
                </div>
              </div>
            )}

            {/* Approval Status Line */}
            <div className="mt-3 pt-3 border-t border-amber/20 text-xs">
              {analysis.applied ? (
                <div className="flex items-center gap-2 text-green font-semibold">
                  <CheckCircle2 className="w-4 h-4 text-green" />
                  <span>
                    Approved by {approvalInfo?.approver || 'Security Lead'}
                    {approvalInfo?.time ? ` at ${approvalInfo.time}` : ''}
                  </span>
                </div>
              ) : status?.pending_fix ? (
                consoleOnline ? (
                  <div className="flex items-center gap-2 text-amber font-semibold">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber"></span>
                    </span>
                    <span>Waiting for an authorised badge on the console (esp32-console-01)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-red font-semibold">
                    <WifiOff className="w-4 h-4 text-red" />
                    <span>Console offline — approval unavailable</span>
                  </div>
                )
              ) : (
                <span className="text-slate">No fix pending approval.</span>
              )}
            </div>
          </Card>

          {/* Attack Paths List */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate">
                Attack Paths ({activePaths.length})
              </h3>
              {analysis.applied && (
                <span className="text-[11px] font-semibold text-green">All Severed ✓</span>
              )}
            </div>

            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {activePaths.map((p, idx) => {
                const colorChips = ['bg-violet text-white', 'bg-blue text-white', 'bg-cyan text-white'];
                const chipColor = colorChips[idx % colorChips.length];

                return (
                  <div
                    key={p.id}
                    className={`p-2.5 rounded-xl border text-xs transition-colors ${
                      analysis.applied ? 'border-line bg-bg opacity-70' : 'border-line hover:border-slate/40 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${chipColor}`}>
                          {p.id}
                        </span>
                        <span className="font-bold text-ink">Path {p.id}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-mute font-mono">diff {p.difficulty} · {p.hops} hops</span>
                        <SeverityBadge severity={p.severity} />
                      </div>
                    </div>

                    <div className="font-mono text-[11px] text-slate break-words flex items-center flex-wrap gap-1 leading-snug">
                      {p.nodes.map((nodeId, nIdx) => (
                        <React.Fragment key={nIdx}>
                          <span className={nodeId === 'role_overpriv' ? 'text-amber font-bold' : nodeId === 'db_parent_portal' ? 'text-red font-bold' : ''}>
                            {nodeId}
                          </span>
                          {nIdx < p.nodes.length - 1 && <span className="text-mute">&rarr;</span>}
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

      {/* Bottom Row: Sentinel Panel + Before/After Comparison Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Sentinel Assistant Panel (7 cols) */}
        <Card className="lg:col-span-7 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-line">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-violet/10 text-violet flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Sentinel AI Assistant</h3>
                  <p className="text-[11px] text-mute">Read-only, grounded in graph facts</p>
                </div>
              </div>

              {sentinelAnswer && (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-greensoft text-green px-2 py-0.5 rounded-full border border-green/20">
                    <Sparkles className="w-3 h-3" /> Grounded in graph
                  </span>
                  <span className="text-[10px] font-mono text-mute bg-line px-1.5 py-0.5 rounded">
                    {sentinelAnswer.mode}
                  </span>
                </div>
              )}
            </div>

            {/* Answer Display */}
            {sentinelAnswer ? (
              <div className="p-3 bg-bg rounded-xl border border-line mb-4 text-xs leading-relaxed text-ink">
                <p className="font-medium">{sentinelAnswer.answer}</p>
                {sentinelAnswer.cited?.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-line/60 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-mute font-semibold">Cited Resources:</span>
                    {sentinelAnswer.cited.map((token) => (
                      <span key={token} className="text-[10px] font-mono bg-white border border-line px-1.5 py-0.5 rounded text-violet font-semibold">
                        {token}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-2 mb-2 text-xs text-mute flex items-center gap-2">
                <span>Ask questions about attack paths, choke points, or remediations. Try:</span>
              </div>
            )}

            {/* Suggested Prompts */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button
                type="button"
                onClick={() => askPreset('How can an attacker reach the parent portal database?')}
                className="text-[11px] font-medium bg-bg hover:bg-line text-slate hover:text-ink px-2.5 py-1 rounded-lg border border-line transition-colors"
              >
                Attack path to DB?
              </button>
              <button
                type="button"
                onClick={() => askPreset('What is the choke point and how does the fix resolve it?')}
                className="text-[11px] font-medium bg-bg hover:bg-line text-slate hover:text-ink px-2.5 py-1 rounded-lg border border-line transition-colors"
              >
                Choke point explanation
              </button>
              <button
                type="button"
                onClick={() => askPreset('What is the blast radius reduction?')}
                className="text-[11px] font-medium bg-bg hover:bg-line text-slate hover:text-ink px-2.5 py-1 rounded-lg border border-line transition-colors"
              >
                Blast radius reduction
              </button>
            </div>
          </div>

          {/* Ask Input Form */}
          <form onSubmit={handleAskSentinel} className="flex gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask Sentinel about this cloud topology..."
              disabled={sentinelLoading}
              className="flex-1 bg-bg border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-mute focus:outline-none focus:ring-2 focus:ring-violet/30"
            />
            <button
              type="submit"
              disabled={sentinelLoading || !question.trim()}
              className="px-4 py-2 bg-violet hover:bg-violet/90 text-white font-semibold text-xs rounded-xl shadow-sm transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </form>
        </Card>

        {/* Right: Before / After Card (5 cols) */}
        <Card className="lg:col-span-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-line">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate">Counterfactual Analysis</h3>
              <div className="flex items-center gap-1 text-[11px] text-mute">
                <Clock className="w-3.5 h-3.5" />
                <span>{analysis.timings.analysis_ms} ms</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center my-3">
              <div className="p-3 bg-bg rounded-xl border border-line">
                <span className="text-[10px] text-mute uppercase font-bold">Attack Paths</span>
                <div className="text-lg font-black text-ink mt-0.5">
                  {analysis.before.path_count} &rarr; <span className="text-green">{analysis.after.path_count}</span>
                </div>
              </div>

              <div className="p-3 bg-bg rounded-xl border border-line">
                <span className="text-[10px] text-mute uppercase font-bold">Risk Score</span>
                <div className="text-lg font-black text-ink mt-0.5">
                  {analysis.before.risk} &rarr; <span className="text-green">{analysis.after.risk}</span>
                </div>
              </div>

              <div className="p-3 bg-bg rounded-xl border border-line">
                <span className="text-[10px] text-mute uppercase font-bold">Blast Reduction</span>
                <div className="text-lg font-black text-green mt-0.5">
                  -{analysis.blast_reduction_pct}%
                </div>
              </div>
            </div>

            <div className="text-xs text-slate space-y-1.5 pt-2">
              <div className="flex justify-between">
                <span>Weighted blast radius:</span>
                <span className="font-mono font-bold text-ink">
                  {analysis.before.blast_weighted} &rarr; {analysis.after.blast_weighted}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Reachable nodes:</span>
                <span className="font-mono font-bold text-ink">
                  {analysis.before.blast_count} &rarr; {analysis.after.blast_count}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-line text-xs font-medium text-slate flex items-center justify-between">
            <span>Status:</span>
            {analysis.applied ? (
              <span className="text-green font-semibold">
                approved {approvalInfo?.secondsAfterAnalysis ?? 4} s after analysis
              </span>
            ) : (
              <span className="text-amber font-semibold">
                waiting for badge approval
              </span>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
};
