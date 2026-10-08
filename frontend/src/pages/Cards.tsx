import React, { useState, useEffect } from 'react';
import { CreditCard, Trash2, UserPlus, Radio, Shield, Check, X, Clock } from 'lucide-react';
import { api } from '../api';
import { Card } from '../components/Card';
import { CardInfo, ScanRecord } from '../types';
import { useToast } from '../context/ToastContext';

export const Cards: React.FC = () => {
  const { addToast } = useToast();
  const [cards, setCards] = useState<CardInfo[]>([]);
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Enrol modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [enrolUid, setEnrolUid] = useState('');
  const [enrolName, setEnrolName] = useState('Security Lead');
  const [enrolRole, setEnrolRole] = useState('approver');

  const loadData = async () => {
    try {
      const [cardsRes, scansRes] = await Promise.all([
        api.getCards(),
        api.getRecentScans(),
      ]);
      setCards(cardsRes);
      setScans(scansRes);
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(() => {
      api.getRecentScans().then(setScans).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleEnrol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrolUid.trim() || !enrolName.trim()) return;

    setLoading(true);
    try {
      await api.addCard(enrolUid, enrolName, enrolRole);
      addToast({
        type: 'success',
        title: 'Badge Enrolled',
        message: `Card ${enrolUid} enrolled for ${enrolName}.`,
      });
      setModalOpen(false);
      setEnrolUid('');
      await loadData();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Enrollment Failed',
        message: err.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCard = async (uid: string) => {
    if (!confirm(`Remove badge ${uid}?`)) return;
    try {
      await api.deleteCard(uid);
      addToast({
        type: 'info',
        title: 'Badge Removed',
        message: `Badge ${uid} removed from approvers list.`,
      });
      await loadData();
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Delete Failed',
        message: err.message,
      });
    }
  };

  const openEnrolModal = (uid: string) => {
    setEnrolUid(uid);
    setEnrolName('Security Lead');
    setEnrolRole('approver');
    setModalOpen(true);
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Title & Enrol button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-ink tracking-tight">RFID Access Control</h1>
          <p className="text-xs text-mute mt-0.5">
            Cryptographic badge enrollment, hardware scan telemetry, and authorization management
          </p>
        </div>

        <button
          onClick={() => {
            setEnrolUid('');
            setEnrolName('');
            setModalOpen(true);
          }}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet hover:bg-violet/90 text-white font-semibold text-xs rounded-xl shadow-sm transition-all"
        >
          <UserPlus className="w-3.5 h-3.5" />
          <span>Enrol new badge</span>
        </button>
      </div>

      {/* Recent Badge Scans (refresh every 3s) */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-violet" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate">
              Recent Badge Scans (Live Feed)
            </h3>
          </div>
          <span className="text-[11px] text-mute font-mono">Auto-refreshed (3s)</span>
        </div>

        {scans.length === 0 ? (
          <div className="text-center py-8 text-xs text-mute">
            No badge scans detected yet. Tap an RFID card on the ESP32 console or run the simulator.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-line text-mute uppercase text-[10px] tracking-wider">
                  <th className="py-2 px-3">Card UID</th>
                  <th className="py-2 px-3">Device</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Name / Identity</th>
                  <th className="py-2 px-3">Context</th>
                  <th className="py-2 px-3">Timestamp</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {scans.map((s, idx) => {
                  const enrolled = cards.find(
                    (c) => c.card_id.toUpperCase() === s.card_id.toUpperCase()
                  );
                  const isKnown = Boolean(s.known || enrolled);
                  const displayName = enrolled ? enrolled.name : s.name;

                  return (
                    <tr key={idx} className="hover:bg-bg transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-ink">{s.card_id}</td>
                      <td className="py-2.5 px-3 font-mono text-slate">{s.device_id}</td>
                      <td className="py-2.5 px-3">
                        {isKnown ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green bg-greensoft px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" /> Enrolled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red bg-redsoft px-2 py-0.5 rounded-full">
                            <X className="w-3 h-3" /> Unknown
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-ink">{displayName || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-[11px] bg-line px-2 py-0.5 rounded text-slate">
                          {s.context}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-mute font-mono text-[11px]">
                        {new Date(s.ts * 1000).toLocaleTimeString()}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        {!isKnown ? (
                          <button
                            onClick={() => openEnrolModal(s.card_id)}
                            className="px-2.5 py-1 bg-violet/10 hover:bg-violet text-violet hover:text-white font-semibold text-[11px] rounded-lg transition-colors"
                          >
                            Enrol &rarr;
                          </button>
                        ) : (
                          <span className="text-[11px] text-mute font-medium italic">Enrolled</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Enrolled Badges Table */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-slate" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate">
              Authorized Approvers ({cards.length})
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line text-mute uppercase text-[10px] tracking-wider">
                <th className="py-2 px-3">Card UID</th>
                <th className="py-2 px-3">Authorized Approver</th>
                <th className="py-2 px-3">Role</th>
                <th className="py-2 px-3">Enrolled At</th>
                <th className="py-2 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {cards.map((c) => (
                <tr key={c.card_id} className="hover:bg-bg transition-colors">
                  <td className="py-3 px-3 font-mono font-bold text-ink">{c.card_id}</td>
                  <td className="py-3 px-3 font-semibold text-ink">{c.name}</td>
                  <td className="py-3 px-3">
                    <span className="font-mono text-[11px] bg-violet/10 text-violet px-2 py-0.5 rounded font-bold">
                      {c.role}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-mute font-mono text-[11px]">
                    {new Date(c.created_at * 1000).toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      onClick={() => handleDeleteCard(c.card_id)}
                      className="text-mute hover:text-red transition-colors p-1"
                      title="Revoke badge"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Enrol Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm p-4">
          <div className="bg-white border border-line rounded-card shadow-2xl p-6 max-w-md w-full">
            <h3 className="text-base font-extrabold text-ink mb-1">Enrol RFID Badge</h3>
            <p className="text-xs text-mute mb-4">
              Authorize a physical badge UID for hardware approval signatures.
            </p>

            <form onSubmit={handleEnrol} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate uppercase mb-1">
                  Card UID (Hex)
                </label>
                <input
                  type="text"
                  value={enrolUid}
                  onChange={(e) => setEnrolUid(e.target.value)}
                  placeholder="e.g. 04A1B2C3"
                  required
                  className="w-full bg-bg border border-line rounded-xl px-3 py-2 text-xs font-mono font-bold text-ink focus:outline-none focus:ring-2 focus:ring-violet/30"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate uppercase mb-1">
                  Approver Name
                </label>
                <input
                  type="text"
                  value={enrolName}
                  onChange={(e) => setEnrolName(e.target.value)}
                  placeholder="e.g. Security Lead"
                  required
                  className="w-full bg-bg border border-line rounded-xl px-3 py-2 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-violet/30"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate uppercase mb-1">
                  Role
                </label>
                <input
                  type="text"
                  value={enrolRole}
                  onChange={(e) => setEnrolRole(e.target.value)}
                  placeholder="approver"
                  className="w-full bg-bg border border-line rounded-xl px-3 py-2 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-violet/30"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate hover:text-ink rounded-xl border border-line hover:bg-bg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-violet hover:bg-violet/90 text-white font-bold text-xs rounded-xl shadow-sm transition-colors"
                >
                  Save & Enrol
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};
