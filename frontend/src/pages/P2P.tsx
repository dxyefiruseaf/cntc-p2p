import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brush, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useMarket } from '../context/MarketContext';
import { asNumber, formatNumber, formatPercent, formatVND, relativeTime } from '../lib/format';
import { Badge, Button, Card, Disclaimer, KPICard, SectionHeader, Skeleton } from '../components/ui';
import { ErrorState } from '../components/Feedback';

export default function P2P() {
  const navigate = useNavigate();
  const market = useMarket();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const buy = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'BUY');
  const sell = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'SELL');
  const marketRate = asNumber(buy?.market_price || sell?.market_price);
  const buySpread = buy?.spread_pct == null ? 0 : asNumber(buy.spread_pct);
  const sellSpread = sell?.spread_pct == null ? 0 : asNumber(sell.spread_pct);

  const chartData = useMemo(() => {
    const groups = new Map<string, { time: string; buy?: number; sell?: number; market?: number }>();
    [...market.p2pRows].reverse().forEach(row => {
      const time = row.timestamp ? new Date(row.timestamp).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit' }) : '—';
      const current = groups.get(time) || { time };
      if (String(row.trade_type).toUpperCase() === 'BUY') current.buy = asNumber(row.p2p_price);
      if (String(row.trade_type).toUpperCase() === 'SELL') current.sell = asNumber(row.p2p_price);
      current.market = asNumber(row.market_price);
      groups.set(time, current);
    });
    return [...groups.values()];
  }, [market.p2pRows]);

  if (market.error && !market.data) return <ErrorState message={market.error} onRetry={() => void market.refresh(168, true)} />;

  return (
    <div className="page-enter">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold">So sánh P2P</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Theo dõi giá USDT/VNĐ, spread và mức chênh lệch so với thị trường.</p></div>
        <div className="flex gap-2"><Button variant="secondary" size="sm" onClick={() => void market.refresh(168, true)}>↻ Làm mới</Button><Button size="sm" onClick={() => navigate('/exchange')}>Mở giao dịch demo</Button></div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 md:grid-cols-3">
        <KPICard label="P2P MUA USDT" value={<span className="text-[#22C55E]">{buy?.p2p_price ? formatVND(buy.p2p_price) : '—'}</span>} sub={`Spread ${formatPercent(buySpread, 3)}`} icon="⬆" accent="#22C55E" delay={0} />
        <KPICard label="P2P BÁN USDT" value={<span className="text-[#EF4444]">{sell?.p2p_price ? formatVND(sell.p2p_price) : '—'}</span>} sub={`Spread ${formatPercent(sellSpread, 3)}`} icon="⬇" accent="#EF4444" delay={60} />
        <KPICard label="Tỷ giá thị trường" value={marketRate ? `${formatNumber(marketRate, 0)} ₫` : '—'} sub={buy?.timestamp ? `Cập nhật ${relativeTime(buy.timestamp)}` : 'Đang đồng bộ'} icon="⚖" accent="#3B82F6" delay={120} />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><SectionHeader title="Lịch sử giá P2P" sub="BUY, SELL và tỷ giá tham chiếu theo thời gian" /><div className="flex gap-1"><button onClick={() => setSide('buy')} className={`segment-btn ${side === 'buy' ? 'active' : ''}`}>Mua USDT</button><button onClick={() => setSide('sell')} className={`segment-btn ${side === 'sell' ? 'active' : ''}`}>Bán USDT</button></div></div>
          {market.loading && chartData.length === 0 ? <Skeleton className="h-80 rounded-xl" /> : (
            <ResponsiveContainer width="100%" height={390}>
              <LineChart data={chartData} margin={{ top: 18, right: 18, bottom: 8, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--text-dim)' }} minTickGap={35} height={52} />
                <YAxis orientation="right" domain={['auto', 'auto']} tick={{ fontSize: 9, fill: 'var(--text-dim)' }} width={78} tickFormatter={value => `${Math.round(Number(value) / 1000)}K`} />
                <Tooltip contentStyle={{ background: 'var(--elevated)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11 }} formatter={(value: unknown, name: unknown) => [formatVND(value), String(name || '')]} />
                <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 10, color: 'var(--text-sec)' }} />
                {marketRate > 0 && <ReferenceLine y={marketRate} stroke="#3B82F6" strokeDasharray="3 4" strokeOpacity={.45} label={{ value: `Tham chiếu ${formatVND(marketRate)}`, fill: '#60A5FA', fontSize: 9, position: 'insideTopRight' }} />}
                <Line type="monotone" dataKey="buy" name="P2P BUY" stroke="#22C55E" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} connectNulls opacity={side === 'buy' ? 1 : .3} />
                <Line type="monotone" dataKey="sell" name="P2P SELL" stroke="#EF4444" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} connectNulls opacity={side === 'sell' ? 1 : .3} />
                <Line type="monotone" dataKey="market" name="Tỷ giá thị trường" stroke="#3B82F6" strokeWidth={1.7} strokeDasharray="5 4" dot={false} connectNulls />
                <Brush dataKey="time" height={24} travellerWidth={8} stroke="#F7931A" fill="var(--surface-2)" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <SectionHeader title="Chiều mua USDT" sub="Bạn dùng VNĐ để mua USDT" />
            <CompareRow label="Giá P2P" value={buy?.p2p_price ? formatVND(buy.p2p_price) : '—'} color="#22C55E" />
            <CompareRow label="Giá thị trường" value={marketRate ? formatVND(marketRate) : '—'} />
            <div className={`mt-3 rounded-lg border p-3 ${buySpread <= 0 ? 'border-[#22C55E]/25 bg-[#22C55E]/[0.06]' : 'border-[#F59E0B]/25 bg-[#F59E0B]/[0.06]'}`}><div className="flex items-center justify-between"><span className="text-xs text-[var(--text-sec)]">Chênh lệch</span><Badge variant={buySpread <= 0 ? 'success' : 'warning'}>{formatPercent(buySpread, 3)}</Badge></div><p className="mt-2 text-xs leading-relaxed text-[var(--text-sec)]">{buySpread <= 0 ? 'Giá P2P đang thấp hơn tham chiếu, có lợi hơn cho người mua.' : `Bạn trả thêm khoảng ${formatVND(asNumber(buy?.p2p_price) - marketRate)} cho mỗi USDT.`}</p></div>
          </Card>
          <Card className="p-4">
            <SectionHeader title="Chiều bán USDT" sub="Bạn bán USDT để nhận VNĐ" />
            <CompareRow label="Giá P2P" value={sell?.p2p_price ? formatVND(sell.p2p_price) : '—'} color="#EF4444" />
            <CompareRow label="Giá thị trường" value={marketRate ? formatVND(marketRate) : '—'} />
            <div className={`mt-3 rounded-lg border p-3 ${sellSpread >= 0 ? 'border-[#22C55E]/25 bg-[#22C55E]/[0.06]' : 'border-[#F59E0B]/25 bg-[#F59E0B]/[0.06]'}`}><div className="flex items-center justify-between"><span className="text-xs text-[var(--text-sec)]">Chênh lệch</span><Badge variant={sellSpread >= 0 ? 'success' : 'warning'}>{formatPercent(sellSpread, 3)}</Badge></div><p className="mt-2 text-xs leading-relaxed text-[var(--text-sec)]">{sellSpread >= 0 ? `Bạn nhận thêm khoảng ${formatVND(asNumber(sell?.p2p_price) - marketRate)} cho mỗi USDT.` : 'Giá P2P đang thấp hơn tham chiếu; nên cân nhắc thời điểm bán.'}</p></div>
          </Card>
        </div>
      </div>
      <Disclaimer text="Giá P2P thay đổi theo thời điểm, ngân hàng, merchant và hạn mức giao dịch. Số liệu chỉ dùng cho phân tích sandbox." />
    </div>
  );
}

function CompareRow({ label, value, color }: { label: string; value: string; color?: string }) { return <div className="mb-2 flex items-center justify-between rounded-lg bg-[var(--elevated)] px-3 py-2"><span className="text-xs text-[var(--text-sec)]">{label}</span><strong className="tabular text-sm" style={{ color: color || 'var(--text-main)' }}>{value}</strong></div>; }
