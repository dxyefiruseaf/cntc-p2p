import { useEffect, useMemo, useState } from 'react';
import { useMarket } from '../context/MarketContext';
import { asNumber, formatNumber, formatPercent, formatUSD, formatVND, relativeTime } from '../lib/format';
import { Badge, Card, DataBadge, Skeleton } from '../components/ui';
import { ErrorState } from '../components/Feedback';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';

type TimeRange = 24 | 168 | 720;

export default function ChartTerminal() {
  const [hours, setHours] = useState<TimeRange>(168);
  const market = useMarket();

  useEffect(() => {
    if (market.loadedHours < hours) void market.refresh(hours);
  }, [hours, market.loadedHours, market.refresh]);

  const rows = useMemo(() => market.rows.slice(-hours), [market.rows, hours]);
  const latest = market.latest;
  const current = asNumber(latest.close);
  const base = asNumber(rows.slice(-24)[0]?.open || latest.open || current);
  const change = base ? ((current - base) / base) * 100 : 0;
  const isUp = change >= 0;
  const recent24 = rows.slice(-24);
  const high = recent24.length ? Math.max(...recent24.map(row => asNumber(row.high || row.close))) : asNumber(latest.high);
  const low = recent24.length ? Math.min(...recent24.map(row => asNumber(row.low || row.close)).filter(value => value > 0)) : asNumber(latest.low);
  const volume = recent24.reduce((sum, row) => sum + asNumber(row.volume), 0);
  const buy = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'BUY');
  const risk = asNumber(market.data?.risk?.score);

  const orderBook = useMemo(() => buildOrderBook(current), [current]);
  const recentTrades = useMemo(() => rows.slice(-14).reverse().map((row, index) => ({
    id: `${row.timestamp}-${index}`,
    price: asNumber(row.close),
    qty: Math.max(.0001, asNumber(row.volume) / Math.max(400, 750 + index * 130)),
    time: row.timestamp ? new Date(row.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—',
    side: asNumber(row.close) >= asNumber(row.open) ? 'buy' : 'sell',
  })), [rows]);

  const signalRows = [
    { name: 'RSI', value: latest.rsi_14 == null ? '—' : formatNumber(latest.rsi_14, 2), signal: asNumber(latest.rsi_14) > 70 ? 'Quá mua' : asNumber(latest.rsi_14) < 30 ? 'Quá bán' : 'Trung lập', color: asNumber(latest.rsi_14) > 70 ? '#EF4444' : asNumber(latest.rsi_14) < 30 ? '#22C55E' : '#8EA0B8' },
    { name: 'MACD', value: latest.macd_hist == null ? '—' : formatNumber(latest.macd_hist, 2), signal: asNumber(latest.macd_hist) >= 0 ? 'Mua' : 'Bán', color: asNumber(latest.macd_hist) >= 0 ? '#22C55E' : '#EF4444' },
    { name: 'EMA Trend', value: asNumber(latest.ema_20) >= asNumber(latest.ema_50) ? 'Tăng' : 'Giảm', signal: asNumber(latest.ema_20) >= asNumber(latest.ema_50) ? 'Mua' : 'Bán', color: asNumber(latest.ema_20) >= asNumber(latest.ema_50) ? '#22C55E' : '#EF4444' },
    { name: 'EMA200', value: latest.ema_200 == null ? '—' : formatNumber(latest.ema_200, 0), signal: current >= asNumber(latest.ema_200) ? 'Trên' : 'Dưới', color: current >= asNumber(latest.ema_200) ? '#22C55E' : '#EF4444' },
    { name: 'Volume', value: formatNumber(latest.volume, 2), signal: asNumber(latest.volume) >= asNumber(latest.vol_ma_20) ? 'Cao' : 'Bình thường', color: asNumber(latest.volume) >= asNumber(latest.vol_ma_20) ? '#F7931A' : '#8EA0B8' },
  ];

  if (market.error && !market.data) return <ErrorState message={market.error} onRetry={() => void market.refresh(hours, true)} />;

  return (
    <div className="page-enter flex min-h-[700px] flex-col gap-3">
      <section className="flex items-center gap-6 overflow-x-auto rounded-xl border border-[var(--border-soft)] bg-[var(--elevated)] px-4 py-2.5">
        <div className="flex shrink-0 items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#F7931A] text-xs font-bold text-black">₿</span><strong className="text-sm">BTC/USDT</strong></div>
        <div className="flex shrink-0 items-baseline gap-2"><span className="tabular text-lg font-bold">{formatUSD(current)}</span><span className={`tabular text-sm ${isUp ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{formatPercent(change)}</span></div>
        <MarketMetric label="24H CAO" value={formatUSD(high)} color="#22C55E" />
        <MarketMetric label="24H THẤP" value={formatUSD(low)} color="#EF4444" />
        <MarketMetric label="KHỐI LƯỢNG" value={`${formatNumber(volume, 2)} BTC`} />
        <MarketMetric label="P2P MUA" value={buy?.p2p_price ? formatVND(buy.p2p_price) : '—'} color="#22C55E" />
        <MarketMetric label="RỦI RO" value={`${Math.round(risk)}/100`} color="#F59E0B" />
        <div className="ml-auto shrink-0"><DataBadge source={market.data?.sources?.ohlcv === 'supabase' ? 'API' : market.data?.sources?.ohlcv === 'mock' ? 'Fallback' : 'Cache'} age={latest.timestamp ? relativeTime(latest.timestamp) : 'đang tải'} /></div>
      </section>

      <section className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[205px_minmax(0,1fr)] xl:grid-cols-[205px_minmax(0,1fr)_205px]">
        <Card className="hidden overflow-hidden p-3 lg:sticky lg:top-24 lg:flex lg:flex-col">
          <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-sec)]">Sổ lệnh mô phỏng</p><Badge variant="neutral">UI Demo</Badge></div>
          <div className="grid grid-cols-2 px-1 pb-1 text-[9px] text-[var(--text-dim)]"><span>Giá (USDT)</span><span className="text-right">Số lượng BTC</span></div>
          <div className="space-y-0.5">{orderBook.asks.slice().reverse().map((row, index) => <OrderRow key={`ask-${index}`} {...row} side="ask" />)}</div>
          <div className={`my-2 rounded-lg bg-[var(--surface-2)] py-2 text-center tabular text-sm font-bold ${isUp ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{formatUSD(current)}</div>
          <div className="space-y-0.5">{orderBook.bids.map((row, index) => <OrderRow key={`bid-${index}`} {...row} side="bid" />)}</div>
          <p className="mt-auto border-t border-[var(--border-soft)] pt-2 text-[9px] leading-relaxed text-[var(--text-dim)]">Sổ lệnh được mô phỏng từ giá hiện tại; không đại diện thanh khoản thật.</p>
        </Card>

        <Card className="min-w-0 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">{([24, 168, 720] as TimeRange[]).map(value => <button key={value} onClick={() => setHours(value)} className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${hours === value ? 'bg-[#F7931A]/20 text-[#F7931A]' : 'text-[var(--text-sec)] hover:bg-[var(--surface-2)] hover:text-[var(--text-main)]'}`}>{value === 24 ? '24H' : value === 168 ? '7D' : '30D'}</button>)}</div>
            <span className="text-[10px] text-[var(--text-sec)]">Nến OHLCV · đồng bộ tooltip giữa các chỉ báo</span>
          </div>

          {market.loading && rows.length === 0 ? <Skeleton className="h-[850px] rounded-xl" /> : <TechnicalAnalysisChart rows={rows} density="terminal" showBrush />}
          {market.refreshing && <p className="mt-2 text-right text-[10px] text-[var(--text-dim)]">Đang cập nhật dữ liệu nền…</p>}
        </Card>

        <div className="hidden flex-col gap-3 xl:sticky xl:top-24 xl:flex">
          <Card className="p-3">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-sec)]">Tín hiệu</p>
            <div className="space-y-2">{signalRows.map(row => <div key={row.name} className="grid grid-cols-[1fr_auto] gap-1 text-xs"><span className="text-[var(--text-sec)]">{row.name}</span><span className="tabular font-medium" style={{ color: row.color }}>{row.signal}</span><span className="col-span-2 text-[10px] text-[var(--text-dim)]">{row.value}</span></div>)}</div>
          </Card>
          <Card className="min-h-0 flex-1 overflow-hidden p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-sec)]">Giao dịch gần đây</p>
            <div className="grid grid-cols-3 pb-1 text-[9px] text-[var(--text-dim)]"><span>Giá</span><span className="text-right">SL</span><span className="text-right">Giờ</span></div>
            <div className="max-h-[360px] space-y-0.5 overflow-y-auto">{recentTrades.map(trade => <div key={trade.id} className="grid grid-cols-3 py-0.5 text-[10px]"><span className={`tabular font-medium ${trade.side === 'buy' ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{formatNumber(trade.price, 2)}</span><span className="tabular text-right text-[var(--text-sec)]">{formatNumber(trade.qty, 4)}</span><span className="text-right text-[var(--text-dim)]">{trade.time}</span></div>)}</div>
          </Card>
        </div>
      </section>
    </div>
  );
}

function buildOrderBook(price: number) {
  const asks = Array.from({ length: 11 }, (_, index) => ({ price: price * (1 + (index + 1) * .00035), qty: Math.abs(Math.sin(price + index)) * 1.9 + .03 }));
  const bids = Array.from({ length: 11 }, (_, index) => ({ price: price * (1 - (index + 1) * .00035), qty: Math.abs(Math.cos(price + index)) * 1.8 + .03 }));
  return { asks, bids };
}
function OrderRow({ price, qty, side }: { price: number; qty: number; side: 'ask' | 'bid' }) {
  const percentage = Math.min(100, qty / 2 * 100);
  return <div className="relative grid grid-cols-2 overflow-hidden rounded px-1.5 py-0.5 text-[10px]"><span className="absolute inset-y-0 right-0" style={{ width: `${percentage}%`, background: side === 'ask' ? 'rgba(239,68,68,.11)' : 'rgba(34,197,94,.11)' }} /><span className={`relative tabular font-medium ${side === 'ask' ? 'text-[#EF4444]' : 'text-[#22C55E]'}`}>{formatNumber(price, 2)}</span><span className="relative tabular text-right text-[var(--text-sec)]">{formatNumber(qty, 4)}</span></div>;
}
function MarketMetric({ label, value, color }: { label: string; value: string; color?: string }) { return <div className="flex shrink-0 flex-col"><span className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">{label}</span><span className="tabular text-xs font-semibold" style={{ color: color || 'var(--text-main)' }}>{value}</span></div>; }
