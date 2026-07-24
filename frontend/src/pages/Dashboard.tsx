import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api';
import { asNumber, formatDateTime, formatNumber, formatPercent, formatUSD, formatVND, relativeTime } from '../lib/format';
import { useMarket } from '../context/MarketContext';
import { useAsyncResource } from '../hooks/useAsyncResource';
import { Badge, Button, Card, DataBadge, Disclaimer, KPICard, RiskMeter, SectionHeader, Skeleton } from '../components/ui';
import { ErrorState } from '../components/Feedback';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';
import type { MarketRow } from '../types/api';

type NewsItem = { title?: string; source?: string; published_at?: string; summary?: string; link?: string; image?: string; tags?: string[] };
type DashboardRange = 24 | 168 | 720;

const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string; short: string }> = [
  { value: 24, label: '24 giờ', short: '24H' },
  { value: 168, label: '7 ngày', short: '7D' },
  { value: 720, label: '30 ngày', short: '30D' },
];

const quickLinks = [
  ['/chart', '📈', 'Biểu đồ kỹ thuật', 'Terminal giao dịch đầy đủ'],
  ['/decision', '🧭', 'Decision Hub', 'Hỗ trợ ra quyết định'],
  ['/exchange', '⚡', 'Giao dịch demo', 'Mô phỏng mua/bán BTC'],
  ['/p2p', '↔', 'So sánh P2P', 'Giá P2P và thị trường'],
  ['/tax', '🧮', 'Ước tính thuế', 'Mô phỏng nghĩa vụ thuế'],
  ['/alerts', '🔔', 'Cảnh báo Email', 'Theo dõi giá và chỉ báo'],
] as const;

function calculatePeriod(rows: MarketRow[], hours: number) {
  const periodRows = rows.slice(-hours);
  const latest = periodRows.at(-1);
  const first = periodRows[0];
  const current = asNumber(latest?.close);
  const opening = asNumber(first?.open || first?.close || current);
  const change = opening ? ((current - opening) / opening) * 100 : 0;
  const highs = periodRows.map(row => asNumber(row.high || row.close)).filter(value => value > 0);
  const lows = periodRows.map(row => asNumber(row.low || row.close)).filter(value => value > 0);
  return {
    rows: periodRows,
    current,
    opening,
    change,
    high: highs.length ? Math.max(...highs) : current,
    low: lows.length ? Math.min(...lows) : current,
    volume: periodRows.reduce((sum, row) => sum + asNumber(row.volume), 0),
    trades: periodRows.reduce((sum, row) => sum + asNumber(row.trades), 0),
  };
}

