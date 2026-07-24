import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import { formatDateTime, formatNumber, formatVND } from '../lib/format';
import { Badge, Button, Card, Input, SectionHeader, Select, Skeleton } from '../components/ui';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useToast } from '../context/ToastContext';
import AssetPortfolioPanel from '../components/AssetPortfolioPanel';

type Tab = 'trades' | 'wallet' | 'ai';
type PageData = { count?: number; data?: Array<Record<string, unknown>>; next_cursor?: string; has_next?: boolean; wallet?: Record<string, unknown>; portfolio?: Record<string, unknown>; valuation?: Record<string, unknown> };

export default function History() {
  const [tab, setTab] = useState<Tab>('trades');
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [side, setSide] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sort, setSort] = useState('desc');
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const debounced = useDebouncedValue(search, 350);
  const { showToast } = useToast();

  const currentCursor = cursorStack[pageIndex] || null;
  const path = useMemo(() => {
    if (tab === 'wallet') return `/api/wallet/transactions?limit=20${currentCursor ? `&before=${encodeURIComponent(currentCursor)}` : ''}`;
    if (tab === 'ai') return `/api/ai/history?limit=20${currentCursor ? `&before=${encodeURIComponent(currentCursor)}` : ''}`;
    const params = new URLSearchParams({ limit: '20', search: debounced, sort_order: sort });
    if (currentCursor && sort === 'desc') params.set('before', currentCursor);
    if (side !== 'all') params.set('side', side);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    return `/api/demo-trades?${params}`;
  }, [tab, currentCursor, debounced, sort, side, dateFrom, dateTo]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    apiRequest<PageData>(path, { force: true, cacheTtl: 0, signal: controller.signal }).then(setData).catch(reason => {
      if (!controller.signal.aborted) showToast(reason instanceof Error ? reason.message : 'Không tải được lịch sử.', 'error');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path]);

  const changeTab = (value: Tab) => { setTab(value); setData(null); setCursorStack([null]); setPageIndex(0); setSearch(''); };
  const next = () => {
    if (!data?.next_cursor) return;
    setCursorStack(current => [...current.slice(0, pageIndex + 1), data.next_cursor || null]);
    setPageIndex(index => index + 1);
  };
  const previous = () => setPageIndex(index => Math.max(0, index - 1));
  const rows = data?.data || [];

  return <div className="page-enter space-y-5">
    <header><Badge variant="info">Activity Center</Badge><h1 className="mt-2 text-2xl font-extrabold">Lịch sử hoạt động</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Dữ liệu được phân trang 20 dòng, không tải toàn bộ lịch sử cùng lúc.</p></header>
    <Card className="p-4"><div className="flex flex-wrap gap-2">{([['trades','Giao dịch BTC'],['wallet','Ví demo'],['ai','AI Advisor']] as [Tab,string][]).map(([value,label]) => <button key={value} className={`segment-btn px-4 ${tab === value ? 'active' : ''}`} onClick={() => changeTab(value)}>{label}</button>)}</div></Card>
    {tab === 'trades' && <Card className="p-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5"><Input placeholder="Tìm số tiền, giá, loại lệnh..." prefix="⌕" value={search} onChange={event => { setSearch(event.target.value); setPageIndex(0); setCursorStack([null]); }}/><Select value={side} onChange={value => { setSide(value); setPageIndex(0); setCursorStack([null]); }} options={[{value:'all',label:'Tất cả BUY/SELL'},{value:'BUY',label:'Chỉ BUY'},{value:'SELL',label:'Chỉ SELL'}]}/><Input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)}/><Input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)}/><Select value={sort} onChange={value => { setSort(value); setPageIndex(0); setCursorStack([null]); }} options={[{value:'desc',label:'Mới nhất trước'},{value:'asc',label:'Cũ nhất trước'}]}/></div></Card>}
    {(tab === 'trades' || tab === 'wallet') && (loading && !data ? <Skeleton className="h-64"/> : <AssetPortfolioPanel title={tab === 'trades' ? 'Tài sản hiện tại sau các lệnh BTC' : 'Tổng quan tài sản trong ví'} subtitle="Khối tài sản luôn tách rõ tiền mặt VNĐ, lượng BTC đang giữ và tổng giá trị ước tính." wallet={data?.wallet} portfolio={data?.portfolio} valuation={data?.valuation}/>)}
    <Card className="overflow-hidden"><div className="p-5 pb-0"><SectionHeader title={tab === 'trades' ? 'Giao dịch demo' : tab === 'wallet' ? 'Biến động ví' : 'Câu hỏi AI'} sub={`Trang ${pageIndex + 1} · ${rows.length} bản ghi`}/></div>{loading ? <div className="space-y-2 p-5"><Skeleton className="h-12"/><Skeleton className="h-12"/><Skeleton className="h-12"/></div> : <div className="table-scroll"><table className="data-table"><thead>{tab === 'trades' ? <tr><th>Chiều</th><th>Số tiền</th><th>Khối lượng BTC</th><th>Giá áp dụng</th><th>Thời gian</th></tr> : tab === 'wallet' ? <tr><th>Loại</th><th>Số tiền</th><th>Trạng thái</th><th>Mã giao dịch</th><th>Thời gian</th></tr> : <tr><th>Câu hỏi</th><th>Nhận định</th><th>Độ tin cậy</th><th>Thời gian</th></tr>}</thead><tbody>{rows.length ? rows.map((row,index) => tab === 'trades' ? <tr key={String(row.id || index)}><td><Badge variant={String(row.side).toUpperCase()==='BUY'?'success':'danger'}>{String(row.side || '—').toUpperCase()}</Badge></td><td className="tabular font-semibold">{formatVND(row.amount_vnd)}</td><td className="tabular">{formatNumber(row.amount_usdt,8)}</td><td className="tabular">{formatVND(row.applied_price)}</td><td>{formatDateTime(row.created_at)}</td></tr> : tab === 'wallet' ? <tr key={String(row.id || index)}><td>{String(row.type || row.transaction_type || 'Ví')}</td><td className="tabular font-semibold">{formatVND(row.amount_vnd)}</td><td><Badge variant={String(row.status).toLowerCase()==='success'?'success':'warning'}>{String(row.status || 'completed')}</Badge></td><td className="font-mono text-xs">{String(row.reference || row.vnp_txn_ref || row.id || '—')}</td><td>{formatDateTime(row.created_at)}</td></tr> : <tr key={String(row.id || index)}><td className="max-w-md"><p className="line-clamp-2">{String(row.question || '—')}</p></td><td><Badge variant={String(row.verdict).toUpperCase()==='BUY'?'success':String(row.verdict).toUpperCase()==='SELL'?'danger':'neutral'}>{String(row.verdict || 'NEUTRAL')}</Badge></td><td>{row.confidence == null ? '—' : `${formatNumber(Number(row.confidence)*100,0)}%`}</td><td>{formatDateTime(row.created_at)}</td></tr>) : <tr><td colSpan={5} className="py-12 text-center text-[var(--text-sec)]">Chưa có dữ liệu phù hợp.</td></tr>}</tbody></table></div>}<div className="flex items-center justify-between border-t border-[var(--border-soft)] p-4"><Button size="sm" variant="secondary" disabled={pageIndex===0 || loading} onClick={previous}>← Trang trước</Button><span className="text-xs text-[var(--text-sec)]">Trang {pageIndex+1}</span><Button size="sm" variant="secondary" disabled={!data?.has_next || loading} onClick={next}>Trang tiếp →</Button></div></Card>
  </div>;
}
