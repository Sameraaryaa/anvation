import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield,
  Play,
  RotateCcw,
  Upload,
  Menu,
  ChevronDown,
  Layers,
  Sparkles,
  Radio
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ImportScenarioModal } from './ImportScenarioModal';

interface NavbarProps {
  onToggleSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const {
    scenarios,
    selectedScenario,
    setSelectedScenario,
    runAnalysis,
    resetAll,
    loading,
    devices,
    status
  } = useApp();

  const [showImportModal, setShowImportModal] = useState(false);

  // Find devices
  const esp32 = devices.find((d) => d.device_id === 'esp32-console-01');
  const unoq = devices.find((d) => d.device_id === 'unoq-status-01');

  const currentScenarioObj = scenarios.find((s) => s.id === selectedScenario);

  return (
    <header className="bg-white border-b border-slate-200/80 sticky top-0 z-50 h-14 select-none">
      <div className="h-full px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-4">
        {/* Left: Hamburger & Brand */}
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors focus:outline-none"
            title="Toggle Navigation Menu"
            aria-label="Toggle navigation"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link to="/" className="flex items-center gap-2.5 flex-shrink-0 group">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs group-hover:bg-blue-700 transition-colors">
              <Shield className="w-4 h-4 fill-white/20" />
            </div>
            <div className="flex flex-col justify-center">
              <div className="flex items-center gap-1.5 leading-none">
                <span className="font-bold text-sm tracking-tight text-slate-900">
                  AEGIS-Graph
                </span>
                <span className="text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 px-1.5 py-0.2 rounded tracking-wide">
                  Console
                </span>
              </div>
              <span className="text-[10px] text-slate-500 font-medium leading-none mt-0.5 hidden sm:inline">
                Cloud Security Command Center
              </span>
            </div>
          </Link>
        </div>

        {/* Center: Scenario Selector with Attached "Run Analysis" Button */}
        <div className="flex items-center gap-1.5 flex-1 max-w-sm sm:max-w-md lg:max-w-lg mx-2 sm:mx-4 min-w-0">
          <div className="flex items-center w-full bg-slate-50 hover:bg-slate-100/90 border border-slate-200/90 rounded-lg p-0.5 shadow-2xs transition-all focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500 min-w-0">
            <div className="flex items-center gap-1.5 px-2.5 py-1 flex-1 min-w-0 relative">
              <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <select
                id="scenario-selector"
                value={selectedScenario}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedScenario(val);
                  runAnalysis(val);
                }}
                disabled={loading}
                className="bg-transparent font-medium text-slate-800 text-xs w-full focus:outline-none cursor-pointer truncate appearance-none pr-5"
                title="Select architecture scenario to analyze"
              >
                {scenarios.map((sc) => (
                  <option key={sc.id} value={sc.id}>
                    {sc.display_name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
            </div>

            {/* Attached Run Analysis Button */}
            <button
              id="run-analysis-btn"
              type="button"
              onClick={() => runAnalysis(selectedScenario)}
              disabled={loading}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs px-3 sm:px-3.5 py-1.5 rounded-md shadow-xs transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
              title="Execute attack graph analysis on selected scenario"
            >
              <Play className={`w-3.5 h-3.5 fill-white shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{loading ? 'Analyzing...' : 'Run Analysis'}</span>
              <span className="sm:hidden">{loading ? '...' : 'Run'}</span>
            </button>
          </div>
        </div>

        {/* Right: Actions & Device Status */}
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
          {/* Import Button (Google Cloud Secondary Outlined) */}
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            disabled={loading}
            className="flex items-center gap-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold text-xs px-2.5 sm:px-3 py-1.5 rounded-lg transition-colors shadow-2xs whitespace-nowrap"
            title="Import custom architecture (Terraform or JSON)"
          >
            <Upload className="w-3.5 h-3.5 text-blue-600" />
            <span className="hidden md:inline">Import</span>
          </button>

          {/* Reset Button */}
          <button
            type="button"
            onClick={() => resetAll()}
            disabled={loading}
            className="flex items-center gap-1 text-slate-500 hover:text-slate-800 hover:bg-slate-100 p-1.5 rounded-lg transition-colors disabled:opacity-50"
            title="Reset system state"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* Device Indicator */}
          <div className="hidden xl:flex items-center gap-2 pl-2 border-l border-slate-200">
            <Link
              to="/hardware"
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-50 text-slate-700 border border-slate-200/80 hover:bg-slate-100 transition-colors"
              title="ESP32 Console Hardware Status"
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  esp32?.online ? 'bg-emerald-500' : 'bg-slate-300'
                }`}
              />
              <span>ESP32</span>
            </Link>
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
