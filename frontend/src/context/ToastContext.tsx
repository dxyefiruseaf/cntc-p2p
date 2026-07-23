import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; kind: ToastKind; duration: number }
interface ToastApi { showToast: (message: string, kind?: ToastKind, duration?: number) => void }

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const showToast = useCallback((message: string, kind: ToastKind = 'info', duration = 3500) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems(current => [...current, { id, message, kind, duration }]);
    window.setTimeout(() => setItems(current => current.filter(item => item.id !== id)), duration);
  }, []);
  const value = useMemo(() => ({ showToast }), [showToast]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed right-4 top-20 z-[120] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {items.map(item => (
          <div key={item.id} className={`toast-in overflow-hidden rounded-xl border bg-[var(--surface)] shadow-2xl ${toastBorder[item.kind]}`}>
            <div className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 text-sm ${toastText[item.kind]}`}>{toastIcon[item.kind]}</span>
              <p className="flex-1 text-sm text-[var(--text-main)]">{item.message}</p>
              <button onClick={() => setItems(current => current.filter(row => row.id !== item.id))} className="text-[var(--text-sec)] hover:text-[var(--text-main)]" aria-label="Đóng thông báo">✕</button>
            </div>
            <div className={`h-0.5 origin-left animate-[toast-progress_linear_forwards] ${toastBar[item.kind]}`} style={{ animationDuration: `${item.duration}ms` }} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const toastIcon = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' } as const;
const toastText = { success: 'text-[#22C55E]', error: 'text-[#EF4444]', warning: 'text-[#F59E0B]', info: 'text-[#3B82F6]' } as const;
const toastBorder = { success: 'border-[#22C55E]/30', error: 'border-[#EF4444]/30', warning: 'border-[#F59E0B]/30', info: 'border-[#3B82F6]/30' } as const;
const toastBar = { success: 'bg-[#22C55E]', error: 'bg-[#EF4444]', warning: 'bg-[#F59E0B]', info: 'bg-[#3B82F6]' } as const;

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
