import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { formatDateTime, formatVND } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Input, SectionHeader, Skeleton, Toggle } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

type Wallet = { wallet?: Record<string, unknown> };
type Subscription = { active?: boolean; plan_name?: string; expires_at?: string };
type AIHistory = { data?: Array<Record<string, unknown>> };

export default function Account() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [name, setName] = useState(String(auth.profile?.full_name || auth.user?.user_metadata?.full_name || ''));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [notifications, setNotifications] = useState(() => localStorage.getItem('btc_email_preferences') !== 'off');
  const [profileSaving, setProfileSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [history, setHistory] = useState<AIHistory | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      apiRequest<Wallet>('/api/wallet/me', { signal: controller.signal }),
      apiRequest<Subscription>('/api/payment/subscription', { signal: controller.signal }),
      apiRequest<AIHistory>('/api/ai/history?limit=5', { signal: controller.signal }),
    ]).then(results => {
      if (results[0].status === 'fulfilled') setWallet(results[0].value);
      if (results[1].status === 'fulfilled') setSubscription(results[1].value);
      if (results[2].status === 'fulfilled') setHistory(results[2].value);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const saveProfile = async () => {
    if (!name.trim()) { showToast('Họ tên không được để trống.', 'warning'); return; }
    setProfileSaving(true);
    try {
      await auth.updateProfile(name.trim());
      await auth.refreshProfile();
      showToast('Đã cập nhật hồ sơ.', 'success');
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'Không cập nhật được hồ sơ.', 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  const changePassword = async () => {
    if (password.length < 8) { showToast('Mật khẩu cần ít nhất 8 ký tự.', 'warning'); return; }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) { showToast('Mật khẩu nên có cả chữ và số.', 'warning'); return; }
    if (password !== confirmPassword) { showToast('Xác nhận mật khẩu không khớp.', 'warning'); return; }

    setPasswordSaving(true);
    try {
      await auth.updatePassword(password);
      setPassword('');
      setConfirmPassword('');
      showToast('Đã tạo hoặc cập nhật mật khẩu. Bạn có thể dùng mật khẩu này ở lần đăng nhập sau.', 'success');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không đổi được mật khẩu.';
      showToast(message.toLowerCase().includes('reauthentication')
        ? 'Phiên đăng nhập cần xác thực lại. Hãy đăng xuất, đăng nhập bằng OTP rồi thử đổi mật khẩu.'
        : message, 'error');
    } finally {
      setPasswordSaving(false);
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    await auth.signOut();
    navigate('/login', { replace: true });
  };

  const profile = auth.profile || {};
  const displayName = String(profile.full_name || name || auth.user?.email?.split('@')[0] || 'Người dùng');
  const balance = Number(wallet?.wallet?.balance_vnd || 0);

  return <div className="page-enter space-y-5">
    <header><Badge variant="info">Account Center</Badge><h1 className="mt-2 text-2xl font-extrabold">Tài khoản của bạn</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Quản lý hồ sơ, phương thức đăng nhập, gói Sandbox và hoạt động gần đây.</p></header>
    {loading ? <div className="grid gap-4 lg:grid-cols-[.7fr_1.3fr]"><Skeleton className="h-96"/><Skeleton className="h-96"/></div> : <section className="grid gap-4 lg:grid-cols-[.72fr_1.28fr]">
      <div className="space-y-4"><Card className="hero-surface p-6 text-center"><div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-[#F7931A]/15 text-4xl font-black text-[#F7931A]">{displayName.slice(0,1).toUpperCase()}</div><h2 className="mt-4 text-xl font-bold">{displayName}</h2><p className="mt-1 text-sm text-[var(--text-sec)]">{auth.user?.email}</p><div className="mt-3 flex justify-center gap-2"><Badge variant={auth.isAdmin ? 'violet' : 'info'}>{auth.isAdmin ? 'Quản trị viên' : 'Người dùng'}</Badge><Badge variant={subscription?.active ? 'gold' : 'neutral'}>{subscription?.plan_name || 'Free'}</Badge></div><div className="mt-6 grid gap-3 text-left sm:grid-cols-2 lg:grid-cols-1"><div className="metric-box"><span>Số dư ví demo</span><strong>{formatVND(balance)}</strong></div><div className="metric-box"><span>Premium hết hạn</span><strong className="text-sm">{subscription?.active ? formatDateTime(subscription.expires_at) : 'Chưa đăng ký'}</strong></div></div></Card><Disclaimer text="Không chia sẻ mật khẩu, mã OTP hoặc khóa truy cập. BTC BigData Platform không yêu cầu chuyển tiền thật qua chat hoặc Email." tone="danger"/></div>
      <div className="space-y-4"><Card className="p-5"><SectionHeader title="Thông tin cá nhân" sub="Tên hiển thị được lưu trong Supabase Auth."/><div className="grid gap-4 sm:grid-cols-2"><Input label="Họ và tên" value={name} onChange={event => setName(event.target.value)}/><Input label="Email" value={String(auth.user?.email || '')} disabled/></div><Button loading={profileSaving} onClick={saveProfile} className="mt-4">Lưu thay đổi</Button></Card>
      <Card className="p-5"><SectionHeader title="Tạo hoặc đổi mật khẩu" sub="Tài khoản vẫn có thể đăng nhập bằng OTP. Mật khẩu mới dùng cho phương thức đăng nhập bằng mật khẩu."/><div className="grid gap-4 sm:grid-cols-2"><Input label="Mật khẩu mới" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự"/><Input label="Xác nhận mật khẩu" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Nhập lại mật khẩu" onKeyDown={event => { if (event.key === 'Enter') void changePassword(); }}/></div><p className="mt-3 text-xs text-[var(--text-sec)]">Mật khẩu cần tối thiểu 8 ký tự và nên có cả chữ lẫn số. Sau khi cập nhật, bạn vẫn có thể chọn OTP Email ở màn hình đăng nhập.</p><Button variant="secondary" loading={passwordSaving} onClick={changePassword} className="mt-4">Cập nhật mật khẩu</Button></Card>
      <Card className="p-5"><SectionHeader title="Cài đặt riêng tư"/><div className="flex items-center justify-between gap-4"><div><p className="text-sm font-medium">Nhận Email cảnh báo</p><p className="mt-1 text-xs text-[var(--text-sec)]">Tùy chọn giao diện cục bộ; rule Email được quản lý tại trang Cảnh báo.</p></div><Toggle checked={notifications} onChange={value => { setNotifications(value); localStorage.setItem('btc_email_preferences', value ? 'on' : 'off'); }}/></div></Card>
      <Card className="p-5"><SectionHeader title="Câu hỏi AI gần đây" action={<Button size="sm" variant="secondary" onClick={() => navigate('/history')}>Xem lịch sử</Button>}/><div className="space-y-2">{history?.data?.length ? history.data.map((row, index) => <div key={String(row.id || index)} className="flex gap-3 rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-3"><span className="text-[#8B5CF6]">✨</span><div className="min-w-0"><p className="line-clamp-2 text-sm">{String(row.question || 'Câu hỏi AI')}</p><p className="mt-1 text-xs text-[var(--text-dim)]">{formatDateTime(row.created_at)} · {String(row.verdict || 'NEUTRAL')}</p></div></div>) : <p className="py-5 text-center text-sm text-[var(--text-sec)]">Chưa có lịch sử AI.</p>}</div></Card>
      <Card className="border-[#EF4444]/25 p-5"><SectionHeader title="Phiên đăng nhập" sub="Đăng xuất khỏi thiết bị này và xóa cache phiên cục bộ."/><Button variant="danger" loading={loggingOut} onClick={() => void logout()}>Đăng xuất</Button></Card></div>
    </section>}
  </div>;
}
