import { memo, useDeferredValue, useId, useMemo, useState } from 'react';
import {
  Area,
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber, formatUSD } from '../lib/format';
import type { MarketRow } from '../types/api';

type ChartRowInput = MarketRow | Record<string, unknown>;
type Density = 'compact' | 'standard' | 'terminal';

interface TechnicalAnalysisChartProps {
  rows: ChartRowInput[];
  density?: Density;
  showBrush?: boolean;
  className?: string;
}

type IndicatorKey = 'ema' | 'bollinger' | 'volume' | 'momentum' | 'macd';

const palette = {
  up: '#10B981',
  down: '#F87171',
  ema20: '#F59E0B',
  ema50: '#38BDF8',
  ema200: '#8B5CF6',
  bbUpper: '#94A3B8',
  bbMid: '#14B8A6',
  bbLower: '#CBD5E1',
  rsi: '#F59E0B',
  stochK: '#22C55E',
  stochD: '#EC4899',
  macd: '#38BDF8',
  signal: '#F59E0B',
};

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function rowNumber(row: ChartRowInput, key: string, fallback = 0): number {
  const value = optionalNumber((row as Record<string, unknown>)[key]);
  return value ?? fallback;
}

const INDICATOR_FIELDS = ['ema_20', 'ema_50', 'ema_200', 'bb_upper', 'bb_mid', 'bb_lower', 'vol_ma_20', 'rsi_14', 'stoch_k', 'stoch_d', 'macd', 'macd_signal', 'macd_hist'] as const;

function aggregateRows(rows: ChartRowInput[], maxPoints: number): ChartRowInput[] {
  if (rows.length <= maxPoints) return rows;
  const bucketSize = Math.ceil(rows.length / maxPoints);
  const aggregated: ChartRowInput[] = [];
  for (let start = 0; start < rows.length; start += bucketSize) {
    const bucket = rows.slice(start, start + bucketSize);
    const first = bucket[0] as Record<string, unknown>;
    const last = bucket[bucket.length - 1] as Record<string, unknown>;
    const open = rowNumber(first, 'open', rowNumber(first, 'close'));
    const close = rowNumber(last, 'close', rowNumber(last, 'open', open));
    const highs = bucket.map(row => rowNumber(row, 'high', Math.max(rowNumber(row, 'open'), rowNumber(row, 'close'))));
    const lows = bucket.map(row => rowNumber(row, 'low', Math.min(rowNumber(row, 'open'), rowNumber(row, 'close')))).filter(value => value > 0);
    const combined: Record<string, unknown> = {
      timestamp: last.timestamp || first.timestamp,
      open,
      close,
      high: Math.max(open, close, ...highs),
      low: lows.length ? Math.min(open || Number.POSITIVE_INFINITY, close || Number.POSITIVE_INFINITY, ...lows) : Math.min(open, close),
      volume: bucket.reduce((total, row) => total + rowNumber(row, 'volume'), 0),
      trades: bucket.reduce((total, row) => total + rowNumber(row, 'trades'), 0),
    };
    for (const field of INDICATOR_FIELDS) combined[field] = last[field];
    aggregated.push(combined);
  }
  return aggregated;
}

function formatTime(value: unknown, count: number): string {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return '—';
  if (count <= 36) return date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  if (count <= 200) return date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit' });
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}

