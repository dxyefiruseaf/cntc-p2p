import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMarket } from '../context/MarketContext';
import { useToast } from '../context/ToastContext';
import { asNumber, formatPercent, formatUSD, formatVND } from '../lib/format';
import { apiRequest } from '../lib/api';
import NotificationPanel from './NotificationPanel';

type HeaderNews = { title?: string; source?: string; link?: string };

const HEADER_NEWS_CACHE_KEY = 'btc_header_news_v1';

function cachedHeadlines(): HeaderNews[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(HEADER_NEWS_CACHE_KEY) || '[]') as HeaderNews[];
    return Array.isArray(parsed) ? parsed.filter(item => item?.title).slice(0, 8) : [];
  } catch {
    return [];
  }
}

interface HeaderProps {
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
  sidebarCollapsed: boolean;
  onSidebarToggle: () => void;
}

const pageLabels: Record<string, string> = {
  dashboard: 'Tổng quan', chart: 'Biểu đồ kỹ thuật', p2p: 'So sánh P2P', decision: 'Decision Hub',
  exchange: 'Giao dịch demo', wallet: 'Ví demo & QR', tax: 'Ước tính thuế', settlement: 'Tính thực nhận',
  alerts: 'Cảnh báo Email', news: 'Tin tức BTC', data: 'Độ tin cậy', premium: 'Premium Sandbox',
  account: 'Tài khoản', history: 'Lịch sử', theory: 'Lý thuyết học phần', business: 'Business Model Canvas',
};

