import React from 'react';

interface JsonDiffProps {
  before?: Record<string, any>;
  after?: Record<string, any>;
  beforeTitle?: string;
  afterTitle?: string;
}

export const JsonDiff: React.FC<JsonDiffProps> = ({
  before = {},
  after = {},
  beforeTitle = 'IAM Policy Before (Overprivileged)',
  afterTitle = 'IAM Policy After (Least Privilege)',
}) => {
  const beforeLines = JSON.stringify(before, null, 2).split('\n');
  const afterLines = JSON.stringify(after, null, 2).split('\n');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono my-3">
      {/* Before Panel */}
      <div className="border border-red/30 rounded-xl overflow-hidden bg-white">
        <div className="bg-redsoft px-3 py-2 border-b border-red/20 font-semibold text-red flex items-center justify-between">
          <span>{beforeTitle}</span>
          <span className="text-[10px] bg-red/10 px-2 py-0.5 rounded text-red uppercase">Vulnerable</span>
        </div>
        <div className="p-3 bg-red/5 overflow-x-auto space-y-0.5">
          {beforeLines.map((line, idx) => {
            const isHighlight = line.includes('*') || line.includes('Resource') || line.includes('Action');
            return (
              <div
                key={idx}
                className={`px-1 rounded ${isHighlight ? 'bg-redsoft/80 text-red font-bold' : 'text-slate'}`}
              >
                {line}
              </div>
            );
          })}
        </div>
      </div>

      {/* After Panel */}
      <div className="border border-green/30 rounded-xl overflow-hidden bg-white">
        <div className="bg-greensoft px-3 py-2 border-b border-green/20 font-semibold text-green flex items-center justify-between">
          <span>{afterTitle}</span>
          <span className="text-[10px] bg-green/10 px-2 py-0.5 rounded text-green uppercase">Remediated</span>
        </div>
        <div className="p-3 bg-green/5 overflow-x-auto space-y-0.5">
          {afterLines.map((line, idx) => {
            const isHighlight = line.includes('arn:') || line.includes('restricted') || line.includes('Resource');
            return (
              <div
                key={idx}
                className={`px-1 rounded ${isHighlight ? 'bg-greensoft/80 text-green font-bold' : 'text-slate'}`}
              >
                {line}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
