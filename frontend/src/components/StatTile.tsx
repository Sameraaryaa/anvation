import React from 'react';
import { SeverityBadge } from './SeverityBadge';

interface StatTileProps {
  label: string;
  value: number | string;
  subValue?: string;
  max?: number;
  showBar?: boolean;
  severity?: 'Critical' | 'High' | 'Medium' | 'Low';
  color?: 'violet' | 'red' | 'amber' | 'green' | 'blue' | 'slate';
}

export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  subValue,
  max = 100,
  showBar = false,
  severity,
  color,
}) => {
  const numVal = typeof value === 'number' ? value : 0;
  const pct = Math.min(100, Math.max(0, (numVal / max) * 100));

  let textColor = 'text-ink';
  let barColor = 'bg-violet';

  if (severity) {
    if (severity === 'Critical') {
      textColor = 'text-red';
      barColor = 'bg-red';
    } else if (severity === 'High') {
      textColor = 'text-amber';
      barColor = 'bg-amber';
    } else if (severity === 'Medium') {
      textColor = 'text-blue';
      barColor = 'bg-blue';
    } else {
      textColor = 'text-green';
      barColor = 'bg-green';
    }
  } else if (color) {
    const cMap = {
      violet: 'text-violet bg-violet',
      red: 'text-red bg-red',
      amber: 'text-amber bg-amber',
      green: 'text-green bg-green',
      blue: 'text-blue bg-blue',
      slate: 'text-slate bg-slate',
    };
    const parts = cMap[color].split(' ');
    textColor = parts[0];
    barColor = parts[1];
  }

  return (
    <div className="bg-card border border-line rounded-card shadow-card p-4 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-mute tracking-wide uppercase">{label}</span>
        {severity && <SeverityBadge severity={severity} />}
      </div>

      <div className="flex items-baseline gap-2 my-1">
        <span className={`text-3xl font-extrabold tracking-tight ${textColor}`}>{value}</span>
        {subValue && <span className="text-xs text-slate font-medium">{subValue}</span>}
      </div>

      {showBar && (
        <div className="w-full bg-line rounded-full h-2 mt-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
};
