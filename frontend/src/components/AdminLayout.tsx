import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { RemoteDataStatusBar } from './DataStatusBar';

const nav = [
  { path: '/admin', icon: '⬡', label: 'Tổng quan' },
  { path: '/admin/users', icon: '👥', label: 'Người dùng' },
  { path: '/admin/transactions', icon: '💳', label: 'Giao dịch & Premium' },
  { path: '/admin/system', icon: '⚙', label: 'Hệ thống' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const { showToast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const name = String(auth.profile?.full_name || auth.profile?.display_name || auth.user?.email?.split('@')[0] || 'Admin');
  const email = String(auth.user?.email || auth.profile?.email || '');

  const logout = async () => {
    showToast('Đang đăng xuất...', 'info', 1000);
    await auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-[var(--app-bg)] text-[var(--text-main)]">
      <button onClick={() => setMobileOpen(value => !value)} className="fixed left-3 top-3 z-[110] flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--elevated)] text-[var(--text-main)] shadow-lg lg:hidden" aria-label="Mở menu Admin">☰</button>
      {mobileOpen && <button className="fixed inset-0 z-[89] bg-black/55 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Đóng menu" />}
      <aside className={`admin-sidebar fixed inset-y-0 left-0 z-[100] flex w-60 flex-col border-r border-[var(--border-soft)] bg-[var(--elevated)] transition-transform duration-200 ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F7931A] text-lg font-black text-black">₿</div>
          <div>
            <p className="text-sm font-bold text-[var(--text-main)]">BitAdmin</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#F7931A]">BTC BigData</p>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {nav.map(item => {
            const active = item.path === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(item.path);
            return (
              <button key={item.path} onClick={() => navigate(item.path)} className={`admin-nav-link ${active ? 'active' : ''}`}>
                <span className="text-sm">{item.icon}</span><span>{item.label}</span>{active && <span className="ml-auto h-5 w-1 rounded-full bg-[#F7931A]" />}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-[var(--border-soft)] p-3">
          <button onClick={() => navigate('/dashboard')} className="admin-bottom-link"><span>←</span><span>Giao diện người dùng</span></button>
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F7931A]/20 font-bold text-[#F7931A]">{name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{email || name}</p><p className="text-[10px] font-semibold uppercase text-[#F7931A]">Quản trị viên</p></div>
            <button onClick={() => void logout()} className="icon-control h-8 w-8" title="Đăng xuất">↪</button>
          </div>
        </div>
      </aside>

      <main className="min-h-screen lg:ml-60">
        <div className="mx-auto w-full max-w-[1600px] p-4 pt-16 sm:p-6 lg:pt-6"><RemoteDataStatusBar />{children}</div>
      </main>
    </div>
  );
}
