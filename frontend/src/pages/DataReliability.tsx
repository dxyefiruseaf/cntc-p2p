import { useEffect, useState, type CSSProperties } from 'react';
import { apiRequest } from '../lib/api';
import { formatDateTime, formatNumber } from '../lib/format';
import { Badge, Button, Card, DataBadge, Disclaimer, SectionHeader, Skeleton, StatusDot } from '../components/ui';
import { useToast } from '../context/ToastContext';

type Check = { name?: string; source?: string; latest_timestamp?: string; age_hours?: number; fresh?: boolean; threshold_hours?: number; description?: string };
type Reliability = { level?: string; message?: string; checks?: Check[]; sources?: Record<string,string>; automation?: string; sample_count?: Record<string,unknown>; status?: Record<string,unknown> };

export default function DataReliability() {
  const [data, setData] = useState<Reliability | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { showToast } = useToast();
  const load = async (force = false) => { setLoading(true); setError(''); try { setData(await apiRequest<Reliability>('/api/data-reliability', { force })); } catch (reason) { const message = reason instanceof Error ? reason.message : 'Không tải được độ tin cậy.'; setError(message); showToast(message, 'error'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const level = String(data?.level || 'UNKNOWN').toUpperCase();
  const score = level === 'GOOD' ? 95 : level === 'WARNING' ? 68 : level === 'STALE' ? 35 : 0;
  return <div className="page-enter space-y-5">
    <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><Badge variant="info">Data Trust Center</Badge><h1 className="mt-2 text-2xl font-extrabold">Độ tin cậy dữ liệu</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Kiểm tra độ mới, nguồn và phạm vi dữ liệu trước khi đọc tín hiệu.</p></div><Button variant="secondary" loading={loading} onClick={() => void load(true)}>Kiểm tra lại</Button></header>
    {loading && !data ? <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-40"/><Skeleton className="h-40"/><Skeleton className="h-40"/></div> : <>
      <section className="grid gap-4 md:grid-cols-[.75fr_1.25fr]"><Card className="hero-surface p-6"><div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-wider text-[var(--text-sec)]">Reliability Score</p><p className="mt-2 tabular text-5xl font-black" style={{ color: score >= 80 ? '#22C55E' : score >= 50 ? '#F59E0B' : '#EF4444' }}>{score}/100</p></div><div className="reliability-ring" style={{ '--score': score } as CSSProperties}><span>{level}</span></div></div><p className="mt-5 text-sm leading-relaxed text-[var(--text-sec)]">{data?.message || error}</p></Card><Card className="p-5"><SectionHeader title="Phương pháp đánh giá" sub="Dựa trên timestamp mới nhất và ngưỡng cho từng nguồn."/><div className="grid gap-3 sm:grid-cols-3"><div className="metric-box"><span>Pipeline</span><strong>API → Supabase</strong></div><div className="metric-box"><span>Tần suất đồng bộ</span><strong>Mỗi giờ</strong></div><div className="metric-box"><span>Kiểm tra tự động</span><strong>Market + P2P</strong></div></div><div className="mt-4"><Disclaimer text={data?.automation || 'GitHub Actions chạy định kỳ để đồng bộ dữ liệu vào Supabase.'} tone="info"/></div></Card></section>
      <section className="grid gap-4 md:grid-cols-2">{(data?.checks || []).map((check, index) => <Card key={`${check.name}-${index}`} className="card-reveal p-5" style={{ animationDelay: `${index * 70}ms` }}><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><StatusDot status={check.fresh ? 'online' : 'warning'}/><h2 className="font-semibold">{check.name}</h2></div><p className="mt-2 text-sm leading-relaxed text-[var(--text-sec)]">{check.description}</p></div><Badge variant={check.fresh ? 'success' : 'warning'}>{check.fresh ? 'Fresh' : 'Cần kiểm tra'}</Badge></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="metric-box"><span>Nguồn</span><strong>{check.source || '—'}</strong></div><div className="metric-box"><span>Tuổi dữ liệu</span><strong>{check.age_hours == null ? '—' : `${formatNumber(check.age_hours, 2)} giờ`}</strong></div><div className="metric-box"><span>Ngưỡng</span><strong>{check.threshold_hours || '—'} giờ</strong></div><div className="metric-box"><span>Cập nhật gần nhất</span><strong className="text-sm">{formatDateTime(check.latest_timestamp)}</strong></div></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"><div className={`h-full rounded-full ${check.fresh ? 'bg-[#22C55E]' : 'bg-[#F59E0B]'}`} style={{ width: `${Math.max(8, Math.min(100, check.age_hours == null ? 10 : 100 - (check.age_hours / Math.max(1, check.threshold_hours || 2)) * 100))}%` }}/></div></Card>)}</section>
      <Card className="p-5"><SectionHeader title="Minh bạch nguồn dữ liệu"/><div className="grid gap-3 md:grid-cols-3">{Object.entries(data?.sources || {}).map(([key, value]) => <div key={key} className="metric-box"><div className="mb-2"><DataBadge source="API" age="đã công bố"/></div><span className="uppercase">{key}</span><strong className="mt-1 text-sm leading-relaxed">{value}</strong></div>)}</div></Card>
    </>}
    <Disclaimer text="Dữ liệu có thể chậm hoặc gián đoạn do API bên thứ ba, mạng và lịch đồng bộ. Luôn kiểm tra timestamp trước khi diễn giải."/>
  </div>;
}
