import { useEffect, useState } from 'react';
import { apiRequest, clearApiCache } from '../lib/api';
import { formatDateTime, formatVND } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Modal, SectionHeader, Skeleton } from '../components/ui';
import { useToast } from '../context/ToastContext';

type Subscription = { active?: boolean; plan_id?: string; plan_name?: string; expires_at?: string; features?: string[]; message?: string; plan?: { amount_vnd?: number; days?: number } };
const freeFeatures = ['Dashboard tổng quan', 'Biểu đồ kỹ thuật cơ bản', 'P2P Spread', 'Ví và giao dịch demo', 'AI Advisor cơ bản'];
const premiumFeatures = ['Toàn bộ tính năng Free', 'Phân tích kỹ thuật nâng cao', 'Cảnh báo nâng cao', 'Ước tính thuế và thực nhận', 'AI Advisor', 'Lịch sử dữ liệu sâu hơn', 'Xuất báo cáo phân tích demo'];

export default function Premium() {
  const [data, setData] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { showToast } = useToast();
  const load = async (force = false) => { setLoading(true); try { setData(await apiRequest<Subscription>('/api/payment/subscription', { force })); } catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không tải được gói.', 'error'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);

  const buy = async (planId = 'premium_monthly') => {
    setBusy(true);
    try {
      const result = await apiRequest<{ payment_url?: string }>('/api/payment/create', { method: 'POST', body: { plan_id: planId }, cacheTtl: 0 });
      if (!result.payment_url) throw new Error('Backend không trả về liên kết thanh toán.');
      window.location.assign(result.payment_url);
    } catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không tạo được thanh toán Sandbox.', 'error'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { await apiRequest('/api/payment/cancel-subscription', { method: 'POST', cacheTtl: 0 }); clearApiCache(); setConfirmCancel(false); await load(true); showToast('Đã hủy Premium Sandbox.', 'success'); }
    catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không hủy được gói.', 'error'); }
    finally { setBusy(false); }
  };

  return <div className="page-enter space-y-5">
    <header className="text-center"><Badge variant="gold">Premium Sandbox</Badge><h1 className="mt-3 text-3xl font-black">Mở khóa trải nghiệm FinTech nâng cao</h1><p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-sec)]">Gói Premium phục vụ mô phỏng học thuật. Thanh toán dùng môi trường VNPay Sandbox và không phải dịch vụ đầu tư thực tế.</p></header>
    {loading ? <div className="grid gap-4 md:grid-cols-2"><Skeleton className="h-[430px]"/><Skeleton className="h-[430px]"/></div> : <>
      <section className="grid gap-4 md:grid-cols-2">
        <Card className={`p-6 ${!data?.active ? 'border-[#3B82F6]/35' : ''}`}><Badge variant="info">Free</Badge><h2 className="mt-4 text-2xl font-bold">0đ</h2><p className="text-sm text-[var(--text-sec)]">Không giới hạn thời gian</p><ul className="mt-6 space-y-3">{freeFeatures.map(item => <li key={item} className="flex gap-2 text-sm"><span className="text-[#22C55E]">✓</span>{item}</li>)}</ul><Button variant="secondary" className="mt-8 w-full" disabled={!data?.active}>{data?.active ? 'Chuyển về Free bằng nút hủy gói' : 'Gói hiện tại'}</Button></Card>
        <Card className={`premium-card relative overflow-hidden p-6 ${data?.active ? 'border-[#F7931A]/45' : ''}`}><div className="absolute right-0 top-0 rounded-bl-2xl bg-[#F7931A] px-4 py-2 text-xs font-black text-black">PHỔ BIẾN</div><Badge variant="gold" pulse>Premium</Badge><div className="mt-4 flex items-end gap-2"><h2 className="tabular text-4xl font-black text-[#F7931A]">49.000đ</h2><span className="pb-1 text-sm text-[var(--text-sec)]">/tháng</span></div><p className="mt-2 text-sm text-[var(--text-sec)]">Dùng đầy đủ công cụ phân tích, cảnh báo và AI.</p><ul className="mt-6 space-y-3">{premiumFeatures.map(item => <li key={item} className="flex gap-2 text-sm"><span className="text-[#F7931A]">✦</span>{item}</li>)}</ul>{data?.active ? <div className="mt-7 space-y-3"><div className="rounded-xl border border-[#22C55E]/25 bg-[#22C55E]/10 p-3"><p className="font-semibold text-[#22C55E]">Premium đang hoạt động</p><p className="mt-1 text-xs text-[var(--text-sec)]">Hết hạn: {formatDateTime(data.expires_at)}</p></div><Button variant="danger" className="w-full" onClick={() => setConfirmCancel(true)}>Hủy Premium</Button></div> : <Button loading={busy} className="primary-glow mt-8 w-full" onClick={() => void buy()}>Thanh toán Sandbox {formatVND(49000)}</Button>}</Card>
      </section>
      <Card className="p-5"><SectionHeader title="Trạng thái đăng ký" sub="Đồng bộ trực tiếp từ backend và Supabase."/><div className="grid gap-3 sm:grid-cols-4"><div className="metric-box"><span>Gói hiện tại</span><strong>{data?.plan_name || 'Free'}</strong></div><div className="metric-box"><span>Trạng thái</span><strong className={data?.active ? 'text-[#22C55E]' : 'text-[var(--text-main)]'}>{data?.active ? 'Đang hoạt động' : 'Free'}</strong></div><div className="metric-box"><span>Chu kỳ</span><strong>{data?.active ? `${data.plan?.days || 30} ngày` : 'Không áp dụng'}</strong></div><div className="metric-box"><span>Giá Sandbox</span><strong>{formatVND(data?.plan?.amount_vnd || 0)}</strong></div></div></Card>
    </>}
    <Disclaimer text="Premium Sandbox là tính năng mô phỏng cho học tập và trình diễn. Không tạo quyền sở hữu tài sản số, lợi nhuận hoặc dịch vụ tài chính thật." />
    <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Hủy Premium Sandbox" footer={<><Button variant="secondary" onClick={() => setConfirmCancel(false)}>Giữ gói</Button><Button variant="danger" loading={busy} onClick={() => void cancel()}>Xác nhận hủy</Button></>}><p className="text-sm leading-relaxed text-[var(--text-sec)]">Tài khoản sẽ trở lại gói Free ngay lập tức. Dữ liệu sandbox đã tạo vẫn được giữ lại.</p></Modal>
  </div>;
}
