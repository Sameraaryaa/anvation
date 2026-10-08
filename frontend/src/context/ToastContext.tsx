import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface ToastMessage {
  id: string;
  type: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextType {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((t: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...t, id }]);
    setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 6000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      {/* Toast Render Container */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          let border = 'border-line';
          let icon = <Info className="w-5 h-5 text-blue shrink-0" />;
          let bg = 'bg-white';

          if (toast.type === 'success') {
            border = 'border-green/30';
            icon = <CheckCircle className="w-5 h-5 text-green shrink-0" />;
          } else if (toast.type === 'warning') {
            border = 'border-amber/30';
            icon = <AlertTriangle className="w-5 h-5 text-amber shrink-0" />;
          } else if (toast.type === 'error') {
            border = 'border-red/30';
            icon = <XCircle className="w-5 h-5 text-red shrink-0" />;
          }

          return (
            <div
              key={toast.id}
              className={`${bg} border ${border} rounded-card shadow-lg p-4 pointer-events-auto flex gap-3 items-start animate-in slide-in-from-bottom-2 duration-200`}
            >
              {icon}
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-ink leading-tight">{toast.title}</h4>
                <p className="text-xs text-slate mt-0.5 leading-snug">{toast.message}</p>
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action?.onClick();
                      removeToast(toast.id);
                    }}
                    className="mt-2 text-xs font-semibold text-violet hover:underline inline-block"
                  >
                    {toast.action.label} &rarr;
                  </button>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-mute hover:text-ink transition-colors p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
