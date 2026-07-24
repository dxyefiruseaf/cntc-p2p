import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Disclaimer, Input } from '../components/ui';
import { useAuth } from '../context/AuthContext';

type Mode = 'login' | 'register' | 'recover' | 'verify' | 'set-password';
type OtpPurpose = 'register' | 'recover';
type PendingAuthFlow = {
  purpose: OtpPurpose;
  email: string;
  fullName: string;
  stage: 'verify' | 'set-password';
};

const RESEND_SECONDS = 60;
const PENDING_AUTH_KEY = 'btc_pending_auth_flow_v1';

function readPendingFlow(): PendingAuthFlow | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(PENDING_AUTH_KEY) || 'null') as PendingAuthFlow | null;
    if (!value || !value.email || !['register', 'recover'].includes(value.purpose)) return null;
    return value;
  } catch {
    return null;
  }
}

function savePendingFlow(value: PendingAuthFlow | null) {
  if (value) sessionStorage.setItem(PENDING_AUTH_KEY, JSON.stringify(value));
  else sessionStorage.removeItem(PENDING_AUTH_KEY);
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function friendlyAuthError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : 'Không thể xác thực tài khoản.';
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return 'Email hoặc mật khẩu không đúng.';
  if (normalized.includes('email not confirmed')) return 'Email chưa được xác thực. Hãy chọn Đăng ký và xác minh bằng OTP.';
  if (normalized.includes('otp') && (normalized.includes('expired') || normalized.includes('invalid'))) return 'Mã OTP không đúng hoặc đã hết hạn. Vui lòng gửi mã mới.';
  if (normalized.includes('user not found') || normalized.includes('signups not allowed')) return 'Không tìm thấy tài khoản với email này.';
  if (normalized.includes('rate limit') || normalized.includes('security purposes')) return 'Bạn thao tác quá nhanh. Vui lòng chờ một lúc rồi thử lại.';
  if (normalized.includes('password should be')) return 'Mật khẩu chưa đáp ứng yêu cầu bảo mật của Supabase.';
  return message;
}

