import React from 'react';

interface SeverityBadgeProps {
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | string;
}

export const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity }) => {
  const norm = severity.toLowerCase();
  let styles = 'bg-slate/10 text-slate border-slate/20';

  if (norm === 'critical') {
    styles = 'bg-redsoft text-red border-red/30';
  } else if (norm === 'high') {
    styles = 'bg-ambersoft text-amber border-amber/30';
  } else if (norm === 'medium') {
    styles = 'bg-blue/10 text-blue border-blue/30';
  } else if (norm === 'low') {
    styles = 'bg-greensoft text-green border-green/30';
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold border uppercase tracking-wider ${styles}`}>
      {severity}
    </span>
  );
};

interface PillProps {
  label: string;
  variant?: 'green' | 'red' | 'amber' | 'slate' | 'violet';
  dot?: boolean;
}

export const Pill: React.FC<PillProps> = ({ label, variant = 'slate', dot = true }) => {
  const colorMap = {
    green: { bg: 'bg-greensoft', text: 'text-green', dotBg: 'bg-green' },
    red: { bg: 'bg-redsoft', text: 'text-red', dotBg: 'bg-red' },
    amber: { bg: 'bg-ambersoft', text: 'text-amber', dotBg: 'bg-amber' },
    slate: { bg: 'bg-line', text: 'text-slate', dotBg: 'bg-slate' },
    violet: { bg: 'bg-violet/10', text: 'text-violet', dotBg: 'bg-violet' },
  };

  const c = colorMap[variant];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      {dot && <span className={`w-2 h-2 rounded-full ${c.dotBg}`} />}
      {label}
    </span>
  );
};
