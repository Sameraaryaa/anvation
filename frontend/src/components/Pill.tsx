import React from 'react';

export interface PillProps {
  label: string;
  variant?: 'green' | 'red' | 'amber' | 'slate' | 'violet';
  dot?: boolean;
  className?: string;
}

export const Pill: React.FC<PillProps> = ({
  label,
  variant = 'slate',
  dot = true,
  className = '',
}) => {
  const colorMap = {
    green: { bg: 'bg-greensoft', text: 'text-green', dotBg: 'bg-green' },
    red: { bg: 'bg-redsoft', text: 'text-red', dotBg: 'bg-red' },
    amber: { bg: 'bg-ambersoft', text: 'text-amber', dotBg: 'bg-amber' },
    slate: { bg: 'bg-line', text: 'text-slate', dotBg: 'bg-slate' },
    violet: { bg: 'bg-violet/10', text: 'text-violet', dotBg: 'bg-violet' },
  };

  const c = colorMap[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${c.bg} ${c.text} ${className}`}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${c.dotBg}`} />}
      {label}
    </span>
  );
};