function TechnicalAnalysisChart({ rows, density = 'standard', showBrush = false, className = '' }: TechnicalAnalysisChartProps) {
  const rawId = useId();
  const syncId = `technical-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [visible, setVisible] = useState<Record<IndicatorKey, boolean>>({
    ema: true,
    bollinger: true,
    volume: true,
    momentum: true,
    macd: true,
  });

  const deferredRows = useDeferredValue(rows);
  const maxPoints = density === 'terminal' ? 360 : density === 'compact' ? 220 : 300;
  const preparedRows = useMemo(() => aggregateRows(deferredRows, maxPoints), [deferredRows, maxPoints]);
  const data = useMemo(() => preparedRows.map((row, index) => {
    const open = rowNumber(row, 'open', rowNumber(row, 'close'));
    const close = rowNumber(row, 'close', open);
    const high = Math.max(rowNumber(row, 'high', Math.max(open, close)), open, close);
    const low = Math.min(rowNumber(row, 'low', Math.min(open, close)), open, close);
    const bbUpper = optionalNumber((row as Record<string, unknown>).bb_upper);
    const bbLower = optionalNumber((row as Record<string, unknown>).bb_lower);
    return {
      index,
      timestamp: String((row as Record<string, unknown>).timestamp || ''),
      time: formatTime((row as Record<string, unknown>).timestamp, preparedRows.length),
      open,
      close,
      high,
      low,
      candleRange: [low, high],
      up: close >= open,
      ema20: optionalNumber((row as Record<string, unknown>).ema_20),
      ema50: optionalNumber((row as Record<string, unknown>).ema_50),
      ema200: optionalNumber((row as Record<string, unknown>).ema_200),
      bbUpper,
      bbMid: optionalNumber((row as Record<string, unknown>).bb_mid),
      bbLower,
      bbRange: bbUpper !== null && bbLower !== null ? [bbLower, bbUpper] : null,
      volume: rowNumber(row, 'volume'),
      volMa20: optionalNumber((row as Record<string, unknown>).vol_ma_20),
      rsi: optionalNumber((row as Record<string, unknown>).rsi_14),
      stochK: optionalNumber((row as Record<string, unknown>).stoch_k),
      stochD: optionalNumber((row as Record<string, unknown>).stoch_d),
      macd: optionalNumber((row as Record<string, unknown>).macd),
      signal: optionalNumber((row as Record<string, unknown>).macd_signal),
      macdHist: optionalNumber((row as Record<string, unknown>).macd_hist),
    };
  }), [preparedRows]);

  const stats = useMemo(() => {
    const valid = data.filter(row => row.high > 0 && row.low > 0);
    if (!valid.length) return { domain: [0, 1] as [number, number], support: 0, resistance: 0, last: 0 };
    const min = Math.min(...valid.map(row => row.bbLower ?? row.low));
    const max = Math.max(...valid.map(row => row.bbUpper ?? row.high));
    const padding = Math.max((max - min) * .06, max * .002);
    const recent = valid.slice(-Math.min(valid.length, 72));
    return {
      domain: [Math.max(0, min - padding), max + padding] as [number, number],
      support: Math.min(...recent.map(row => row.low)),
      resistance: Math.max(...recent.map(row => row.high)),
      last: valid.at(-1)?.close || 0,
    };
  }, [data]);

  if (!data.length) return <div className={`technical-empty ${className}`}>Chưa có dữ liệu OHLCV để vẽ biểu đồ.</div>;

  const sizes = density === 'terminal'
    ? { price: 390, volume: 105, momentum: 130, macd: 130 }
    : density === 'compact'
      ? { price: 260, volume: 82, momentum: 112, macd: 112 }
      : { price: 330, volume: 95, momentum: 125, macd: 125 };

  const toggle = (key: IndicatorKey) => setVisible(current => ({ ...current, [key]: !current[key] }));
  const commonTooltip = <Tooltip content={<TechnicalTooltip />} cursor={{ stroke: 'var(--text-dim)', strokeDasharray: '4 4', strokeWidth: 1 }} />;

  return (
    <div className={`technical-chart-shell ${className}`}>
      <div className="technical-toolbar">
        <div className="technical-legend-row">
          <LegendSwatch color={palette.up} label="Nến tăng" />
          <LegendSwatch color={palette.down} label="Nến giảm" />
          <LegendSwatch color={palette.ema20} label="EMA20" />
          <LegendSwatch color={palette.ema50} label="EMA50" />
          <LegendSwatch color={palette.ema200} label="EMA200" />
          <LegendSwatch color={palette.bbUpper} label="BB Upper" dashed />
          <LegendSwatch color={palette.bbMid} label="BB Mid" dashed />
          <LegendSwatch color={palette.bbLower} label="BB Lower" dashed />
        </div>
        <div className="technical-toggle-row">
          <IndicatorToggle active={visible.ema} onClick={() => toggle('ema')} label="EMA" />
          <IndicatorToggle active={visible.bollinger} onClick={() => toggle('bollinger')} label="Bollinger" />
          <IndicatorToggle active={visible.volume} onClick={() => toggle('volume')} label="Khối lượng" />
          <IndicatorToggle active={visible.momentum} onClick={() => toggle('momentum')} label="RSI / Stoch" />
          <IndicatorToggle active={visible.macd} onClick={() => toggle('macd')} label="MACD" />
        </div>
      </div>

      <div className="technical-panel">
        <span className="technical-panel-label">GIÁ · USD</span>
        <ResponsiveContainer width="100%" height={sizes.price}>
          <ComposedChart data={data} syncId={syncId} margin={{ top: 18, right: 20, bottom: showBrush ? 5 : 2, left: 6 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-dim)', fontSize: 9 }} minTickGap={34} height={showBrush ? 48 : 25} />
            <YAxis yAxisId="price" orientation="right" domain={stats.domain} width={72} tick={{ fill: 'var(--text-sec)', fontSize: 9 }} tickFormatter={value => `$${formatNumber(value, 0)}`} />
            {commonTooltip}
            {visible.bollinger && <Area yAxisId="price" dataKey="bbRange" name="Dải Bollinger" stroke="none" fill="#38BDF8" fillOpacity={.055} connectNulls isAnimationActive={false} />}
            <Bar yAxisId="price" dataKey="candleRange" name="BTC/USDT" barSize={density === 'compact' ? 5 : 7} shape={<CandlestickShape />} isAnimationActive={false} />
            {visible.ema && <>
              <Line yAxisId="price" type="monotone" dataKey="ema20" name="EMA20" stroke={palette.ema20} strokeWidth={1.7} dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="price" type="monotone" dataKey="ema50" name="EMA50" stroke={palette.ema50} strokeWidth={1.55} dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="price" type="monotone" dataKey="ema200" name="EMA200" stroke={palette.ema200} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
            </>}
            {visible.bollinger && <>
              <Line yAxisId="price" type="monotone" dataKey="bbUpper" name="BB Upper" stroke={palette.bbUpper} strokeWidth={1} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="price" type="monotone" dataKey="bbMid" name="BB Mid" stroke={palette.bbMid} strokeWidth={1.2} strokeDasharray="3 2" dot={false} connectNulls isAnimationActive={false} />
              <Line yAxisId="price" type="monotone" dataKey="bbLower" name="BB Lower" stroke={palette.bbLower} strokeWidth={1} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />
            </>}
            <ReferenceLine yAxisId="price" y={stats.resistance} stroke="#F87171" strokeDasharray="4 3" strokeOpacity={.75} label={{ value: `Kháng cự ${formatUSD(stats.resistance)}`, fill: '#F87171', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine yAxisId="price" y={stats.support} stroke="#34D399" strokeDasharray="4 3" strokeOpacity={.75} label={{ value: `Hỗ trợ ${formatUSD(stats.support)}`, fill: '#34D399', fontSize: 9, position: 'insideBottomRight' }} />
            <ReferenceLine yAxisId="price" y={stats.last} stroke="var(--text-dim)" strokeDasharray="2 4" strokeOpacity={.45} />
            {showBrush && <Brush dataKey="time" height={24} travellerWidth={8} stroke="#F7931A" fill="var(--surface-2)" />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {visible.volume && <div className="technical-panel technical-subpanel">
        <span className="technical-panel-label">KHỐI LƯỢNG</span>
        <ResponsiveContainer width="100%" height={sizes.volume}>
          <ComposedChart data={data} syncId={syncId} margin={{ top: 14, right: 20, bottom: 0, left: 6 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" hide />
            <YAxis orientation="right" width={72} tick={{ fill: 'var(--text-dim)', fontSize: 8 }} tickFormatter={value => formatNumber(value, 0)} />
            {commonTooltip}
            <Bar dataKey="volume" name="Khối lượng" shape={<VolumeBarShape />} isAnimationActive={false} />
            <Line type="monotone" dataKey="volMa20" name="Vol MA20" stroke="#A78BFA" strokeWidth={1.2} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>}

      {visible.momentum && <div className="technical-panel technical-subpanel">
        <span className="technical-panel-label">RSI 14 · STOCHASTIC</span>
        <ResponsiveContainer width="100%" height={sizes.momentum}>
          <ComposedChart data={data} syncId={syncId} margin={{ top: 14, right: 20, bottom: 0, left: 6 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" hide />
            <YAxis orientation="right" domain={[0, 100]} ticks={[0, 20, 30, 50, 70, 80, 100]} width={72} tick={{ fill: 'var(--text-dim)', fontSize: 8 }} />
            {commonTooltip}
            <ReferenceLine y={70} stroke="#F87171" strokeDasharray="4 3" strokeOpacity={.55} />
            <ReferenceLine y={30} stroke="#38BDF8" strokeDasharray="4 3" strokeOpacity={.55} />
            <Line type="monotone" dataKey="rsi" name="RSI 14" stroke={palette.rsi} strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="stochK" name="Stoch K" stroke={palette.stochK} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="stochD" name="Stoch D" stroke={palette.stochD} strokeWidth={1.25} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>}

      {visible.macd && <div className="technical-panel technical-subpanel">
        <span className="technical-panel-label">MACD · SIGNAL · HISTOGRAM</span>
        <ResponsiveContainer width="100%" height={sizes.macd}>
          <ComposedChart data={data} syncId={syncId} margin={{ top: 14, right: 20, bottom: 3, left: 6 }}>
            <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: 'var(--text-dim)', fontSize: 8 }} minTickGap={36} />
            <YAxis orientation="right" width={72} tick={{ fill: 'var(--text-dim)', fontSize: 8 }} tickFormatter={value => formatNumber(value, 0)} />
            {commonTooltip}
            <ReferenceLine y={0} stroke="var(--text-dim)" strokeOpacity={.55} />
            <Bar dataKey="macdHist" name="MACD Hist" shape={<MacdBarShape />} isAnimationActive={false} />
            <Line type="monotone" dataKey="macd" name="MACD" stroke={palette.macd} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
            <Line type="monotone" dataKey="signal" name="Signal" stroke={palette.signal} strokeWidth={1.35} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>}
    </div>
  );
}

function CandlestickShape(props: any) {
  const { x, y, width, height, payload } = props;
  if (!payload || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  const high = Number(payload.high);
  const low = Number(payload.low);
  const open = Number(payload.open);
  const close = Number(payload.close);
  const range = high - low;
  if (!Number.isFinite(range) || range <= 0) return null;
  const up = close >= open;
  const color = up ? palette.up : palette.down;
  const center = x + width / 2;
  const topValue = Math.max(open, close);
  const bottomValue = Math.min(open, close);
  const bodyY = y + ((high - topValue) / range) * height;
  const bodyHeight = Math.max(1.5, ((topValue - bottomValue) / range) * height);
  const bodyWidth = Math.max(2.5, width * .78);
  const bodyX = center - bodyWidth / 2;
  return (
    <g>
      <line x1={center} x2={center} y1={y} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyY} width={bodyWidth} height={bodyHeight} rx={.8} fill={color} stroke={color} strokeWidth={.8} />
    </g>
  );
}

function TechnicalTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const details = [
    ['Mở', formatUSD(row.open)], ['Cao', formatUSD(row.high)], ['Thấp', formatUSD(row.low)], ['Đóng', formatUSD(row.close)],
    ['EMA20', row.ema20 == null ? '—' : formatUSD(row.ema20)], ['EMA50', row.ema50 == null ? '—' : formatUSD(row.ema50)],
    ['RSI', row.rsi == null ? '—' : formatNumber(row.rsi, 2)], ['MACD Hist', row.macdHist == null ? '—' : formatNumber(row.macdHist, 2)],
  ];
  return (
    <div className="technical-tooltip">
      <strong>{label}</strong>
      <div className="technical-tooltip-grid">{details.map(([name, value]) => <span key={name}><small>{name}</small><b>{value}</b></span>)}</div>
    </div>
  );
}

function LegendSwatch({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return <span className="technical-legend"><i style={{ borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} />{label}</span>;
}

function IndicatorToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button type="button" className={`technical-toggle ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{active ? '✓ ' : ''}{label}</button>;
}

function DirectionalBarShape(props: any, mode: 'volume' | 'macd') {
  const { x, y, width, height, payload } = props;
  if (![x, y, width, height].every(Number.isFinite) || !payload) return null;
  const positive = mode === 'volume' ? Boolean(payload.up) : Number(payload.macdHist || 0) >= 0;
  return <rect x={x} y={y} width={Math.max(0, width)} height={Math.max(0, height)} rx={1} fill={positive ? palette.up : palette.down} fillOpacity={mode === 'volume' ? .58 : .65} />;
}

function VolumeBarShape(props: any) { return DirectionalBarShape(props, 'volume'); }
function MacdBarShape(props: any) { return DirectionalBarShape(props, 'macd'); }

export default memo(TechnicalAnalysisChart);
