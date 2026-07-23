import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

interface SidebarProps { collapsed: boolean }

type NavItem = { path: string; icon: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

const groups: NavGroup[] = [
  { label: 'Thị trường', items: [
    { path: '/dashboard', icon: '⬡', label: 'Tổng quan' },
    { path: '/chart', icon: '📈', label: 'Biểu đồ kỹ thuật' },
    { path: '/p2p', icon: '↔', label: 'So sánh P2P' },
    { path: '/news', icon: '📰', label: 'Tin tức BTC' },
    { path: '/data', icon: '🛡', label: 'Độ tin cậy' },
  ]},
  { label: 'Công cụ', items: [
    { path: '/decision', icon: '🧭', label: 'Decision Hub' },
    { path: '/exchange', icon: '⚡', label: 'Giao dịch demo' },
    { path: '/wallet', icon: '💼', label: 'Ví demo & QR' },
    { path: '/tax', icon: '🧮', label: 'Ước tính thuế' },
    { path: '/settlement', icon: '⚖', label: 'Tính thực nhận' },
    { path: '/alerts', icon: '🔔', label: 'Cảnh báo Email' },
  ]},
  { label: 'Tài khoản', items: [
    { path: '/premium', icon: '💎', label: 'Premium Sandbox' },
    { path: '/history', icon: '◷', label: 'Lịch sử' },
    { path: '/account', icon: '👤', label: 'Tài khoản' },
  ]},
  { label: 'Học phần', items: [
    { path: '/theory', icon: '▤', label: 'Lý thuyết & BMC' },
    { path: '/experiment', icon: '⚗', label: 'Thử nghiệm API' },
    { path: '/about', icon: 'ⓘ', label: 'Về nền tảng' },
  ]},
];

export default function Sidebar({ collapsed }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useAuth();
  const width = collapsed ? 64 : 224;
  const renderedGroups = useMemo(() => groups, []);

  return (
    <aside className="app-sidebar fixed bottom-0 left-0 top-[79px] z-[60] flex flex-col overflow-hidden border-r border-[var(--border-soft)] bg-[var(--app-bg)] transition-[width] duration-200" style={{ width }}>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {renderedGroups.map(group => (
          <div key={group.label} className="mb-2">
            {!collapsed && <p className="px-2.5 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">{group.label}</p>}
            {group.items.map(item => {
              const active = location.pathname === item.path || (item.path === '/dashboard' && location.pathname === '/');
              return (
                <button key={item.path} onClick={() => navigate(item.path)} title={collapsed ? item.label : undefined} className={`sidebar-link ${active ? 'active' : ''} ${collapsed ? 'justify-center px-0' : ''}`}>
                  <span className="relative z-10 shrink-0 text-sm">{item.icon}</span>
                  {!collapsed && <span className="relative z-10 truncate text-xs">{item.label}</span>}
                  {active && !collapsed && <span className="active-indicator ml-auto" />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      {auth.isAdmin && (
        <div className="border-t border-[var(--border-soft)] p-2">
          <button onClick={() => navigate('/admin')} title={collapsed ? 'Admin Console' : undefined} className={`sidebar-link ${collapsed ? 'justify-center px-0' : ''}`}>
            <span>🔧</span>{!collapsed && <span className="text-xs">Admin Console</span>}
          </button>
        </div>
      )}
    </aside>
  );
}
