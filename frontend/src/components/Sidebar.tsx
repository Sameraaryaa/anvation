import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  Network,
  ShieldCheck,
  Cpu,
  CreditCard,
  History,
  ChevronLeft,
  ChevronRight,
  Shield,
  Activity,
  Layers,
  Radio
} from 'lucide-react';
import { useApp } from '../context/AppContext';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  onClose,
  collapsed,
  onToggleCollapse,
}) => {
  const { status, analysis, devices, selectedScenario } = useApp();

  const esp32 = devices.find((d) => d.device_id === 'esp32-console-01');

  const navigationSections = [
    {
      title: 'SECURITY GRAPH',
      links: [
        {
          name: 'Attack Graph & Overview',
          shortName: 'Overview',
          path: '/',
          icon: Network,
          badge: status ? (status.path_count > 0 ? `${status.path_count} Open` : 'Safe') : null,
          badgeColor: status?.path_count ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200',
        },
        {
          name: 'Remediation & Diff',
          shortName: 'Remediation',
          path: '/remediation',
          icon: ShieldCheck,
          badge: status?.pending_fix ? 'Pending' : null,
          badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
        },
      ],
    },
    {
      title: 'HARDWARE & ACCESS',
      links: [
        {
          name: 'Hardware Console',
          shortName: 'Hardware',
          path: '/hardware',
          icon: Cpu,
          badge: esp32?.online ? 'Online' : 'Offline',
          badgeColor: esp32?.online ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200',
        },
        {
          name: 'Access Cards & RFID',
          shortName: 'Badges',
          path: '/cards',
          icon: CreditCard,
        },
        {
          name: 'Cryptographic Audit',
          shortName: 'Audit',
          path: '/audit',
          icon: History,
        },
      ],
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs lg:hidden transition-opacity"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:sticky top-14 left-0 z-40 h-[calc(100vh-3.5rem)] bg-white border-r border-slate-200/80 flex flex-col transition-all duration-200 ease-in-out ${
          isOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'w-16' : 'w-64'}`}
      >
        {/* Navigation Section List */}
        <div className="flex-1 py-4 overflow-y-auto overflow-x-hidden space-y-6">
          {navigationSections.map((section, idx) => (
            <div key={idx} className="space-y-1">
              {!collapsed && (
                <div className="px-4 pb-1 text-[11px] font-bold tracking-wider text-slate-400 uppercase select-none">
                  {section.title}
                </div>
              )}
              {section.links.map((item) => {
                const IconComponent = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => {
                      if (window.innerWidth < 1024) onClose();
                    }}
                    title={collapsed ? item.name : undefined}
                    className={({ isActive }) =>
                      `group relative flex items-center gap-3 px-3.5 py-2.5 mx-2 text-xs rounded-lg transition-all select-none ${
                        isActive
                          ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 font-medium'
                      } ${collapsed ? 'justify-center mx-1.5 px-0' : ''}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <IconComponent
                          className={`w-4 h-4 flex-shrink-0 transition-colors ${
                            isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                          }`}
                        />
                        {!collapsed && (
                          <span className="truncate flex-1 font-medium">{item.name}</span>
                        )}
                        {!collapsed && item.badge && (
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-bold rounded border uppercase tracking-wider ${item.badgeColor}`}
                          >
                            {item.badge}
                          </span>
                        )}
                        {/* Active indicator bar on collapsed */}
                        {collapsed && isActive && (
                          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-blue-600 rounded-r" />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        {/* Bottom Hardware Status & Controls */}
        <div className="p-3 border-t border-slate-200/80 bg-slate-50/60">
          {!collapsed ? (
            <div className="space-y-2">
              <div className="bg-white border border-slate-200/80 rounded-lg p-2.5 shadow-2xs">
                <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium mb-1">
                  <span className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-blue-600" />
                    <span>Hardware Link</span>
                  </span>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      esp32?.online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                    }`}
                  />
                </div>
                <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                  <span className="truncate">ESP32 Console</span>
                  <span
                    className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                      esp32?.online ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {esp32?.online ? '172.16.11.2' : 'Offline'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                  <Activity className="w-3.5 h-3.5 text-slate-400" />
                  <span>Seq #{status?.seq ?? 0}</span>
                </div>
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors hidden lg:flex items-center justify-center"
                  title="Collapse sidebar"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  esp32?.online ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'
                }`}
                title={`ESP32: ${esp32?.online ? 'Online' : 'Offline'}`}
              />
              <button
                type="button"
                onClick={onToggleCollapse}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors hidden lg:flex items-center justify-center"
                title="Expand sidebar"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
