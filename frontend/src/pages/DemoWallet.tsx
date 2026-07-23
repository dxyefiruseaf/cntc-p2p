import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { apiRequest, clearApiCache } from '../lib/api';
import { formatDateTime, formatNumber, formatVND } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Input, SectionHeader, Skeleton } from '../components/ui';
import { useToast } from '../context/ToastContext';
import { ErrorState } from '../components/Feedback';

type WalletResponse = { wallet?: Record<string, unknown>; transactions?: Array<Record<string, unknown>>; disclaimer?: string };
type Topup = { payment_url?: string; qr_payload?: string; txn_ref?: string; amount_vnd?: number; payment_mode?: string; message?: string };
const presets = [50_000, 100_000, 200_000, 500_000, 1_000_000];

export default function DemoWallet() {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [amount, setAmount] = useState('200000');
  const [topup, setTopup] = useState<Topup | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { showToast } = useToast();

  const load = async (force = false) => {
    setLoading(true); setError('');
    try { setData(await apiRequest<WalletResponse>('/api/wallet/me', { force })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không tải được ví demo.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!topup?.qr_payload) { setQrDataUrl(''); return; }
    void QRCode.toDataURL(topup.qr_payload, { width: 280, margin: 1, color: { dark: '#0F172A', light: '#FFFFFF' } }).then(setQrDataUrl).catch(() => setQrDataUrl(''));
  }, [topup?.qr_payload]);

  const wallet = data?.wallet || {};
  const transactions = data?.transactions || [];
  const balance = Number(wallet.balance_vnd || 0);
  const totalIn = useMemo(() => transactions.filter(row => Number(row.amount_vnd || 0) > 0).reduce((sum, row) => sum + Math.max(0, Number(row.amount_vnd || 0)), 0), [transactions]);

  const createTopup = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 10_000) { showToast('Số tiền nạp tối thiểu là 10.000đ.', 'warning'); return; }
    setSubmitting(true);
    try {
      const result = await apiRequest<Topup>('/api/wallet/topup/create', { method: 'POST', body: { amount_vnd: value }, cacheTtl: 0 });
      setTopup(result);
      showToast('Đã tạo mã QR nạp ví demo.', 'success');
    } catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không tạo được QR.', 'error'); }
    finally { setSubmitting(false); }
  };

  const confirmDemo = async () => {
    if (!topup?.txn_ref) return;
    setSubmitting(true);
    try {
      await apiRequest('/api/wallet/topup/demo-confirm', { method: 'POST', body: { txn_ref: topup.txn_ref }, cacheTtl: 0 });
      clearApiCache(); setTopup(null); await load(true);
      showToast('Đã cộng số dư ví demo. Không phát sinh tiền thật.', 'success');
    } catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không xác nhận được giao dịch.', 'error'); }
    finally { setSubmitting(false); }
  };

  return <div className="page-enter space-y-5">
    <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
      <div><Badge variant="gold">Ví Sandbox</Badge><h1 className="mt-2 text-2xl font-extrabold">Ví demo & QR</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Mô phỏng nạp tiền và quản lý số dư phục vụ bài trình diễn, không dùng tiền thật.</p></div>
      <Button variant="secondary" onClick={() => void load(true)}>Làm mới số dư</Button>
    </header>
    {error && <ErrorState message={error} onRetry={() => void load(true)} />}
    {loading && !data ? <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-32"/><Skeleton className="h-32"/><Skeleton className="h-32"/></div> : <>
      <section className="grid gap-4 md:grid-cols-3">
        <Card className="hero-surface p-5 md:col-span-2"><p className="text-xs uppercase tracking-wider text-[var(--text-sec)]">Số dư khả dụng</p><p className="mt-2 tabular text-4xl font-black text-[#F7931A]">{formatVND(balance)}</p><div className="mt-5 grid gap-3 sm:grid-cols-3"><div><span className="text-xs text-[var(--text-sec)]">Trạng thái</span><p className="mt-1"><Badge variant="success" pulse>Đang hoạt động</Badge></p></div><div><span className="text-xs text-[var(--text-sec)]">Loại ví</span><p className="mt-1 font-semibold">Sandbox VND</p></div><div><span className="text-xs text-[var(--text-sec)]">Tổng tiền vào gần đây</span><p className="mt-1 font-semibold tabular">{formatVND(totalIn)}</p></div></div></Card>
        <Card className="p-5"><SectionHeader title="An toàn mô phỏng"/><div className="space-y-3 text-sm text-[var(--text-sec)]"><p>✓ Không liên kết tài khoản ngân hàng thật</p><p>✓ Không lưu ký BTC hoặc USDT thật</p><p>✓ Có lịch sử giao dịch minh bạch</p></div></Card>
      </section>
      <section className="grid gap-4 lg:grid-cols-[.9fr_1.1fr]">
        <Card className="p-5"><SectionHeader title="Nạp tiền demo" sub="Chọn số tiền và tạo QR mô phỏng."/><Input label="Số tiền (VNĐ)" type="number" min={10000} max={50000000} value={amount} onChange={event => setAmount(event.target.value)} suffix="đ"/><div className="mt-3 flex flex-wrap gap-2">{presets.map(value => <button key={value} onClick={() => setAmount(String(value))} className={`quick-chip ${Number(amount) === value ? 'active' : ''}`}>{formatVND(value)}</button>)}</div><Button loading={submitting} onClick={createTopup} className="primary-glow mt-5 w-full">Tạo QR nạp demo</Button><div className="mt-4"><Disclaimer text={data?.disclaimer || 'Ví điện tử demo phục vụ học phần, không phát sinh tiền thật.'}/></div></Card>
        <Card className="p-5"><SectionHeader title="Mã QR thanh toán" sub={topup ? `Mã giao dịch ${topup.txn_ref}` : 'QR sẽ xuất hiện sau khi tạo yêu cầu.'}/>{topup ? <div className="grid gap-5 sm:grid-cols-[280px_1fr] sm:items-center"><div className="mx-auto flex h-[280px] w-[280px] items-center justify-center rounded-2xl bg-white p-3 shadow-xl">{qrDataUrl ? <img src={qrDataUrl} alt="QR nạp ví demo" className="h-full w-full"/> : <Skeleton className="h-full w-full"/>}</div><div className="space-y-3"><Badge variant="warning">Đang chờ xác nhận</Badge><p className="tabular text-2xl font-bold">{formatVND(topup.amount_vnd)}</p><p className="text-sm leading-relaxed text-[var(--text-sec)]">{topup.message}</p>{topup.payment_mode === 'demo' ? <Button loading={submitting} onClick={confirmDemo} className="w-full">Xác nhận thanh toán demo</Button> : <Button onClick={() => window.open(topup.payment_url, '_blank', 'noopener,noreferrer')} className="w-full">Mở VNPay Sandbox</Button>}<Button variant="secondary" onClick={() => setTopup(null)} className="w-full">Hủy QR</Button></div></div> : <div className="empty-visual min-h-72"><span className="text-5xl">▦</span><strong>Chưa có QR đang chờ</strong><p>Nhập số tiền ở bên trái để bắt đầu quy trình nạp ví demo.</p></div>}</Card>
      </section>
      <Card className="overflow-hidden"><div className="p-5 pb-0"><SectionHeader title="Giao dịch ví gần đây" sub="Dữ liệu thật từ tài khoản hiện tại."/></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Loại</th><th>Số tiền</th><th>Trạng thái</th><th>Thời gian</th></tr></thead><tbody>{transactions.length ? transactions.map((row, index) => <tr key={String(row.id || index)}><td>{String(row.type || row.transaction_type || 'Giao dịch ví')}</td><td className={`tabular font-semibold ${Number(row.amount_vnd || 0) >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{formatVND(row.amount_vnd)}</td><td><Badge variant={String(row.status).toLowerCase() === 'success' || String(row.status).toLowerCase() === 'completed' ? 'success' : 'warning'}>{String(row.status || 'completed')}</Badge></td><td>{formatDateTime(row.created_at)}</td></tr>) : <tr><td colSpan={4} className="py-10 text-center text-[var(--text-sec)]">Chưa có giao dịch ví.</td></tr>}</tbody></table></div></Card>
    </>}
  </div>;
}
