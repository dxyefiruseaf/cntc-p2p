import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { relativeTime } from '../lib/format';
import { EmptyState } from './Feedback';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  time: string;
  read: boolean;
}

export default function NotificationPanel({ notifications, onClose }: { notifications: NotificationItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [read, setRead] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    window.setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className="header-dropdown-layer modal-in absolute right-0 top-full z-[100] mt-2 w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--elevated)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--border-soft)] px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text-main)]">Thông báo</p>
          <p className="text-[10px] text-[var(--text-sec)]">Cảnh báo thị trường và hoạt động sandbox</p>
        </div>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && <button onClick={() => setRead(new Set(notifications.map(item => item.id)))} className="text-[10px] font-medium text-[#F7931A] hover:text-[#FFAA3B]">Đọc tất cả</button>}
          <button onClick={onClose} className="icon-control h-7 w-7" aria-label="Đóng thông báo">✕</button>
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto p-2">
        {notifications.length === 0 ? (
          <EmptyState icon="🔕" title="Chưa có thông báo" description="Giao dịch demo, cảnh báo và Premium sẽ xuất hiện tại đây." />
        ) : notifications.map(item => {
          const isRead = item.read || read.has(item.id);
          const style = notificationStyle(item.type);
          return (
            <article key={item.id} className={`mb-1 flex gap-3 rounded-xl border px-3 py-3 transition-colors hover:bg-[var(--surface-2)] ${isRead ? 'border-transparent' : 'border-[#F7931A]/12 bg-[#F7931A]/[0.035]'}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm" style={{ background: `${style.color}18`, color: style.color }}>{style.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5"><h4 className="truncate text-xs font-semibold text-[var(--text-main)]">{item.title}</h4>{!isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#F7931A]" />}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--text-sec)]">{item.message}</p>
                <time className="mt-1 block text-[10px] text-[var(--text-dim)]">{item.time ? relativeTime(item.time) : 'vừa xong'}</time>
              </div>
            </article>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--border-soft)] px-4 py-2.5">
        <button onClick={() => { navigate('/alerts'); onClose(); }} className="text-xs text-[var(--text-sec)] hover:text-[#F7931A]">Quản lý cảnh báo Email →</button>
        <button onClick={onClose} className="text-xs text-[var(--text-dim)] hover:text-[var(--text-main)]">Đóng</button>
      </div>
    </div>
  );
}

function notificationStyle(type: string): { color: string; icon: string } {
  const value = type.toLowerCase();
  if (value.includes('error') || value.includes('critical') || value.includes('high')) return { color: '#EF4444', icon: '!' };
  if (value.includes('warn') || value.includes('medium')) return { color: '#F59E0B', icon: '⚠' };
  if (value.includes('success') || value.includes('buy')) return { color: '#22C55E', icon: '✓' };
  return { color: '#3B82F6', icon: 'i' };
}
