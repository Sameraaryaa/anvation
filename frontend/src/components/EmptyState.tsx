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
    <div className="bg-white border border-slate-200/90 rounded-xl p-12 text-center max-w-xl mx-auto my-12 shadow-xs">
      <div className="w-14 h-14 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-200/60">
        <ShieldAlert className="w-7 h-7" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-500 mb-6 leading-relaxed">{description}</p>
      {onAction && (
        <button
          onClick={onAction}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm rounded-lg shadow-xs transition-colors cursor-pointer"
        >
          <Play className="w-4 h-4 fill-white" />
          {actionLabel}
        </button>
      )}
    </div>
  );
};
