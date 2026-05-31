import React, { createContext, useCallback, useContext, useState } from 'react';

type ToastSeverity = 'info' | 'success' | 'warn' | 'error';

type ToastItem = { id: string; msg: string; sev: ToastSeverity };

type ToastContextValue = {
  push: (msg: string, sev?: ToastSeverity) => string;
  remove: (id: string) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const AUTO_DISMISS: Record<ToastSeverity, number> = {
  info: 3500,
  success: 3500,
  warn: 5000,
  error: 7000,
};

function Icon({ sev }: { sev: ToastSeverity }) {
  if (sev === 'success') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
  if (sev === 'warn') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <path d="M12 9v4"/>
      <path d="M12 17h.01"/>
    </svg>
  );
  if (sev === 'error') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((msg: string, sev: ToastSeverity = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((t) => [...t, { id, msg, sev }]);
    const timeout = AUTO_DISMISS[sev] ?? 3500;
    setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, timeout);
    return id;
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const clear = useCallback(() => setToasts([]), []);

  return (
    <ToastContext.Provider value={{ push, remove, clear }}>
      {children}

      <div className="toast-list" aria-live="polite" aria-atomic="true">
        {toasts.map((t) => (
          <div key={t.id} role={t.sev === 'error' ? 'alert' : 'status'} className={`toast ${t.sev}`} onClick={() => remove(t.id)}>
            <div className="toast-icon" aria-hidden><Icon sev={t.sev} /></div>
            <div className="toast-msg">{t.msg}</div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
