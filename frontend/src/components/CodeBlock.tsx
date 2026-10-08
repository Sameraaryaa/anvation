import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, title }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-line bg-bg overflow-hidden text-xs font-mono my-2">
      <div className="flex items-center justify-between px-3 py-1.5 bg-line/50 border-b border-line text-slate">
        <span className="font-semibold">{title || language || 'code'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] hover:text-ink transition-colors p-1"
          title="Copy code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-green" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-ink font-mono whitespace-pre-wrap leading-relaxed">
        {code}
      </pre>
    </div>
  );
};
