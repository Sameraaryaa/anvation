import React, { useState, useEffect } from 'react';
import {
  ShieldAlert, ShieldCheck, Activity, FileCode, Clock
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { api } from '../api';
import { Card } from '../components/Card';
import { JsonDiff } from '../components/JsonDiff';
import { CodeBlock } from '../components/CodeBlock';
import { EmptyState } from '../components/EmptyState';
import { AuditRecord } from '../types';

export const Remediation: React.FC = () => {
  const { analysis, status, runAnalysis } = useApp();
  const [auditEntries, setAuditEntries] = useState<AuditRecord[]>([]);

  useEffect(() => {
    api.getAudit().then((res) => setAuditEntries(res.entries)).catch(console.error);
  }, [analysis, status]);

  if (!analysis) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <EmptyState onAction={() => runAnalysis()} />
      </main>
    );
  }

  // Filter audit events in chronological order for the timeline: analysis_run -> approve_denied* -> fix_applied
  const timelineEvents = auditEntries
    .filter((e) => ['analysis_run', 'approve_denied', 'fix_applied'].includes(e.event))
    .slice()
    .reverse(); // chronological

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-line">
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">Remediation Engineering</h1>
          <p className="text-xs text-mute mt-0.5">
            Minimum-cut edge severance, counterfactual policy proofs, and Infrastructure-as-Code generation
          </p>
        </div>

        <div className="flex items-center gap-2">
          {analysis.applied ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-greensoft text-green border border-green/30">
              <ShieldCheck className="w-4 h-4" />
              <span>Remediation Applied & Verified</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-ambersoft text-amber border border-amber/30">
              <Activity className="w-4 h-4" />
              <span>Fix Pending Physical Badge Approval</span>
            </span>
          )}
        </div>
      </div>

      {/* Recommended Fixes */}
      <div className="space-y-6">
        {analysis.recommended_fixes.map((fix) => (
          <Card key={fix.fix_id} className="p-6 space-y-5">
            {/* Title & Core Meta */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-line">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-violet text-white text-xs font-bold flex items-center justify-center">
                    1
                  </span>
                  <h3 className="text-base font-extrabold text-ink">{fix.title}</h3>
                </div>
                <p className="text-xs text-slate mt-1">{fix.detail}</p>
              </div>

              <div className="text-right">
                <span className="text-[10px] font-bold text-mute uppercase tracking-wider block">Fix Identifier</span>
                <span className="font-mono text-xs font-bold text-violet bg-violet/10 px-2 py-0.5 rounded">
                  {fix.fix_id}
                </span>
              </div>
            </div>

            {/* Min-cut & Edge Severance Guarantee */}
            <div className="bg-bg rounded-xl border border-line p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 text-ink font-bold">
                <Activity className="w-4 h-4 text-amber" />
                <span>Minimum-Cut Graph Theory Guarantee</span>
              </div>
              <p className="text-slate leading-relaxed">
                NetworkX calculated the minimum cut with capacity 1 for fixable edges and 1000 for non-fixable edges.
                This provides a <b className="text-amber">min-cut value 1 at the choke point ({analysis.choke_point?.label || 'role_overpriv'})</b> that
                removes edge <b className="text-ink font-mono">{fix.removes_edges.map(([u, v]) => `${u} -> ${v}`).join(', ')}</b>.
                Applying this fix collapses all <b>{analysis.before.path_count}</b> attack paths simultaneously (risk {analysis.before.risk} &rarr; {analysis.after.risk}) while preserving legitimate infrastructure operations.
              </p>
            </div>

            {/* Side-by-Side IAM Policy Diff */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate mb-1">
                IAM Policy Least-Privilege Transition
              </h4>
              <JsonDiff
                before={fix.iam_before}
                after={fix.iam_after}
                beforeTitle="IAM Policy Before (Overprivileged)"
                afterTitle="IAM Policy After (Least Privilege)"
              />
            </div>

            {/* Terraform & Rego / OPA Code Blocks */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fix.terraform_after && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate mb-1 flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-violet" />
                    <span>Terraform IaC Remediation</span>
                  </h4>
                  <CodeBlock
                    code={fix.terraform_after}
                    language="hcl"
                    title="main.tf (Updated)"
                  />
                </div>
              )}

              {fix.rego && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate mb-1 flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-cyan" />
                    <span>Open Policy Agent (OPA / Rego) Rule</span>
                  </h4>
                  <CodeBlock
                    code={fix.rego}
                    language="rego"
                    title="policy.rego (Guardrail)"
                  />
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Approval Timeline (Built from audit events: analysis_run -> approve_denied* -> fix_applied) */}
      <Card className="p-6">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate mb-4 pb-2 border-b border-line flex items-center gap-2">
          <Clock className="w-4 h-4 text-violet" />
          <span>Approval Timeline (Audit Event Sequence)</span>
        </h3>

        {timelineEvents.length === 0 ? (
          <div className="text-xs text-mute py-4">No lifecycle events recorded yet for this scenario.</div>
        ) : (
          <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-line">
            {timelineEvents.map((evt, idx) => {
              let dot = 'bg-blue';
              let title = evt.event;

              if (evt.event === 'fix_applied') {
                dot = 'bg-green ring-4 ring-greensoft';
                title = `Fix Approved by ${evt.entry.approver || 'Security Lead'}`;
              } else if (evt.event === 'approve_denied') {
                dot = 'bg-red ring-4 ring-redsoft';
                title = `Access Denied for Badge ${evt.entry.card_id}`;
              } else if (evt.event === 'analysis_run') {
                dot = 'bg-violet ring-4 ring-violet/10';
                title = `Analysis Run (${evt.entry.scenario})`;
              }

              return (
                <div key={idx} className="relative">
                  <span className={`absolute -left-6 top-1 w-3 h-3 rounded-full ${dot}`} />
                  <div className="text-xs">
                    <div className="font-bold text-ink flex items-center gap-2">
                      <span>{title}</span>
                      <span className="text-[10px] text-mute font-mono">
                        {new Date(evt.ts * 1000).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate mt-0.5">
                      Device: <span className="font-mono">{evt.entry.device_id || 'laptop'}</span> · Hash: <span className="font-mono text-violet font-semibold">{evt.this_hash.substring(0, 8)}...</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </main>
  );
};
