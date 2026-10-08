import React from 'react';
import { ShieldAlert, Play } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  onAction?: () => void;
  actionLabel?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'Run an analysis to map attack paths',
  description = 'Select a cloud architecture scenario from the top bar and click "Run analysis" to discover attack paths, dominators, and minimum-cut choke points.',
  onAction,
  actionLabel = 'Run analysis',
}) => {
  return (
    <div className="bg-card border border-line rounded-card p-12 text-center max-w-xl mx-auto my-12 shadow-card">
      <div className="w-14 h-14 rounded-2xl bg-violet/10 text-violet flex items-center justify-center mx-auto mb-4">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h3 className="text-lg font-bold text-ink mb-2">{title}</h3>
      <p className="text-sm text-slate mb-6 leading-relaxed">{description}</p>
      {onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet hover:bg-violet/90 text-white font-semibold text-sm rounded-xl shadow-sm transition-colors"
        >
          <Play className="w-4 h-4 fill-white" />
          {actionLabel}
        </button>
      )}
    </div>
  );
};