export default function Login() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const initialPending = useRef(readPendingFlow());
  const [mode, setMode] = useState<Mode>(() => initialPending.current?.stage === 'set-password' ? 'set-password' : initialPending.current?.stage === 'verify' ? 'verify' : 'login');
  const [purpose, setPurpose] = useState<OtpPurpose>(() => initialPending.current?.purpose || 'register');
  const [fullName, setFullName] = useState(() => initialPending.current?.fullName || '');
  const [email, setEmail] = useState(() => initialPending.current?.email || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const flowInProgress = useRef(Boolean(initialPending.current));
  const nextPath = String((location.state as { from?: string } | null)?.from || '/dashboard');

  useEffect(() => {
    if (!auth.ready || !auth.isAuthenticated) return;
    if (flowInProgress.current && mode === 'set-password') return;
    navigate(nextPath, { replace: true });
  }, [auth.ready, auth.isAuthenticated, mode, navigate, nextPath]);

  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const timer = window.setInterval(() => setResendIn(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [resendIn]);

  const clearMessages = () => {
    setError('');
    setNotice('');
  };

  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(friendlyAuthError(reason));
    } finally {
      setLoading(false);
    }
  };

  const resetFlow = async (nextMode: 'login' | 'register') => {
    if (auth.isAuthenticated && flowInProgress.current) await auth.signOut();
    flowInProgress.current = false;
    savePendingFlow(null);
    setPurpose('register');
    setMode(nextMode);
    setOtp('');
    setPassword('');
    setConfirmPassword('');
    setResendIn(0);
    clearMessages();
  };

  const login = () => void run(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!validEmail(normalizedEmail) || !password) throw new Error('Vui lòng nhập email hợp lệ và mật khẩu.');
    await auth.signIn(normalizedEmail, password);
    navigate(nextPath, { replace: true });
  });

  const sendRegistrationOtp = () => void run(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = fullName.trim();
    if (normalizedName.length < 2) throw new Error('Vui lòng nhập họ và tên.');
    if (!validEmail(normalizedEmail)) throw new Error('Vui lòng nhập email hợp lệ.');

    await auth.sendRegistrationOtp(normalizedEmail, normalizedName);
    const pending: PendingAuthFlow = {
      purpose: 'register',
      email: normalizedEmail,
      fullName: normalizedName,
      stage: 'verify',
    };
    savePendingFlow(pending);
    flowInProgress.current = true;
    setPurpose('register');
    setEmail(normalizedEmail);
    setFullName(normalizedName);
    setOtp('');
    setResendIn(RESEND_SECONDS);
    setNotice(`Mã OTP đăng ký đã được gửi tới ${normalizedEmail}.`);
    setMode('verify');
  });

  const sendRecoveryOtp = () => void run(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!validEmail(normalizedEmail)) throw new Error('Vui lòng nhập email hợp lệ.');

    await auth.sendRecoveryOtp(normalizedEmail);
    const pending: PendingAuthFlow = {
      purpose: 'recover',
      email: normalizedEmail,
      fullName: '',
      stage: 'verify',
    };
    savePendingFlow(pending);
    flowInProgress.current = true;
    setPurpose('recover');
    setEmail(normalizedEmail);
    setOtp('');
    setResendIn(RESEND_SECONDS);
    setNotice(`Mã OTP khôi phục đã được gửi tới ${normalizedEmail}.`);
    setMode('verify');
  });

  const resendOtp = () => {
    if (purpose === 'register') sendRegistrationOtp();
    else sendRecoveryOtp();
  };

  const verify = () => void run(async () => {
    const normalizedOtp = otp.trim();
    if (!/^\d{6,8}$/.test(normalizedOtp)) throw new Error('Mã OTP phải gồm từ 6 đến 8 chữ số.');
    flowInProgress.current = true;
    await auth.verifyOtp(email.trim().toLowerCase(), normalizedOtp);
    savePendingFlow({ purpose, email, fullName, stage: 'set-password' });
    setPassword('');
    setConfirmPassword('');
    setNotice(purpose === 'register'
      ? 'Email đã được xác thực. Hãy tạo mật khẩu để hoàn tất đăng ký.'
      : 'Email đã được xác thực. Hãy đặt mật khẩu mới.');
    setMode('set-password');
  });

  const finishPasswordSetup = () => void run(async () => {
    if (password.length < 8) throw new Error('Mật khẩu phải có ít nhất 8 ký tự.');
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('Mật khẩu phải có cả chữ và số.');
    if (password !== confirmPassword) throw new Error('Xác nhận mật khẩu không khớp.');

    await auth.completePasswordSetup(password, purpose === 'register' ? fullName.trim() : undefined);
    savePendingFlow(null);
    flowInProgress.current = false;
    setNotice(purpose === 'register' ? 'Đăng ký thành công.' : 'Đổi mật khẩu thành công.');
    navigate(nextPath, { replace: true });
  });

  const showEntryTabs = mode === 'login' || mode === 'register' || mode === 'recover';
  const step = mode === 'verify' ? 2 : mode === 'set-password' ? 3 : 1;

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

          {showEntryTabs && <div className="mb-5 grid grid-cols-2 rounded-xl bg-[var(--surface-2)] p-1">
            <button type="button" className={`segment-btn ${mode === 'login' || mode === 'recover' ? 'active' : ''}`} onClick={() => void resetFlow('login')}>Đăng nhập</button>
            <button type="button" className={`segment-btn ${mode === 'register' ? 'active' : ''}`} onClick={() => void resetFlow('register')}>Đăng ký</button>
          </div>}

          {(mode === 'verify' || mode === 'set-password') && <div className="mb-5">
            <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
              {['Thông tin', 'Xác thực OTP', 'Đặt mật khẩu'].map((label, index) => {
                const number = index + 1;
                const active = number <= step;
                return <div key={label} className={`rounded-lg border px-2 py-2 ${active ? 'border-[#F7931A]/40 bg-[#F7931A]/10 text-[#F7931A]' : 'border-[var(--border-soft)] text-[var(--text-dim)]'}`}><strong className="mr-1">{number}</strong>{label}</div>;
              })}
            </div>
          </div>}

          {error && <div className="mb-4 rounded-xl border border-[#EF4444]/25 bg-[#EF4444]/10 px-3 py-2 text-sm text-[#EF4444]">{error}</div>}
          {notice && <div className="mb-4 rounded-xl border border-[#22C55E]/25 bg-[#22C55E]/10 px-3 py-2 text-sm text-[#22C55E]">{notice}</div>}

          {mode === 'login' && <div className="card-reveal space-y-4">
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="email@example.com" />
            <Input label="Mật khẩu" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="••••••••" onKeyDown={event => { if (event.key === 'Enter') login(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={login}>Đăng nhập</Button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button type="button" className="text-[var(--text-sec)] hover:text-[#F7931A]" onClick={() => { clearMessages(); setMode('recover'); }}>Quên mật khẩu?</button>
              <button type="button" className="text-[#F7931A] hover:underline" onClick={() => void resetFlow('register')}>Chưa có tài khoản</button>
            </div>
          </div>}

          {mode === 'register' && <div className="card-reveal space-y-4">
            <Input label="Họ và tên" autoComplete="name" value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Nguyễn Văn A" />
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="email@example.com" onKeyDown={event => { if (event.key === 'Enter') sendRegistrationOtp(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={sendRegistrationOtp}>Gửi OTP xác thực email</Button>
            <p className="text-center text-xs leading-relaxed text-[var(--text-sec)]">Bạn sẽ xác thực email bằng OTP trước, sau đó mới tạo mật khẩu. Tài khoản chỉ hoàn tất khi cả hai bước thành công.</p>
          </div>}

          {mode === 'recover' && <div className="card-reveal space-y-4">
            <div>
              <h2 className="font-bold">Khôi phục mật khẩu</h2>
              <p className="mt-1 text-xs text-[var(--text-sec)]">OTP chỉ được gửi nếu email đã có tài khoản.</p>
            </div>
            <Input label="Email tài khoản" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="email@example.com" onKeyDown={event => { if (event.key === 'Enter') sendRecoveryOtp(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={sendRecoveryOtp}>Gửi OTP khôi phục</Button>
            <button type="button" className="mx-auto block text-xs text-[var(--text-sec)] hover:text-[#F7931A]" onClick={() => setMode('login')}>Quay lại đăng nhập</button>
          </div>}

          {mode === 'verify' && <div className="card-reveal space-y-4">
            <div>
              <h2 className="font-bold">{purpose === 'register' ? 'Xác thực email đăng ký' : 'Xác thực quyền sở hữu email'}</h2>
              <p className="mt-1 text-sm text-[var(--text-sec)]">Nhập mã OTP đã gửi tới <strong className="text-[var(--text-main)]">{email}</strong>.</p>
            </div>
            <Input label="Mã OTP" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ''))} placeholder="000000" onKeyDown={event => { if (event.key === 'Enter') verify(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={verify}>Xác minh OTP</Button>
            <div className="flex items-center justify-between gap-3 text-xs">
              <button type="button" className="text-[var(--text-sec)] hover:text-[#F7931A]" onClick={() => void resetFlow(purpose === 'register' ? 'register' : 'login')}>Đổi email</button>
              <button type="button" disabled={loading || resendIn > 0} className="text-[var(--text-sec)] hover:text-[#F7931A] disabled:cursor-not-allowed disabled:opacity-50" onClick={resendOtp}>
                {resendIn > 0 ? `Gửi lại sau ${resendIn}s` : 'Gửi lại mã OTP'}
              </button>
            </div>
          </div>}

          {mode === 'set-password' && <div className="card-reveal space-y-4">
            <div>
              <h2 className="font-bold">{purpose === 'register' ? 'Tạo mật khẩu đăng nhập' : 'Đặt mật khẩu mới'}</h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-sec)]">Email <strong className="text-[var(--text-main)]">{email}</strong> đã được xác thực. Mật khẩu cần ít nhất 8 ký tự, có chữ và số.</p>
            </div>
            <Input label="Mật khẩu mới" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" />
            <Input label="Xác nhận mật khẩu" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="Nhập lại mật khẩu" onKeyDown={event => { if (event.key === 'Enter') finishPasswordSetup(); }} />
            <Button loading={loading} className="w-full primary-glow" onClick={finishPasswordSetup}>{purpose === 'register' ? 'Hoàn tất đăng ký' : 'Cập nhật mật khẩu'}</Button>
            <button type="button" className="mx-auto block text-xs text-[var(--text-sec)] hover:text-[#F7931A]" onClick={() => void resetFlow('login')}>Hủy và quay lại đăng nhập</button>
          </div>}
        </section>

        <div className="mt-4"><Disclaimer text="Nền tảng phục vụ học tập, nghiên cứu và trình diễn công nghệ. Không vận hành sàn giao dịch thật và không lưu ký tài sản." /></div>
      </section>
    </main>
  );
}
