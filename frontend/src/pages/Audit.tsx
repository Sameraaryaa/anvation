import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, Link as LinkIcon, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { Card } from '../components/Card';
import { AuditRecord } from '../types';

export const Audit: React.FC = () => {
  const [entries, setEntries] = useState<AuditRecord[]>([]);
  const [chainValid, setChainValid] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchAudit = async () => {
    setLoading(true);
    try {
      const res = await api.getAudit();
      setEntries(res.entries);
      setChainValid(res.chain_valid);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAudit();
    const timer = setInterval(fetchAudit, 3000);
    return () => clearInterval(timer);
  }, []);

  const getEventBadge = (event: string) => {
    switch (event) {
      case 'fix_applied':
        return <span className="bg-greensoft text-green font-bold text-[10px] px-2 py-0.5 rounded-full uppercase border border-green/30">Fix Applied</span>;
      case 'approve_denied':
        return <span className="bg-redsoft text-red font-bold text-[10px] px-2 py-0.5 rounded-full uppercase border border-red/30">Approval Denied</span>;
      case 'analysis_run':
        return <span className="bg-blue/10 text-blue font-bold text-[10px] px-2 py-0.5 rounded-full uppercase border border-blue/30">Analysis Run</span>;
      case 'card_enrolled':
        return <span className="bg-violet/10 text-violet font-bold text-[10px] px-2 py-0.5 rounded-full uppercase border border-violet/30">Card Enrolled</span>;
      case 'card_removed':
        return <span className="bg-slate/10 text-slate font-bold text-[10px] px-2 py-0.5 rounded-full uppercase border border-slate/30">Card Revoked</span>;
      default:
        return <span className="bg-line text-slate font-mono text-[10px] px-2 py-0.5 rounded">{event}</span>;
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">Cryptographic Audit Trail</h1>
          <p className="text-xs text-mute mt-0.5">
            Immutable SHA-256 hash-chained log of every architectural analysis, badge scan, and remediation approval
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Chain Integrity Status Badge */}
          {chainValid ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-greensoft text-green border border-green/30 shadow-sm">
              <ShieldCheck className="w-4 h-4" />
              <span>Hash chain valid</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-redsoft text-red border border-red/30 shadow-sm">
              <ShieldAlert className="w-4 h-4" />
              <span>Chain broken</span>
            </span>
          )}

          <button
            onClick={fetchAudit}
            disabled={loading}
            className="p-2 border border-line rounded-xl hover:bg-bg text-slate hover:text-ink transition-colors"
            title="Refresh audit chain"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Audit Log Table (Newest first) */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-slate" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate">
              Audit Entries ({entries.length})
            </h3>
          </div>
          <span className="text-[11px] text-mute font-mono">SHA256(prev_hash + JSON)</span>
        </div>

        {entries.length === 0 ? (
          <div className="text-center py-12 text-xs text-mute">
            No audit records yet. Run an analysis or tap a badge on the hardware to generate events.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line text-mute uppercase text-[10px] tracking-wider">
                  <th className="py-2.5 px-3">Event</th>
                  <th className="py-2.5 px-3">Who</th>
                  <th className="py-2.5 px-3">Fix</th>
                  <th className="py-2.5 px-3">Device</th>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3 font-mono">Short Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {entries.map((item) => (
                  <tr key={item.id} className="hover:bg-bg transition-colors">
                    <td className="py-3 px-3">{getEventBadge(item.event)}</td>
                    <td className="py-3 px-3 font-semibold text-ink">
                      {item.entry.approver || item.entry.name || item.entry.card_id || 'System'}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate">
                      {item.entry.fix_id || '—'}
                    </td>
                    <td className="py-3 px-3 font-mono text-slate">
                      {item.entry.device_id || 'laptop-runtime'}
                    </td>
                    <td className="py-3 px-3 text-mute font-mono text-[11px] whitespace-nowrap">
                      {new Date(item.ts * 1000).toLocaleTimeString()}
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px]">
                      <span className="text-violet font-bold" title={item.this_hash}>
                        {item.this_hash.substring(0, 8)}...
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
};
