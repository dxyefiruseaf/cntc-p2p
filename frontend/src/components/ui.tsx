import { useEffect, useId, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode } from 'react';

export const C = {
  appBg: 'var(--app-bg)', elevated: 'var(--elevated)', surface: 'var(--surface)', surface2: 'var(--surface-2)',
  textMain: 'var(--text-main)', textSec: 'var(--text-sec)', border: 'var(--border)',
  gold: '#F7931A', goldHover: '#FFAA3B', pos: '#22C55E', neg: '#EF4444', info: '#3B82F6', violet: '#8B5CF6',
};

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading, children, className = '', type = 'button', ...rest }: BtnProps) {
  const base = 'btn-stable inline-flex select-none items-center justify-center gap-2 rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = { sm: 'h-8 px-3 text-xs', md: 'h-9 px-4 text-sm', lg: 'h-11 px-6 text-base' };
  const variants: Record<BtnVariant, string> = {
    primary: 'border border-[#F7931A] bg-[#F7931A] text-black hover:bg-[#FFAA3B] focus-visible:outline-[#F7931A] primary-glow',
    secondary: 'border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-main)] hover:border-[#F7931A]/35 hover:bg-[var(--surface)] focus-visible:outline-[#3B82F6]',
    ghost: 'border border-transparent bg-transparent text-[var(--text-sec)] hover:bg-[var(--surface-2)] hover:text-[var(--text-main)] focus-visible:outline-[#3B82F6]',
    danger: 'border border-[#EF4444] bg-[#EF4444] text-white hover:bg-[#DC2626] focus-visible:outline-[#EF4444]',
    icon: 'aspect-square border border-transparent bg-transparent px-0 text-[var(--text-sec)] hover:bg-[var(--surface-2)] hover:text-[var(--text-main)] focus-visible:outline-[#3B82F6]',
  };
  return (
    <button type={type} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  hint?: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
}

export function Input({ label, error, hint, prefix, suffix, className = '', id, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id || `input-${String(label || rest.name || generatedId).replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {label && <label htmlFor={inputId} className="text-xs font-medium text-[var(--text-sec)]">{label}</label>}
      <div className="relative flex items-center">
        {prefix && <span className="pointer-events-none absolute left-3 text-sm text-[var(--text-sec)]">{prefix}</span>}
        <input id={inputId} className={`h-9 w-full rounded-lg border bg-[var(--elevated)] px-3 text-sm text-[var(--text-main)] outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-[var(--text-dim)] focus:border-[#F7931A] focus:ring-2 focus:ring-[#F7931A]/15 ${prefix ? 'pl-9' : ''} ${suffix ? 'pr-9' : ''} ${error ? 'border-[#EF4444] animate-[validation-shake_280ms_ease-out]' : 'border-[var(--border)]'} ${className}`} {...rest} />
        {suffix && <span className="pointer-events-none absolute right-3 text-sm text-[var(--text-sec)]">{suffix}</span>}
      </div>
      {error ? <span className="text-xs text-[#EF4444]">{error}</span> : hint ? <span className="text-[10px] text-[var(--text-dim)]">{hint}</span> : null}
    </div>
  );
}

interface SelectProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  disabled?: boolean;
}
export function Select({ label, value, onChange, options, className = '', disabled }: SelectProps) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      {label && <span className="text-xs font-medium text-[var(--text-sec)]">{label}</span>}
      <select value={value} onChange={event => onChange(event.target.value)} disabled={disabled} className={`h-9 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 text-sm text-[var(--text-main)] outline-none transition-colors focus:border-[#F7931A] disabled:opacity-50 ${className}`}>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function Card({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <div className={`rounded-xl border border-[var(--border-soft)] bg-[var(--surface)] transition-[border-color,background-color] duration-200 hover:border-[var(--border)] ${className}`} style={style}>{children}</div>;
}

interface KPICardProps { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: string; delay?: number }
export function KPICard({ label, value, sub, icon, accent = C.gold, delay = 0 }: KPICardProps) {
  return (
    <Card className="card-reveal p-4" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-2 flex items-start justify-between"><span className="text-xs font-medium uppercase tracking-wider text-[var(--text-sec)]">{label}</span>{icon && <span style={{ color: accent }}>{icon}</span>}</div>
      <div className="tabular text-2xl font-bold text-[var(--text-main)]">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--text-sec)]">{sub}</div>}
    </Card>
  );
}

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral' | 'gold' | 'violet';
export function Badge({ children, variant = 'neutral', pulse = false }: { children: ReactNode; variant?: BadgeVariant; pulse?: boolean }) {
  const styles: Record<BadgeVariant, string> = {
    success: 'border-[#22C55E]/30 bg-[#22C55E]/15 text-[#22C55E]',
    danger: 'border-[#EF4444]/30 bg-[#EF4444]/15 text-[#EF4444]',
    warning: 'border-[#F59E0B]/30 bg-[#F59E0B]/15 text-[#F59E0B]',
    info: 'border-[#3B82F6]/30 bg-[#3B82F6]/15 text-[#3B82F6]',
    neutral: 'border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-sec)]',
    gold: 'border-[#F7931A]/30 bg-[#F7931A]/15 text-[#F7931A]',
    violet: 'border-[#8B5CF6]/30 bg-[#8B5CF6]/15 text-[#A78BFA]',
  };
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${styles[variant]} ${pulse ? 'status-pulse' : ''}`}>{children}</span>;
}

export function Toggle({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F7931A] disabled:opacity-50 ${checked ? 'bg-[#F7931A]' : 'bg-[var(--border)]'}`}>
      <span className={`mt-0.5 block h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

export function Skeleton({ className = '' }: { className?: string }) { return <div className={`skeleton ${className}`} />; }

export function StatusDot({ status }: { status: 'online' | 'offline' | 'warning' | 'error' }) {
  const colors = { online: '#22C55E', offline: '#8EA0B8', warning: '#F59E0B', error: '#EF4444' };
  return <span className="relative inline-flex h-2 w-2"><span className="pulse-dot absolute inline-flex h-full w-full rounded-full" style={{ backgroundColor: colors[status], opacity: .55 }} /><span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: colors[status] }} /></span>;
}

export function SectionHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return <div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold text-[var(--text-main)]">{title}</h2>{sub && <p className="mt-0.5 text-xs text-[var(--text-sec)]">{sub}</p>}</div>{action}</div>;
}

type DataSource = 'API' | 'Cache' | 'Stale Cache' | 'Fallback';
export function DataBadge({ source, age }: { source: DataSource; age: string }) {
  const colors: Record<DataSource, string> = { API: 'text-[#22C55E]', Cache: 'text-[#3B82F6]', 'Stale Cache': 'text-[#F59E0B]', Fallback: 'text-[#EF4444]' };
  return <span className={`inline-flex items-center gap-1 font-mono text-xs ${colors[source]}`}><StatusDot status={source === 'API' || source === 'Cache' ? 'online' : 'warning'} />{source} · {age}</span>;
}

export function Disclaimer({ text, tone = 'gold' }: { text: string; tone?: 'gold' | 'info' | 'danger' }) {
  const style = tone === 'danger' ? 'border-[#EF4444]/20 bg-[#EF4444]/[0.06]' : tone === 'info' ? 'border-[#3B82F6]/20 bg-[#3B82F6]/[0.06]' : 'border-[#F7931A]/20 bg-[#F7931A]/[0.06]';
  const color = tone === 'danger' ? '#EF4444' : tone === 'info' ? '#3B82F6' : '#F7931A';
  return <div className={`flex items-start gap-2 rounded-lg border p-3 ${style}`}><span className="mt-0.5 shrink-0 text-sm" style={{ color }}>⚠</span><p className="text-xs leading-relaxed text-[var(--text-sec)]">{text}</p></div>;
}

export function RiskMeter({ score }: { score: number }) {
  const safe = Math.max(0, Math.min(100, Number(score) || 0));
  const color = safe < 30 ? C.pos : safe < 60 ? '#F59E0B' : C.neg;
  const label = safe < 30 ? 'Thấp' : safe < 60 ? 'Trung bình' : 'Cao';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-10 w-20 overflow-hidden">
        <div className="absolute bottom-0 left-0 h-20 w-full rounded-full border-[5px] border-[var(--border)]" />
        <div className="absolute bottom-0 left-0 h-20 w-full rounded-full border-[5px] transition-all duration-700" style={{ borderColor: color, clipPath: `polygon(0 100%,100% 100%,100% ${100 - safe}%,0 ${100 - safe}%)` }} />
        <div className="absolute inset-0 flex items-end justify-center pb-0.5"><span className="tabular text-[11px] font-bold" style={{ color }}>{Math.round(safe)}</span></div>
      </div>
      <span className="text-[10px] font-medium" style={{ color }}>{label}</span>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 'max-w-lg' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', close); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <button className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-label="Đóng hộp thoại" />
      <section role="dialog" aria-modal="true" aria-label={title} className={`modal-in relative z-10 max-h-[90vh] w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl ${width}`}>
        <header className="flex items-center justify-between border-b border-[var(--border-soft)] px-5 py-4"><h2 className="font-semibold text-[var(--text-main)]">{title}</h2><button onClick={onClose} className="icon-control h-8 w-8">✕</button></header>
        <div className="max-h-[65vh] overflow-y-auto p-5">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-[var(--border-soft)] px-5 py-4">{footer}</footer>}
      </section>
    </div>
  );
}
