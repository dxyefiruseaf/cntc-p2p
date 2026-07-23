import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Input, Skeleton } from '../components/ui';
import { useToast } from '../context/ToastContext';

type NewsItem = { title?: string; link?: string; source?: string; published_at?: string; summary?: string; tags?: string[]; image?: string };
type NewsResponse = { count?: number; data?: NewsItem[]; source?: string; disclaimer?: string };

export default function News() {
  const [data, setData] = useState<NewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('all');
  const [featured, setFeatured] = useState(0);
  const { showToast } = useToast();
  const load = async (force = false) => { setLoading(true); try { const suffix = force ? '&force_refresh=true' : ''; setData(await apiRequest<NewsResponse>(`/api/news/latest?limit=30${suffix}`, { force })); } catch (reason) { showToast(reason instanceof Error ? reason.message : 'Không tải được tin tức.', 'error'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const items = data?.data || [];
  const tags = useMemo(() => ['all', ...Array.from(new Set(items.flatMap(item => item.tags || []).filter(Boolean)))], [items]);
  const filtered = useMemo(() => items.filter(item => {
    const haystack = `${item.title || ''} ${item.summary || ''} ${item.source || ''}`.toLowerCase();
    return (!search || haystack.includes(search.toLowerCase())) && (tag === 'all' || item.tags?.includes(tag));
  }), [items, search, tag]);
  const hero = filtered[featured % Math.max(1, filtered.length)] || items[0];

  return <div className="page-enter space-y-5">
    <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><Badge variant="gold">BTC News Spotlight</Badge><h1 className="mt-2 text-2xl font-extrabold">Tin tức thị trường nổi bật</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Ngữ cảnh thị trường từ RSS, không phải tín hiệu giao dịch độc lập.</p></div><Button variant="secondary" loading={loading} onClick={() => void load(true)}>Làm mới nguồn tin</Button></header>
    <Card className="p-4"><div className="grid gap-3 md:grid-cols-[1fr_180px]"><Input placeholder="Tìm tiêu đề, nội dung hoặc nguồn..." prefix="⌕" value={search} onChange={event => { setSearch(event.target.value); setFeatured(0); }}/><div className="flex items-center justify-end gap-2 overflow-x-auto">{tags.slice(0, 6).map(value => <button key={value} className={`quick-chip shrink-0 ${tag === value ? 'active' : ''}`} onClick={() => { setTag(value); setFeatured(0); }}>{value === 'all' ? 'Tất cả' : value}</button>)}</div></div></Card>
    {loading && !data ? <div className="grid gap-4 lg:grid-cols-[1.4fr_.6fr]"><Skeleton className="h-[420px]"/><Skeleton className="h-[420px]"/></div> : hero ? <section className="news-spotlight-grid">
      <article className="news-hero-card"><div className="news-hero-overlay"/><div className="relative z-10 max-w-3xl"><div className="flex flex-wrap gap-2"><Badge variant="gold">{hero.source || 'Nguồn tin'}</Badge><Badge variant="neutral">{formatDateTime(hero.published_at)}</Badge></div><h2 className="mt-5 text-3xl font-black leading-tight md:text-5xl">{hero.title}</h2><p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300">{hero.summary || 'Mở bài viết để xem đầy đủ nội dung từ nguồn.'}</p><div className="mt-6 flex gap-3"><Button onClick={() => { if (hero.link && hero.link !== '#') window.open(hero.link, '_blank', 'noopener,noreferrer'); }}>Đọc bài gốc</Button><Button variant="secondary" onClick={() => setFeatured(index => (index + 1) % Math.max(1, filtered.length))}>Tin tiếp theo →</Button></div></div><span className="news-watermark">₿</span></article>
      <aside className="space-y-3">{filtered.slice(0, 6).map((item, index) => <button key={`${item.title}-${index}`} onClick={() => setFeatured(index)} className={`news-side-card ${hero === item ? 'active' : ''}`}><span className="news-rank">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1 text-left"><strong className="line-clamp-2 text-sm">{item.title}</strong><small className="mt-1 block truncate text-[var(--text-sec)]">{item.source} · {formatDateTime(item.published_at)}</small></span></button>)}</aside>
    </section> : <div className="empty-visual min-h-80"><span className="text-5xl">📰</span><strong>Không có tin phù hợp</strong><p>Hãy xóa bộ lọc hoặc thử làm mới dữ liệu.</p></div>}
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{filtered.slice(6).map((item, index) => <Card key={`${item.title}-${index}`} className="card-reveal p-4" style={{ animationDelay: `${index * 35}ms` }}><div className="flex gap-2"><Badge variant="neutral">{item.source || 'RSS'}</Badge>{item.tags?.[0] && <Badge variant="info">{item.tags[0]}</Badge>}</div><h3 className="mt-3 line-clamp-2 font-semibold">{item.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-relaxed text-[var(--text-sec)]">{item.summary}</p><div className="mt-4 flex items-center justify-between"><span className="text-xs text-[var(--text-dim)]">{formatDateTime(item.published_at)}</span><button className="text-xs font-semibold text-[#F7931A]" onClick={() => item.link && window.open(item.link, '_blank', 'noopener,noreferrer')}>Mở nguồn ↗</button></div></Card>)}</section>
    <Disclaimer text={data?.disclaimer || 'Tin tức chỉ dùng để bổ sung ngữ cảnh học tập, không phải tín hiệu giao dịch độc lập.'}/>
  </div>;
}
