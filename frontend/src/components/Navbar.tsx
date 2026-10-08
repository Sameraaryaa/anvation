import React, { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Shield, Play, RotateCcw, Cpu, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ImportScenarioModal } from './ImportScenarioModal';

export const Navbar: React.FC = () => {
  const {
    scenarios,
    selectedScenario,
    setSelectedScenario,
    runAnalysis,
    resetAll,
    loading,
    devices
  } = useApp();

  const [showImportModal, setShowImportModal] = useState(false);

  // Find devices
  const esp32 = devices.find((d) => d.device_id === 'esp32-console-01');
  const unoq = devices.find((d) => d.device_id === 'unoq-status-01');

  const getPill = (name: string, dev?: typeof esp32) => {
    let colorClass = 'bg-line text-mute border-line';
    let dotClass = 'bg-slate/40';

    if (dev) {
      if (dev.online) {
        colorClass = 'bg-greensoft text-green border-green/30';
        dotClass = 'bg-green';
      } else {
        colorClass = 'bg-redsoft text-red border-red/30';
        dotClass = 'bg-red';
      }
    }

    return (
      <Link
        to="/hardware"
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all hover:opacity-80 whitespace-nowrap flex-shrink-0 ${colorClass}`}
        title={`View hardware status for ${name}`}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotClass}`} />
        <span>{name}</span>
      </Link>
    );
  };

  const navLinks = [
    { name: 'Overview', path: '/' },
    { name: 'Remediation', path: '/remediation' },
    { name: 'Hardware', path: '/hardware' },
    { name: 'Cards', path: '/cards' },
    { name: 'Audit', path: '/audit' },
  ];

  return (
    <header className="bg-white border-b border-line sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Brand & Logo */}
        <div className="flex items-center gap-4 lg:gap-6 flex-shrink-0">
          <Link to="/" className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-violet flex items-center justify-center text-white shadow-sm flex-shrink-0">
              <Shield className="w-5 h-5 fill-white/20" />
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="font-extrabold text-base tracking-tight text-ink whitespace-nowrap">AEGIS-Graph</span>
                <span className="text-[10px] font-bold bg-violet/10 text-violet px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap">Demo</span>
              </div>
              <p className="text-[11px] text-mute font-medium leading-none whitespace-nowrap mt-0.5">Cloud Attack Path Analyzer</p>
            </div>
          </Link>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1 ml-2 lg:ml-4 flex-shrink-0">
            {navLinks.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                    isActive
                      ? 'text-violet bg-violet/10 font-bold'
                      : 'text-slate hover:text-ink hover:bg-bg'
                  }`
                }
              >
                {item.name}
              </NavLink>
            ))}
          </nav>
        </div>

        {/* Right Actions: Scenarios, Run, Reset, Device Pills */}
        <div className="flex items-center gap-2 lg:gap-3 flex-shrink-0">
          {/* Scenario Select & Import */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <select
              value={selectedScenario}
              onChange={(e) => setSelectedScenario(e.target.value)}
              disabled={loading}
              className="bg-bg border border-line rounded-xl px-2.5 py-1.5 text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-violet/30 cursor-pointer w-44 lg:w-56 truncate"
              title="Select cloud architecture scenario"
            >
              {scenarios.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.display_name}
                </option>
              ))}
            </select>

            <button
              onClick={() => setShowImportModal(true)}
              disabled={loading}
              className="flex items-center gap-1 bg-bg hover:bg-line border border-line hover:border-slate/40 text-slate hover:text-ink font-semibold text-xs px-2.5 py-1.5 rounded-xl transition-all whitespace-nowrap"
              title="Import custom scenario data (JSON / CloudGoat)"
            >
              <Upload className="w-3.5 h-3.5 text-violet" />
              <span className="hidden sm:inline">Import</span>
            </button>
          </div>

          {/* Run Analysis Button (Violet) */}
          <button
            onClick={() => runAnalysis()}
            disabled={loading}
            className="flex items-center gap-1.5 bg-violet hover:bg-violet/90 text-white font-semibold text-xs px-3.5 py-1.5 rounded-xl shadow-sm transition-all disabled:opacity-50 whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Run analysis</span>
          </button>

          {/* Reset Button (Outline) */}
          <button
            onClick={() => resetAll()}
            disabled={loading}
            className="flex items-center gap-1.5 border border-line hover:border-slate/40 text-slate hover:text-ink font-semibold text-xs px-3 py-1.5 rounded-xl transition-all disabled:opacity-50 whitespace-nowrap"
            title="Reset system state to idle"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          {/* Device status pills */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-line flex-shrink-0">
            {getPill('Console', esp32)}
            {getPill('UNO Q', unoq)}
          </div>
        </div>
      </div>

      {/* Import Scenario Modal */}
      <ImportScenarioModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
      />
    </header>
  );
};

