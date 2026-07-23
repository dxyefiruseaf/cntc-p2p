import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest, clearApiCache } from '../lib/api';
import { formatDateTime, formatVND } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Skeleton } from '../components/ui';

type Payment = Record<string, unknown>;
export default function PaymentResult() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [data,setData] = useState<Payment|null>(null);
  const [loading,setLoading] = useState(true);
  const txnRef = params.get('txn_ref') || '';
  const callbackStatus = params.get('status') || '';
  useEffect(() => { if (!txnRef) { setLoading(false); return; } apiRequest<Payment>(`/api/payment/status?txn_ref=${encodeURIComponent(txnRef)}`, { force:true, cacheTtl:0 }).then(value => { setData(value); clearApiCache(); }).finally(() => setLoading(false)); }, [txnRef]);
  const status = String(data?.status || callbackStatus || 'pending').toLowerCase();
  const ok = status === 'success' || status === 'completed';
  return <div className="page-enter mx-auto max-w-2xl py-10"><Card className="p-7 text-center">{loading ? <Skeleton className="mx-auto h-64 max-w-md"/> : <><div className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full text-4xl ${ok?'bg-[#22C55E]/15 text-[#22C55E]':'bg-[#F59E0B]/15 text-[#F59E0B]'}`}>{ok?'✓':'⏳'}</div><Badge variant={ok?'success':'warning'}>{ok?'Thanh toán thành công':'Trạng thái thanh toán'}</Badge><h1 className="mt-4 text-2xl font-extrabold">{ok?'Premium Sandbox đã được kích hoạt':'Đang xử lý hoặc chưa thành công'}</h1><p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-[var(--text-sec)]">Mã giao dịch: <span className="font-mono">{txnRef || 'không có'}</span></p><div className="mx-auto mt-6 grid max-w-lg gap-3 sm:grid-cols-3"><div className="metric-box"><span>Số tiền</span><strong>{formatVND(data?.amount_vnd)}</strong></div><div className="metric-box"><span>Trạng thái</span><strong>{status}</strong></div><div className="metric-box"><span>Thời gian</span><strong className="text-xs">{formatDateTime(data?.paid_at || data?.created_at)}</strong></div></div><div className="mt-7 flex flex-wrap justify-center gap-3"><Button onClick={() => navigate('/premium')}>Xem gói Premium</Button><Button variant="secondary" onClick={() => navigate('/dashboard')}>Về Dashboard</Button></div></>}<div className="mt-6"><Disclaimer text="Đây là quy trình thanh toán Sandbox phục vụ trình diễn. Không phải giao dịch đầu tư hoặc mua bán tài sản số thật."/></div></Card></div>;
}
