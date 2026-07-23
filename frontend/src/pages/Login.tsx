import { useEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Disclaimer, Input } from '../components/ui';
import { useAuth } from '../context/AuthContext';

type Mode = 'password' | 'otp' | 'verify';

const RESEND_SECONDS = 60;

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const nextPath = String((location.state as { from?: string } | null)?.from || '/dashboard');

  useEffect(() => {
    if (auth.ready && auth.isAuthenticated) navigate(nextPath, { replace: true });
  }, [auth.ready, auth.isAuthenticated, navigate, nextPath]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setInterval(() => {
      setResendIn(value => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    setError('');
    setNotice('');
    if (nextMode !== 'verify') setOtp('');
  };

  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể xác thực tài khoản.';
      setError(message.toLowerCase().includes('invalid login credentials')
        ? 'Email hoặc mật khẩu không đúng.'
        : message);
    } finally {
      setLoading(false);
    }
  };

  const login = () => void run(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) throw new Error('Vui lòng nhập email và mật khẩu.');
    await auth.signIn(normalizedEmail, password);
    navigate(nextPath, { replace: true });
  });

  const sendOtp = () => void run(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) throw new Error('Vui lòng nhập email.');
    await auth.sendOtp(normalizedEmail);
    setEmail(normalizedEmail);
    setOtp('');
    setResendIn(RESEND_SECONDS);
    setNotice(`Mã OTP đã được gửi tới ${normalizedEmail}.`);
    setMode('verify');
  });

  const verify = () => void run(async () => {
    if (!/^\d{6,8}$/.test(otp.trim())) throw new Error('Mã OTP phải gồm từ 6 đến 8 chữ số.');
    await auth.verifyOtp(email.trim().toLowerCase(), otp.trim());
    navigate(nextPath, { replace: true });
  });

  return (
    <main className="login-stage min-h-screen overflow-hidden bg-[var(--app-bg)] text-[var(--text-main)]">
      <div className="login-orb login-orb-one" /><div className="login-orb login-orb-two" />
      {[0, 1, 2, 3].map(index => <span key={index} className="login-bitcoin particle" style={{ '--dur': `${8 + index * 2}s`, left: `${8 + index * 25}%`, top: `${18 + (index % 2) * 48}%` } as CSSProperties}>₿</span>)}
      <section className="page-enter relative z-10 mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-10">
        <header className="mb-7 text-center">
          <div className="spin-slow mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F7931A] text-3xl font-black text-black shadow-[0_16px_50px_rgba(247,147,26,.24)]">₿</div>
          <h1 className="text-2xl font-extrabold">BTC BigData Platform</h1>
          <p className="mt-1 text-sm text-[var(--text-sec)]">Bitcoin Sandbox · FinTech Analytics · AI Advisor</p>
        </header>
        <section className="rounded-3xl border border-[var(--border)] bg-[var(--surface)]/95 p-6 shadow-2xl backdrop-blur-xl">
          <div className="mb-5 rounded-xl border border-[#F7931A]/20 bg-[#F7931A]/[.07] px-3 py-2 text-center text-xs font-semibold text-[#F7931A]">Môi trường Sandbox — Không giao dịch tiền thật</div>
          <div className="mb-5 grid grid-cols-2 rounded-xl bg-[var(--surface-2)] p-1">
            <button type="button" className={`segment-btn ${mode === 'password' ? 'active' : ''}`} onClick={() => switchMode('password')}>Mật khẩu</button>
            <button type="button" className={`segment-btn ${mode !== 'password' ? 'active' : ''}`} onClick={() => switchMode('otp')}>OTP Email</button>
          </div>

          {error && <div className="mb-4 rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/10 px-3 py-2 text-sm text-[#EF4444]">{error}</div>}
          {notice && <div className="mb-4 rounded-xl border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-2 text-sm text-[#22C55E]">{notice}</div>}

          {mode === 'password' && <div className="card-reveal space-y-4">
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="email@example.com" />
            <Input label="Mật khẩu" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" onKeyDown={event => { if (event.key === 'Enter') login(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={login}>Đăng nhập bằng mật khẩu</Button>
            <button type="button" className="mx-auto block text-xs text-[var(--text-sec)] hover:text-[#F7931A]" onClick={() => switchMode('otp')}>Quên mật khẩu hoặc chưa có mật khẩu? Dùng OTP</button>
          </div>}

          {mode === 'otp' && <div className="card-reveal space-y-4">
            <Input label="Email nhận mã" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="email@example.com" onKeyDown={event => { if (event.key === 'Enter') sendOtp(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={sendOtp}>Gửi mã OTP</Button>
            <p className="text-center text-xs leading-relaxed text-[var(--text-sec)]">Mã OTP dùng để đăng nhập hoặc đăng ký tài khoản. Sau khi đăng nhập, bạn có thể tạo hay đổi mật khẩu trong trang Tài khoản.</p>
          </div>}

          {mode === 'verify' && <div className="card-reveal space-y-4">
            <p className="text-sm text-[var(--text-sec)]">Nhập mã OTP đã gửi tới <strong className="text-[var(--text-main)]">{email}</strong>.</p>
            <Input label="Mã OTP" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="000000" onKeyDown={event => { if (event.key === 'Enter') verify(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={verify}>Xác minh và đăng nhập</Button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button type="button" className="text-[var(--text-sec)] hover:text-[#F7931A]" onClick={() => switchMode('otp')}>Đổi email</button>
              <button type="button" disabled={loading || resendIn > 0} className="text-[var(--text-sec)] hover:text-[#F7931A] disabled:cursor-not-allowed disabled:opacity-50" onClick={sendOtp}>
                {resendIn > 0 ? `Gửi lại sau ${resendIn}s` : 'Gửi lại mã OTP'}
              </button>
            </div>
          </div>}
        </section>
        <div className="mt-4"><Disclaimer text="Nền tảng phục vụ học tập, nghiên cứu và trình diễn công nghệ. Không vận hành sàn giao dịch thật và không lưu ký tài sản." /></div>
      </section>
    </main>
  );
}
