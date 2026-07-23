import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { asNumber, formatDateTime, formatNumber, formatPercent, formatUSD, formatVND, relativeTime } from '../lib/format';
import { useMarket } from '../context/MarketContext';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { Badge, Button, Card, DataBadge, Disclaimer, KPICard, RiskMeter, SectionHeader, Skeleton } from '../components/ui';
import { ErrorState } from '../components/Feedback';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';

type NewsItem = { title?: string; source?: string; published_at?: string; summary?: string; link?: string; image?: string; tags?: string[] };

const quickLinks = [
  ['/chart', '📈', 'Biểu đồ kỹ thuật', 'Terminal giao dịch đầy đủ'],
  ['/decision', '🧭', 'Decision Hub', 'Hỗ trợ ra quyết định'],
  ['/exchange', '⚡', 'Giao dịch demo', 'Mô phỏng mua/bán BTC'],
  ['/p2p', '↔', 'So sánh P2P', 'Giá P2P và thị trường'],
  ['/tax', '🧮', 'Ước tính thuế', 'Mô phỏng nghĩa vụ thuế'],
  ['/alerts', '🔔', 'Cảnh báo Email', 'Theo dõi giá và chỉ báo'],
] as const;

export default function Dashboard() {
  const navigate = useNavigate();
  const market = useMarket();
  const news = useAsyncResource(
    signal => apiRequest<{ data?: NewsItem[] }>('/api/news/latest?limit=6', { signal, timeout: 20_000 }),
    [],
  );

  const latest = market.latest;
  const rows = market.rows.slice(-24);
  const current = asNumber(latest.close);
  const opening = asNumber(rows[0]?.open || latest.open || current);
  const change = opening ? ((current - opening) / opening) * 100 : 0;
  const high = rows.length ? Math.max(...rows.map(row => asNumber(row.high || row.close))) : asNumber(latest.high);
  const lowCandidates = rows.map(row => asNumber(row.low || row.close)).filter(value => value > 0);
  const low = lowCandidates.length ? Math.min(...lowCandidates) : asNumber(latest.low);
  const volume = rows.reduce((sum, row) => sum + asNumber(row.volume), 0);
  const risk = asNumber(market.data?.risk?.score);
  const riskLabel = String(market.data?.risk?.label_vi || market.data?.risk?.level || (risk < 30 ? 'Thấp' : risk < 60 ? 'Trung bình' : 'Cao'));
  const verdict = String(market.data?.summary?.overall?.verdict || 'NEUTRAL').toUpperCase();
  const buy = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'BUY');
  const sell = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'SELL');
  const spread = buy?.p2p_price && sell?.p2p_price ? ((buy.p2p_price - sell.p2p_price) / sell.p2p_price) * 100 : 0;
  const isUp = change >= 0;

  const signals = useMemo(() => {
    const rsi = asNumber(latest.rsi_14);
    const macd = asNumber(latest.macd_hist);
    const ema20 = asNumber(latest.ema_20);
    const ema50 = asNumber(latest.ema_50);
    const ema200 = asNumber(latest.ema_200);
    const bbWidth = latest.bb_upper && latest.bb_lower && latest.bb_mid ? ((asNumber(latest.bb_upper) - asNumber(latest.bb_lower)) / asNumber(latest.bb_mid)) * 100 : 0;
    return [
      { name: 'RSI (14)', value: latest.rsi_14 == null ? '—' : formatNumber(rsi, 2), signal: rsi > 70 ? 'Quá mua' : rsi < 30 ? 'Quá bán' : 'Trung lập', color: rsi > 70 ? '#EF4444' : rsi < 30 ? '#22C55E' : '#8EA0B8' },
      { name: 'MACD', value: latest.macd_hist == null ? '—' : formatNumber(macd, 2), signal: macd >= 0 ? 'Mua' : 'Bán', color: macd >= 0 ? '#22C55E' : '#EF4444' },
      { name: 'EMA20/50', value: ema20 && ema50 ? `${formatNumber(ema20, 0)} / ${formatNumber(ema50, 0)}` : '—', signal: ema20 >= ema50 ? 'Mua' : 'Bán', color: ema20 >= ema50 ? '#22C55E' : '#EF4444' },
      { name: 'EMA200', value: ema200 ? formatNumber(ema200, 0) : '—', signal: current >= ema200 ? 'Trên' : 'Dưới', color: current >= ema200 ? '#22C55E' : '#EF4444' },
      { name: 'BB Width', value: bbWidth ? `${formatNumber(bbWidth, 2)}%` : '—', signal: bbWidth > 8 ? 'Cao' : 'Trung lập', color: bbWidth > 8 ? '#F7931A' : '#8EA0B8' },
      { name: 'Volume', value: formatNumber(asNumber(latest.volume), 2), signal: asNumber(latest.volume) >= asNumber(latest.vol_ma_20) ? 'Cao' : 'Bình thường', color: asNumber(latest.volume) >= asNumber(latest.vol_ma_20) ? '#F7931A' : '#8EA0B8' },
    ];
  }, [latest, current]);

  if (market.error && !market.data) return <ErrorState message={market.error} onRetry={() => void market.refresh(72, true)} />;

  return (
    <div className="page-enter">
      <section className="hero-surface mb-6 rounded-2xl border border-[var(--border-soft)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider text-[var(--text-sec)]">Toàn cảnh thị trường BTC</p>
            <div className="flex flex-wrap items-baseline gap-3">
              {market.loading && !current ? <Skeleton className="h-9 w-56" /> : <span className="tabular text-3xl font-bold text-[var(--text-main)]">{formatUSD(current)}</span>}
              <span className={`tabular text-lg font-semibold ${isUp ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%</span>
              <Badge variant={isUp ? 'success' : 'danger'}>{isUp ? 'TĂNG' : 'GIẢM'}</Badge>
              <Badge variant={verdict === 'BUY' ? 'success' : verdict === 'SELL' ? 'danger' : 'neutral'}>{verdict === 'BUY' ? 'MUA' : verdict === 'SELL' ? 'BÁN' : 'TRUNG LẬP'}</Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--text-sec)]">≈ {formatVND(current * asNumber(buy?.market_price || buy?.p2p_price || 25_000))} · Cập nhật {latest.timestamp ? relativeTime(latest.timestamp) : 'đang đồng bộ'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => navigate('/decision')}>🧭 Decision Hub</Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/exchange')}>⚡ Giao dịch demo</Button>
            <Button variant="ghost" size="sm" onClick={() => navigate('/chart')}>📈 Biểu đồ kỹ thuật</Button>
            <Button variant="ghost" size="sm" onClick={() => void market.refresh(72, true)}>↻ Làm mới</Button>
          </div>
        </div>
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPICard label="Giá BTC/USDT" value={formatUSD(current)} sub={<span className={isUp ? 'text-[#22C55E]' : 'text-[#EF4444]'}>{formatPercent(change)} 24h</span>} icon="₿" delay={0} />
        <KPICard label="24H Cao / Thấp" value={formatUSD(high)} sub={`Thấp: ${formatUSD(low)}`} icon="↕" accent="#3B82F6" delay={60} />
        <KPICard label="Khối lượng 24H" value={`${formatNumber(volume, 2)} BTC`} sub={`${formatNumber(rows.reduce((sum, row) => sum + asNumber(row.trades), 0), 0)} giao dịch`} icon="📊" accent="#22C55E" delay={120} />
        <KPICard label="Rủi ro thị trường" value={<div className="flex items-center gap-2"><span>{Math.round(risk)}</span><Badge variant={risk < 30 ? 'success' : risk < 60 ? 'warning' : 'danger'}>{riskLabel}</Badge></div>} sub="Điểm rủi ro tổng hợp" icon="⚡" accent="#F59E0B" delay={180} />
      </section>

      <section className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex items-start justify-between gap-3">
            <SectionHeader title="Biểu đồ kỹ thuật 24H" sub="Nến OHLCV, EMA20/50/200, Bollinger, RSI, Stochastic và MACD" />
            <DataBadge source={market.data?.sources?.ohlcv === 'supabase' ? 'API' : market.data?.sources?.ohlcv === 'mock' ? 'Fallback' : 'Cache'} age={latest.timestamp ? relativeTime(latest.timestamp) : 'đang tải'} />
          </div>
          {market.loading && rows.length === 0 ? <Skeleton className="h-[590px] w-full rounded-lg" /> : <TechnicalAnalysisChart rows={rows} density="compact" />}
        </Card>

        <div className="flex flex-col gap-3">
          <Card className="p-4">
            <SectionHeader title="Giá P2P USDT/VNĐ" sub="Nguồn dữ liệu mới nhất" />
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-[#22C55E]/20 bg-[#22C55E]/[0.07] p-2.5"><span className="text-xs text-[var(--text-sec)]">P2P MUA</span><span className="tabular text-sm font-bold text-[#22C55E]">{buy?.p2p_price ? formatVND(buy.p2p_price) : '—'}</span></div>
              <div className="flex items-center justify-between rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/[0.07] p-2.5"><span className="text-xs text-[var(--text-sec)]">P2P BÁN</span><span className="tabular text-sm font-bold text-[#EF4444]">{sell?.p2p_price ? formatVND(sell.p2p_price) : '—'}</span></div>
              <div className="flex items-center justify-between px-1 text-xs text-[var(--text-sec)]"><span>Spread nội bộ</span><span className="tabular text-[#F59E0B]">{formatPercent(spread)}</span></div>
            </div>
          </Card>
          <Card className="flex items-center justify-between p-4">
            <div><p className="mb-1 text-xs text-[var(--text-sec)]">Điểm rủi ro</p><p className="tabular text-lg font-bold text-[#F59E0B]">{Math.round(risk)} / 100</p><Badge variant={risk < 30 ? 'success' : risk < 60 ? 'warning' : 'danger'}>{riskLabel}</Badge><p className="mt-1.5 text-xs text-[var(--text-sec)]">Khuyến nghị: {risk < 30 ? 'Theo dõi' : risk < 60 ? 'Thận trọng' : 'Ưu tiên bảo toàn vốn'}</p></div>
            <RiskMeter score={risk} />
          </Card>
        </div>
      </section>

      <Card className="mb-5 p-4">
        <div className="mb-3 flex items-center justify-between"><SectionHeader title="Tín hiệu kỹ thuật" sub="Phân tích đa chỉ báo" /><Button variant="ghost" size="sm" onClick={() => navigate('/chart')}>Xem chi tiết →</Button></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {signals.map((signal, index) => <div key={signal.name} className="card-reveal rounded-lg border border-[var(--border-soft)] bg-[var(--elevated)] p-3" style={{ animationDelay: `${index * 45}ms` }}><p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--text-sec)]">{signal.name}</p><p className="tabular text-sm font-bold text-[var(--text-main)]">{signal.value}</p><p className="mt-0.5 text-xs font-medium" style={{ color: signal.color }}>{signal.signal}</p></div>)}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-sec)]"><span>Tổng hợp:</span><Badge variant={verdict === 'BUY' ? 'success' : verdict === 'SELL' ? 'danger' : 'neutral'}>{verdict === 'BUY' ? 'Xu hướng MUA' : verdict === 'SELL' ? 'Xu hướng BÁN' : 'TRUNG LẬP'}</Badge><span className="ml-auto">Nguồn: {market.data?.sources?.summary || 'local rule'}</span></div>
      </Card>

      <section className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between"><SectionHeader title="Tin tức mới nhất" /><Button variant="ghost" size="sm" onClick={() => navigate('/news')}>Xem tất cả →</Button></div>
          {news.loading && !news.data ? <div className="space-y-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-16 w-full rounded-lg" />)}</div> : news.error ? <p className="text-sm text-[#EF4444]">{news.error}</p> : (
            <div className="space-y-2">{(news.data?.data || []).slice(0, 3).map((item, index) => <button key={`${item.title}-${index}`} onClick={() => item.link && window.open(item.link, '_blank', 'noopener,noreferrer')} className="flex w-full gap-3 rounded-lg p-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#F7931A]/10 text-[#F7931A]">₿</div><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs font-medium leading-relaxed text-[var(--text-main)]">{item.title}</p><div className="mt-1 flex items-center gap-2"><span className="text-[10px] text-[var(--text-sec)]">{item.source || 'BTC News'}</span><span className="text-[10px] text-[var(--text-dim)]">{item.published_at ? relativeTime(item.published_at) : 'mới'}</span></div></div></button>)}</div>
          )}
        </Card>

        <Card className="p-4">
          <SectionHeader title="Khám phá nhanh" sub="Truy cập các tính năng chính" />
          <div className="grid grid-cols-2 gap-2">{quickLinks.map(([path, icon, label, description]) => <button key={path} onClick={() => navigate(path)} className="group flex items-start gap-2.5 rounded-lg border border-[var(--border-soft)] bg-[var(--elevated)] p-3 text-left transition-[border-color,background-color] hover:border-[#F7931A]/30 hover:bg-[var(--surface-2)]"><span className="shrink-0 text-xl">{icon}</span><div><p className="text-xs font-semibold text-[var(--text-main)] transition-colors group-hover:text-[#F7931A]">{label}</p><p className="mt-0.5 text-[10px] text-[var(--text-sec)]">{description}</p></div></button>)}</div>
        </Card>
      </section>

      <Disclaimer text={`Tất cả dữ liệu, phân tích và tín hiệu chỉ mang tính tham khảo. Dữ liệu cuối: ${formatDateTime(latest.timestamp)}. Không phải khuyến nghị đầu tư; tài sản số có rủi ro cao.`} />
    </div>
  );
}