export default function Header({ theme, onThemeToggle, sidebarCollapsed, onSidebarToggle }: HeaderProps) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [headlines, setHeadlines] = useState<HeaderNews[]>(cachedHeadlines);
  const userRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const market = useMarket();
  const { showToast } = useToast();

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (userRef.current && !userRef.current.contains(event.target as Node)) setUserOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserOpen(false);
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', key);
    };
  }, []);

  useEffect(() => {
    setNotifOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void apiRequest<{ data?: HeaderNews[] }>('/api/news/latest?limit=8', {
        cacheTtl: 300_000,
        timeout: 16_000,
        retries: 1,
      }).then(result => {
        if (!active) return;
        const next = (result.data || []).filter(item => item.title).slice(0, 8);
        if (next.length) {
          setHeadlines(next);
          try { window.sessionStorage.setItem(HEADER_NEWS_CACHE_KEY, JSON.stringify(next)); } catch { /* optional cache */ }
        }
      }).catch(() => { /* Market metrics remain as a graceful fallback. */ });
    }, 500);
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  const latest = market.latest;
  const rows = market.rows.slice(-24);
  const current = asNumber(latest.close);
  const opening = asNumber(rows[0]?.open || latest.open || current);
  const change = opening ? ((current - opening) / opening) * 100 : 0;
  const high = rows.length ? Math.max(...rows.map(row => asNumber(row.high || row.close))) : asNumber(latest.high);
  const low = rows.length ? Math.min(...rows.map(row => asNumber(row.low || row.close)).filter(value => value > 0)) : asNumber(latest.low);
  const buy = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'BUY');
  const sell = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'SELL');
  const displayName = String(auth.profile?.full_name || auth.profile?.display_name || auth.user?.user_metadata?.full_name || auth.user?.email?.split('@')[0] || 'Người dùng');
  const initials = displayName.trim().slice(0, 1).toUpperCase() || 'U';
  const pageKey = location.pathname.split('/').filter(Boolean).at(-1) || 'dashboard';

  const notifications = useMemo(() => {
    const generated = (market.data?.alerts?.data || []).slice(0, 5).map((item, index) => ({
      id: String(item.id || item.code || `market-${index}`),
      type: String(item.level || item.type || 'info'),
      title: String(item.title || item.name || 'Cảnh báo thị trường'),
      message: String(item.message || item.description || item.note || 'Có tín hiệu thị trường mới cần theo dõi.'),
      time: String(item.timestamp || latest.timestamp || ''),
      read: false,
    }));
    if (market.error) generated.unshift({ id: 'market-error', type: 'warning', title: 'Dữ liệu thị trường gián đoạn', message: market.error, time: '', read: false });
    return generated;
  }, [market.data?.alerts?.data, market.error, latest.timestamp]);

  const logout = async () => {
    setUserOpen(false);
    showToast('Đang đăng xuất...', 'info', 1200);
    await auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <header className="fixed inset-x-0 top-0 z-[80] flex flex-col border-b border-[var(--border)] bg-[var(--app-bg)]/95 backdrop-blur-xl">
      <div className="news-ticker-layer relative h-7 overflow-hidden border-b border-[var(--border-soft)]" aria-label="Tin Bitcoin mới nhất">
        <div
          className="ticker-track absolute h-full whitespace-nowrap"
          style={{ '--ticker-duration': `${Math.max(38, (headlines.length || 5) * 8)}s` } as CSSProperties}
        >
          {[0, 1].map(rep => (
            <div key={rep} className="ticker-group" aria-hidden={rep === 1}>
              <span className="news-ticker-badge">TIN BTC</span>
              {headlines.length ? headlines.map((item, index) => (
                <button
                  type="button"
                  key={`${rep}-${item.title}-${index}`}
                  className="news-ticker-item"
                  onClick={() => item.link && item.link !== '#' ? window.open(item.link, '_blank', 'noopener,noreferrer') : navigate('/news')}
                  title={item.title}
                  tabIndex={rep === 1 ? -1 : 0}
                >
                  <span className="text-[#F7931A]">●</span><strong>{item.title}</strong><span className="news-ticker-source">{item.source || 'Nguồn tin'}</span>
                </button>
              )) : <>
                <TickerItem label="BTC/USDT" value={formatUSD(current)} change={change} />
                <TickerItem label="24H CAO" value={formatUSD(high)} />
                <TickerItem label="24H THẤP" value={formatUSD(low)} />
                <TickerItem label="P2P MUA" value={buy?.p2p_price ? formatVND(buy.p2p_price) : '—'} />
                <TickerItem label="P2P BÁN" value={sell?.p2p_price ? formatVND(sell.p2p_price) : '—'} />
              </>}
            </div>
          ))}
        </div>
      </div>

      <div className="header-control-layer flex h-12 items-center gap-3 px-3 sm:px-4">
        <button onClick={onSidebarToggle} className="icon-control" aria-label={sidebarCollapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}>
          <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" /></svg>
        </button>

        <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F7931A]">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F7931A] text-xs font-black text-black">₿</div>
          <span className="hidden text-sm font-bold text-[var(--text-main)] sm:block">BTC BigData</span>
        </button>

        <button onClick={() => navigate('/chart')} className={`price-pill hidden items-center gap-2 md:flex ${market.direction === 'up' ? 'flash-up' : market.direction === 'down' ? 'flash-down' : ''}`}>
          <span className="text-xs text-[var(--text-sec)]">BTC/USDT</span>
          <span className="tabular text-sm font-bold text-[var(--text-main)]">{formatUSD(current)}</span>
          <span className={`tabular text-xs font-medium ${change >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{formatPercent(change)}</span>
        </button>

        <div className="hidden min-w-0 flex-1 lg:block">
          <span className="block truncate text-center text-xs text-[var(--text-sec)]">{pageLabels[pageKey] || 'Bitcoin Sandbox · FinTech Analytics · AI Advisor'}</span>
        </div>
        <div className="flex-1 lg:hidden" />

        <button onClick={onThemeToggle} className="icon-control" title="Chuyển giao diện" aria-label="Chuyển giao diện sáng tối">{theme === 'dark' ? '☀' : '🌙'}</button>

        <div className="relative">
          <button onClick={() => { setNotifOpen(value => !value); setUserOpen(false); }} className="icon-control relative" aria-label="Thông báo">
            <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" /></svg>
            {notifications.length > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#F7931A] px-1 text-[9px] font-bold text-black">{notifications.length}</span>}
          </button>
          {notifOpen && <NotificationPanel notifications={notifications} onClose={() => setNotifOpen(false)} />}
        </div>

        <div ref={userRef} className="relative">
          <button onClick={() => { setUserOpen(value => !value); setNotifOpen(false); }} className="flex h-8 items-center gap-2 rounded-lg px-1.5 pr-2.5 transition-colors hover:bg-[var(--surface-2)]">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F7931A] text-xs font-bold text-black">{initials}</div>
            <span className="hidden max-w-32 truncate text-xs font-medium text-[var(--text-main)] sm:block">{displayName}</span>
            <span className="text-[10px] text-[var(--text-sec)]">⌄</span>
          </button>
          {userOpen && (
            <div className="header-dropdown-layer modal-in absolute right-0 top-full mt-2 w-52 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-1 shadow-2xl">
              <div className="px-3 py-2 border-b border-[var(--border-soft)]">
                <p className="truncate text-xs font-semibold text-[var(--text-main)]">{displayName}</p>
                <p className="truncate text-[10px] text-[var(--text-sec)]">{auth.user?.email}</p>
              </div>
              <MenuItem icon="👤" label="Tài khoản" onClick={() => navigate('/account')} />
              <MenuItem icon="💎" label="Premium Sandbox" onClick={() => navigate('/premium')} />
              {auth.isAdmin && <MenuItem icon="🔧" label="Admin Console" onClick={() => navigate('/admin')} />}
              <div className="my-1 border-t border-[var(--border-soft)]" />
              <MenuItem icon="🚪" label="Đăng xuất" onClick={() => void logout()} danger />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function TickerItem({ label, value, change, color }: { label: string; value: string; change?: number; color?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{label}</span>
      <span className="tabular text-[10px] font-semibold" style={{ color: color || (change == null ? 'var(--text-main)' : change >= 0 ? '#22C55E' : '#EF4444') }}>{value}</span>
      {change != null && <span className={`text-[9px] ${change >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(2)}%</span>}
      <span className="mx-1 text-[var(--border)]">|</span>
    </span>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: string; label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${danger ? 'text-[#EF4444] hover:bg-[#EF4444]/10' : 'text-[var(--text-main)] hover:bg-[var(--surface-2)]'}`}><span>{icon}</span><span>{label}</span></button>;
}