function indicatorTone(signal: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const normalized = signal.toLowerCase();
  if (normalized.includes('mua') || normalized.includes('tăng') || normalized.includes('tích cực') || normalized.includes('trên')) return 'success';
  if (normalized.includes('bán') || normalized.includes('giảm') || normalized.includes('quá mua') || normalized.includes('dưới')) return 'danger';
  if (normalized.includes('cao') || normalized.includes('chú ý')) return 'warning';
  return 'neutral';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const market = useMarket();
  const [rangeHours, setRangeHours] = useState<DashboardRange>(168);
  const news = useAsyncResource(
    signal => apiRequest<{ data?: NewsItem[] }>('/api/news/latest?limit=6', { signal, timeout: 20_000 }),
    [],
  );

  useEffect(() => {
    if (market.loadedHours < rangeHours) void market.refresh(rangeHours);
  }, [market.loadedHours, market.refresh, rangeHours]);

  const latest = market.latest;
  const selected = useMemo(() => calculatePeriod(market.rows, rangeHours), [market.rows, rangeHours]);
  const current = asNumber(latest.close || selected.current);
  const change = selected.opening ? ((current - selected.opening) / selected.opening) * 100 : selected.change;
  const risk = asNumber(market.data?.risk?.score);
  const riskLabel = String(market.data?.risk?.label_vi || market.data?.risk?.level || (risk < 30 ? 'Thấp' : risk < 60 ? 'Trung bình' : 'Cao'));
  const verdict = String(market.data?.summary?.overall?.verdict || 'NEUTRAL').toUpperCase();
  const buy = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'BUY');
  const sell = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'SELL');
  const spread = buy?.p2p_price && sell?.p2p_price ? ((buy.p2p_price - sell.p2p_price) / sell.p2p_price) * 100 : 0;
  const isUp = change >= 0;
  const rangeLabel = RANGE_OPTIONS.find(option => option.value === rangeHours)?.label || `${rangeHours} giờ`;

  const indicatorData = useMemo(() => {
    const rsi = asNumber(latest.rsi_14);
    const macd = asNumber(latest.macd);
    const signal = asNumber(latest.macd_signal);
    const macdHist = asNumber(latest.macd_hist);
    const ema20 = asNumber(latest.ema_20);
    const ema50 = asNumber(latest.ema_50);
    const ema200 = asNumber(latest.ema_200);
    const bbUpper = asNumber(latest.bb_upper);
    const bbMid = asNumber(latest.bb_mid);
    const bbLower = asNumber(latest.bb_lower);
    const bbWidth = bbMid ? ((bbUpper - bbLower) / bbMid) * 100 : 0;
    const bbPosition = bbUpper > bbLower ? ((current - bbLower) / (bbUpper - bbLower)) * 100 : 0;
    const atr = asNumber(latest.atr_14);
    const atrPercent = current ? (atr / current) * 100 : 0;
    const stochK = asNumber(latest.stoch_k);
    const stochD = asNumber(latest.stoch_d);
    const volume = asNumber(latest.volume);
    const volumeMA = asNumber(latest.vol_ma_20);
    const emaSpread = ema50 ? ((ema20 - ema50) / ema50) * 100 : 0;

    const rows = [
      { name: 'RSI (14)', value: latest.rsi_14 == null ? '—' : formatNumber(rsi, 2), signal: rsi > 70 ? 'Quá mua' : rsi < 30 ? 'Quá bán' : 'Trung lập', note: 'Động lượng 0–100; vùng 30/70 là mốc tham chiếu.' },
      { name: 'MACD', value: latest.macd == null ? '—' : formatNumber(macd, 2), signal: macdHist >= 0 ? 'Mua' : 'Bán', note: `Signal ${formatNumber(signal, 2)} · Histogram ${formatNumber(macdHist, 2)}` },
      { name: 'EMA20', value: latest.ema_20 == null ? '—' : formatUSD(ema20), signal: current >= ema20 ? 'Giá ở trên' : 'Giá ở dưới', note: 'Xu hướng ngắn hạn.' },
      { name: 'EMA50', value: latest.ema_50 == null ? '—' : formatUSD(ema50), signal: ema20 >= ema50 ? 'Xu hướng tăng' : 'Xu hướng giảm', note: `Chênh EMA20/50: ${formatPercent(emaSpread)}` },
      { name: 'EMA200', value: latest.ema_200 == null ? '—' : formatUSD(ema200), signal: current >= ema200 ? 'Trên xu hướng dài hạn' : 'Dưới xu hướng dài hạn', note: 'Mốc xu hướng dài hạn.' },
      { name: 'Bollinger', value: bbMid ? `${formatUSD(bbLower)} – ${formatUSD(bbUpper)}` : '—', signal: bbPosition > 100 ? 'Vượt dải trên' : bbPosition < 0 ? 'Dưới dải dưới' : `${formatNumber(bbPosition, 0)}% trong dải`, note: `BB Mid ${formatUSD(bbMid)} · Width ${formatNumber(bbWidth, 2)}%` },
      { name: 'ATR (14)', value: latest.atr_14 == null ? '—' : formatUSD(atr), signal: atrPercent > 2 ? 'Biến động cao' : atrPercent > 1 ? 'Biến động vừa' : 'Biến động thấp', note: `${formatNumber(atrPercent, 2)}% giá BTC.` },
      { name: 'Stochastic', value: latest.stoch_k == null ? '—' : `K ${formatNumber(stochK, 2)} · D ${formatNumber(stochD, 2)}`, signal: stochK > 80 ? 'Quá mua' : stochK < 20 ? 'Quá bán' : stochK >= stochD ? 'Động lượng tăng' : 'Động lượng giảm', note: 'So sánh vị trí giá đóng cửa trong biên độ gần đây.' },
      { name: 'Khối lượng', value: latest.volume == null ? '—' : `${formatNumber(volume, 2)} BTC`, signal: volumeMA && volume >= volumeMA ? 'Cao hơn MA20' : 'Dưới MA20', note: `Volume MA20: ${formatNumber(volumeMA, 2)} BTC` },
    ];

    return { rows, rsi, macdHist, ema20, ema50, ema200, bbWidth, bbPosition, atr, atrPercent, stochK, stochD, volume, volumeMA };
  }, [current, latest]);

  const periodCards = useMemo(() => RANGE_OPTIONS.map(option => {
    const enough = market.rows.length >= Math.min(option.value, market.loadedHours || market.rows.length);
    const stats = calculatePeriod(market.rows, option.value);
    return { ...option, ...stats, enough: option.value <= market.loadedHours && enough };
  }), [market.loadedHours, market.rows]);

  const supportResistance = useMemo(() => {
    const recent = selected.rows.slice(-Math.min(selected.rows.length, rangeHours === 24 ? 24 : 72));
    const highs = recent.map(row => asNumber(row.high || row.close)).filter(value => value > 0);
    const lows = recent.map(row => asNumber(row.low || row.close)).filter(value => value > 0);
    return {
      resistance: highs.length ? Math.max(...highs) : 0,
      support: lows.length ? Math.min(...lows) : 0,
    };
  }, [rangeHours, selected.rows]);

  if (market.error && !market.data) return <ErrorState message={market.error} onRetry={() => void market.refresh(rangeHours, true)} />;

  return (
    <div className="page-enter">
      <section className="hero-surface mb-5 rounded-2xl border border-[var(--border-soft)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider text-[var(--text-sec)]">Toàn cảnh thị trường BTC · {rangeLabel}</p>
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/chart')}>📈 Terminal</Button>
            <Button variant="ghost" size="sm" loading={market.refreshing} onClick={() => void market.refresh(rangeHours, true)}>↻ Làm mới</Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border-soft)] pt-4">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-sec)]">Khung xem</span>
          {RANGE_OPTIONS.map(option => (
            <button
              type="button"
              key={option.value}
              onClick={() => setRangeHours(option.value)}
              className={`dashboard-range-button ${rangeHours === option.value ? 'active' : ''}`}
            >
              <strong>{option.short}</strong><span>{option.label}</span>
            </button>
          ))}
          {market.loadedHours < rangeHours && <span className="ml-1 text-[10px] text-[#F59E0B]">Đang tải thêm dữ liệu {rangeLabel}…</span>}
        </div>
      </section>

      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KPICard label="Giá BTC/USDT" value={formatUSD(current)} sub={<span className={isUp ? 'text-[#22C55E]' : 'text-[#EF4444]'}>{formatPercent(change)} · {rangeLabel}</span>} icon="₿" delay={0} />
        <KPICard label="Cao nhất" value={formatUSD(selected.high)} sub={`Thấp: ${formatUSD(selected.low)}`} icon="↕" accent="#3B82F6" delay={40} />
        <KPICard label="Khối lượng" value={`${formatNumber(selected.volume, 2)} BTC`} sub={`${formatNumber(selected.trades, 0)} giao dịch`} icon="▥" accent="#22C55E" delay={80} />
        <KPICard label="RSI (14)" value={latest.rsi_14 == null ? '—' : formatNumber(indicatorData.rsi, 2)} sub={indicatorData.rsi > 70 ? 'Quá mua' : indicatorData.rsi < 30 ? 'Quá bán' : 'Trung lập'} icon="R" accent="#F59E0B" delay={120} />
        <KPICard label="MACD Hist" value={latest.macd_hist == null ? '—' : formatNumber(indicatorData.macdHist, 2)} sub={indicatorData.macdHist >= 0 ? 'Động lượng dương' : 'Động lượng âm'} icon="M" accent={indicatorData.macdHist >= 0 ? '#22C55E' : '#EF4444'} delay={160} />
        <KPICard label="ATR (14)" value={latest.atr_14 == null ? '—' : formatUSD(indicatorData.atr)} sub={`${formatNumber(indicatorData.atrPercent, 2)}% giá`} icon="A" accent="#8B5CF6" delay={200} />
        <KPICard label="P2P Spread" value={formatPercent(spread)} sub={buy?.p2p_price ? `Mua ${formatVND(buy.p2p_price)}` : 'Chưa có dữ liệu'} icon="↔" accent="#14B8A6" delay={240} />
        <KPICard label="Rủi ro" value={<div className="flex items-center gap-2"><span>{Math.round(risk)}</span><Badge variant={risk < 30 ? 'success' : risk < 60 ? 'warning' : 'danger'}>{riskLabel}</Badge></div>} sub="Điểm tổng hợp / 100" icon="⚡" accent="#F59E0B" delay={280} />
      </section>

      <Card className="mb-5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionHeader title="Diễn biến đa khung thời gian" sub="So sánh nhanh 24 giờ, 7 ngày và 30 ngày trên cùng dữ liệu OHLCV." />
          <span className="text-[10px] text-[var(--text-dim)]">Nhấn vào một khung để cập nhật toàn bộ dashboard</span>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {periodCards.map(card => (
            <button type="button" key={card.value} onClick={() => setRangeHours(card.value)} className={`period-summary-card ${rangeHours === card.value ? 'active' : ''}`}>
              <div className="flex items-center justify-between gap-3">
                <div><span>{card.label}</span><strong>{card.short}</strong></div>
                <b className={card.change >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}>{card.enough ? formatPercent(card.change) : 'Tải dữ liệu'}</b>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <small>Cao <em>{card.enough ? formatUSD(card.high, 0) : '—'}</em></small>
                <small>Thấp <em>{card.enough ? formatUSD(card.low, 0) : '—'}</em></small>
                <small>Volume <em>{card.enough ? formatNumber(card.volume, 0) : '—'}</em></small>
              </div>
            </button>
          ))}
        </div>
      </Card>

      <section className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.35fr)]">
        <Card className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <SectionHeader title={`Biểu đồ kỹ thuật · ${rangeLabel}`} sub="Nến OHLCV, EMA20/50/200, Bollinger, khối lượng, RSI, Stochastic và MACD." />
            <div className="flex items-center gap-2">
              <DataBadge source={market.data?.sources?.ohlcv === 'supabase' ? 'API' : market.data?.sources?.ohlcv === 'mock' ? 'Fallback' : 'Cache'} age={latest.timestamp ? relativeTime(latest.timestamp) : 'đang tải'} />
              <Button variant="ghost" size="sm" onClick={() => navigate('/chart')}>Mở toàn màn hình →</Button>
            </div>
          </div>
          {market.loading && selected.rows.length === 0 ? <Skeleton className="h-[720px] w-full rounded-lg" /> : <TechnicalAnalysisChart rows={selected.rows} density="standard" showBrush={rangeHours > 24} />}
          {market.refreshing && <p className="mt-2 text-right text-[10px] text-[var(--text-dim)]">Đang cập nhật dữ liệu nền…</p>}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <SectionHeader title="Mốc giá quan trọng" sub={`Tính trên ${rangeLabel} đang chọn`} />
            <div className="space-y-2">
              <PriceLevel label="Kháng cự gần" value={supportResistance.resistance} tone="red" />
              <PriceLevel label="Giá hiện tại" value={current} tone="orange" />
              <PriceLevel label="Hỗ trợ gần" value={supportResistance.support} tone="green" />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="metric-box"><span>Biên độ</span><strong>{formatPercent(selected.low ? ((selected.high - selected.low) / selected.low) * 100 : 0)}</strong></div>
                <div className="metric-box"><span>ATR / Giá</span><strong>{formatNumber(indicatorData.atrPercent, 2)}%</strong></div>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <SectionHeader title="P2P USDT/VNĐ" sub="Giá mới nhất từ nguồn đồng bộ" />
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border border-[#22C55E]/20 bg-[#22C55E]/[0.07] p-2.5"><span className="text-xs text-[var(--text-sec)]">P2P MUA</span><span className="tabular text-sm font-bold text-[#22C55E]">{buy?.p2p_price ? formatVND(buy.p2p_price) : '—'}</span></div>
              <div className="flex items-center justify-between rounded-lg border border-[#EF4444]/20 bg-[#EF4444]/[0.07] p-2.5"><span className="text-xs text-[var(--text-sec)]">P2P BÁN</span><span className="tabular text-sm font-bold text-[#EF4444]">{sell?.p2p_price ? formatVND(sell.p2p_price) : '—'}</span></div>
              <div className="flex items-center justify-between px-1 text-xs text-[var(--text-sec)]"><span>Spread nội bộ</span><span className="tabular text-[#F59E0B]">{formatPercent(spread)}</span></div>
            </div>
          </Card>

          <Card className="flex items-center justify-between p-4">
            <div><p className="mb-1 text-xs text-[var(--text-sec)]">Điểm rủi ro</p><p className="tabular text-lg font-bold text-[#F59E0B]">{Math.round(risk)} / 100</p><Badge variant={risk < 30 ? 'success' : risk < 60 ? 'warning' : 'danger'}>{riskLabel}</Badge><p className="mt-1.5 text-xs text-[var(--text-sec)]">{risk < 30 ? 'Biến động đang trong vùng thấp.' : risk < 60 ? 'Nên quản trị vị thế thận trọng.' : 'Ưu tiên bảo toàn vốn và hạn chế đòn bẩy.'}</p></div>
            <RiskMeter score={risk} />
          </Card>
        </div>
      </section>

      <Card className="mb-5 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><SectionHeader title="Bảng chỉ báo kỹ thuật đầy đủ" sub="Giá trị hiện tại, trạng thái và ý nghĩa ngắn gọn của từng chỉ báo." /><Badge variant={verdict === 'BUY' ? 'success' : verdict === 'SELL' ? 'danger' : 'neutral'}>{verdict === 'BUY' ? 'Xu hướng MUA' : verdict === 'SELL' ? 'Xu hướng BÁN' : 'TRUNG LẬP'}</Badge></div>
        <div className="indicator-matrix">
          {indicatorData.rows.map((indicator, index) => (
            <div key={indicator.name} className="indicator-detail-card card-reveal" style={{ animationDelay: `${index * 35}ms` }}>
              <div className="flex items-start justify-between gap-3"><div><span>{indicator.name}</span><strong>{indicator.value}</strong></div><Badge variant={indicatorTone(indicator.signal)}>{indicator.signal}</Badge></div>
              <p>{indicator.note}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[var(--text-sec)]"><span>Nguồn tổng hợp: {market.data?.sources?.summary || 'local rule'}</span><span>Khung dữ liệu: {rangeLabel}</span><span className="ml-auto">Dữ liệu cuối: {formatDateTime(latest.timestamp)}</span></div>
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

function PriceLevel({ label, value, tone }: { label: string; value: number; tone: 'red' | 'orange' | 'green' }) {
  return <div className={`price-level price-level-${tone}`}><span>{label}</span><strong>{value ? formatUSD(value) : '—'}</strong></div>;
}
