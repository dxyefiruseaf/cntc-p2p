import { useEffect, useMemo, useState } from 'react';
import { apiRequest, clearApiCache } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Input, Modal, SectionHeader, Select, Skeleton, Toggle } from '../components/ui';
import { useToast } from '../context/ToastContext';

type AlertRule = { id?: string; metric?: string; operator?: string; threshold?: number; active?: boolean; created_at?: string; last_triggered_at?: string; email_status?: string };
type AlertsResponse = { count?: number; data?: AlertRule[] };
const metricOptions = [
  { value: 'price', label: 'Giá BTC/USDT' }, { value: 'rsi', label: 'RSI 14' },
  { value: 'p2p_spread_buy', label: 'P2P BUY Spread' }, { value: 'p2p_spread_sell', label: 'P2P SELL Spread' },
];
const metricLabel = Object.fromEntries(metricOptions.map(item => [item.value, item.label]));

export default function Alerts() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [metric, setMetric] = useState('price');
  const [operator, setOperator] = useState('gt');
  const [threshold, setThreshold] = useState('70000');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { showToast } = useToast();
  const load = async (force = false) => { setLoading(true); try { setData(await apiRequest<AlertsResponse>('/api/alerts', { force })); } catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không tải được cảnh báo.', 'error'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const rows = data?.data || [];
  const filtered = useMemo(() => rows.filter(row => {
    const text = `${metricLabel[String(row.metric)] || row.metric} ${row.threshold}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase())) && (status === 'all' || (status === 'active' ? row.active : !row.active));
  }), [rows, search, status]);
  const activeCount = rows.filter(row => row.active).length;

  const create = async () => {
    const value = Number(threshold);
    if (!Number.isFinite(value)) { showToast('Ngưỡng cảnh báo không hợp lệ.', 'warning'); return; }
    setBusy(true);
    try { await apiRequest('/api/alerts', { method: 'POST', body: { metric, operator, threshold: value, active: true }, cacheTtl: 0 }); clearApiCache(); await load(true); showToast('Đã tạo cảnh báo Email.', 'success'); }
    catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không tạo được cảnh báo.', 'error'); }
    finally { setBusy(false); }
  };
  const toggle = async (row: AlertRule) => {
    if (!row.id) return;
    try { await apiRequest(`/api/alerts/${row.id}`, { method: 'PATCH', body: { active: !row.active }, cacheTtl: 0 }); clearApiCache(); await load(true); }
    catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không cập nhật được cảnh báo.', 'error'); }
  };
  const remove = async () => {
    if (!deleteId) return;
    setBusy(true);
    try { await apiRequest(`/api/alerts/${deleteId}`, { method: 'DELETE', cacheTtl: 0 }); clearApiCache(); setDeleteId(null); await load(true); showToast('Đã xóa cảnh báo.', 'success'); }
    catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không xóa được cảnh báo.', 'error'); }
    finally { setBusy(false); }
  };

  return <div className="page-enter space-y-5">
    <header><Badge variant="info">Email Automation</Badge><h1 className="mt-2 text-2xl font-extrabold">Cảnh báo Email</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Theo dõi thị trường theo rule và gửi thông báo khi điều kiện được thỏa mãn.</p></header>
    <section className="alert-process-grid"><div><span>1</span><strong>Theo dõi dữ liệu</strong><p>Giá BTC, RSI và P2P Spread.</p></div><i>→</i><div><span>2</span><strong>Kiểm tra điều kiện</strong><p>So sánh với ngưỡng đã đặt.</p></div><i>→</i><div><span>3</span><strong>Gửi Email</strong><p>Thông báo khi rule được kích hoạt.</p></div></section>
    <section className="grid gap-4 lg:grid-cols-[.8fr_1.2fr]">
      <Card className="p-5"><SectionHeader title="Tạo rule mới" sub="Mỗi tài khoản được bật tối đa 5 cảnh báo."/><div className="space-y-4"><Select label="Dữ liệu theo dõi" value={metric} onChange={setMetric} options={metricOptions}/><Select label="Điều kiện" value={operator} onChange={setOperator} options={[{ value: 'gt', label: 'Lớn hơn (>)' }, { value: 'lt', label: 'Nhỏ hơn (<)' }]}/><Input label="Ngưỡng" type="number" value={threshold} onChange={event => setThreshold(event.target.value)} suffix={metric === 'price' ? 'USDT' : metric === 'rsi' ? 'điểm' : '%'}/><div className="rule-preview"><span className="status-pulse h-2 w-2 rounded-full bg-[#22C55E]"/><p>Khi <strong>{metricLabel[metric]}</strong> {operator === 'gt' ? 'lớn hơn' : 'nhỏ hơn'} <strong>{formatNumber(threshold, metric === 'price' ? 0 : 2)}</strong>, hệ thống sẽ gửi Email.</p></div><Button loading={busy} onClick={create} className="primary-glow w-full">Tạo cảnh báo</Button></div></Card>
      <div className="space-y-4"><section className="grid gap-3 sm:grid-cols-3"><Card className="p-4"><span className="text-xs text-[var(--text-sec)]">Tổng rule</span><strong className="mt-1 block text-2xl">{rows.length}</strong></Card><Card className="p-4"><span className="text-xs text-[var(--text-sec)]">Đang theo dõi</span><strong className="mt-1 block text-2xl text-[#22C55E]">{activeCount}</strong></Card><Card className="p-4"><span className="text-xs text-[var(--text-sec)]">Giới hạn còn lại</span><strong className="mt-1 block text-2xl text-[#F7931A]">{Math.max(0, 5 - activeCount)}</strong></Card></section>
        <Card className="p-4"><div className="grid gap-3 sm:grid-cols-[1fr_180px]"><Input placeholder="Tìm theo loại hoặc ngưỡng..." value={search} onChange={event => setSearch(event.target.value)} prefix="⌕"/><Select value={status} onChange={setStatus} options={[{ value: 'all', label: 'Tất cả trạng thái' }, { value: 'active', label: 'Đang theo dõi' }, { value: 'inactive', label: 'Đã tắt' }]}/></div></Card>
        {loading ? <div className="space-y-3"><Skeleton className="h-28"/><Skeleton className="h-28"/></div> : filtered.length ? <div className="space-y-3">{filtered.map((row, index) => <Card key={String(row.id || index)} className="card-reveal p-4" style={{ animationDelay: `${index * 35}ms` }}><div className="flex flex-col gap-4 sm:flex-row sm:items-center"><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${row.active ? 'bg-[#22C55E]/12 text-[#22C55E]' : 'bg-[var(--surface-2)] text-[var(--text-sec)]'}`}>🔔</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong>{metricLabel[String(row.metric)] || row.metric}</strong><Badge variant={row.active ? 'success' : 'neutral'} pulse={Boolean(row.active)}>{row.active ? 'Đang theo dõi' : 'Đã tắt'}</Badge></div><p className="mt-1 text-sm text-[var(--text-sec)]">Kích hoạt khi {row.operator === 'gt' ? 'lớn hơn' : 'nhỏ hơn'} <span className="tabular font-semibold text-[var(--text-main)]">{formatNumber(row.threshold, row.metric === 'price' ? 0 : 2)}</span></p><p className="mt-1 text-xs text-[var(--text-dim)]">Tạo lúc {formatDateTime(row.created_at)} · Lần gửi gần nhất {formatDateTime(row.last_triggered_at)}</p></div><div className="flex items-center gap-3"><Toggle checked={Boolean(row.active)} onChange={() => void toggle(row)} label="Bật tắt cảnh báo"/><Button variant="danger" size="sm" onClick={() => setDeleteId(String(row.id))}>Xóa</Button></div></div></Card>)}</div> : <div className="empty-visual min-h-64"><span className="text-5xl">🔔</span><strong>Không tìm thấy cảnh báo</strong><p>Tạo rule mới hoặc thay đổi bộ lọc để xem dữ liệu.</p></div>}
      </div>
    </section>
    <Disclaimer text="Cảnh báo rule-based chỉ hỗ trợ học tập và tham khảo. Email có thể chậm do giới hạn nhà cung cấp; không dùng làm lệnh giao dịch tự động."/>
    <Modal open={Boolean(deleteId)} onClose={() => setDeleteId(null)} title="Xóa cảnh báo" footer={<><Button variant="secondary" onClick={() => setDeleteId(null)}>Hủy</Button><Button variant="danger" loading={busy} onClick={() => void remove()}>Xóa rule</Button></>}><p className="text-sm text-[var(--text-sec)]">Cảnh báo này sẽ bị xóa vĩnh viễn và không còn gửi Email.</p></Modal>
  </div>;
}
