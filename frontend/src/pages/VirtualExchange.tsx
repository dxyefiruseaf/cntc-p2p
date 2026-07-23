import { useEffect, useState } from 'react';
import { apiRequest, clearApiCache } from '../lib/api';
import { asNumber, formatDateTime, formatNumber, formatUSD, formatVND } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, Disclaimer, Input, SectionHeader, Select, Skeleton } from '../components/ui';
import { ErrorState } from '../components/Feedback';
import TechnicalAnalysisChart from '../components/TechnicalAnalysisChart';

type Trade = Record<string, unknown>;
type Terminal = {
  latest?: Record<string, unknown>;
  ohlcv?: { data?: Array<Record<string, unknown>> };
  p2p?: { buy?: Record<string, unknown>; sell?: Record<string, unknown> };
  risk?: Record<string, unknown>;
  wallet?: Record<string, unknown>;
  portfolio?: Record<string, unknown>;
  trades?: { data?: Trade[]; count?: number };
  source?: string;
};
type TradeResponse = Trade & { wallet?: Record<string, unknown>; portfolio?: Record<string, unknown> };

export default function VirtualExchange() {
  const { showToast } = useToast();
  const [data, setData] = useState<Terminal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [inputUnit, setInputUnit] = useState<'VND' | 'BTC'>('VND');
  const [amount, setAmount] = useState('5000000');
  const [priceSource, setPriceSource] = useState<'p2p' | 'market'>('p2p');
  const [executing, setExecuting] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);

  const load = async (force = false, silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      setData(await apiRequest<Terminal>('/api/demo-trades/terminal?hours=168&limit=20', { force, cacheTtl: 8_000, timeout: 22_000 }));
    } catch (reason) {
      if (!silent) setError(reason instanceof Error ? reason.message : 'Không thể tải terminal.');
    } finally {
      if (!silent) setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const latest = data?.latest || {};
  const rows = data?.ohlcv?.data || [];
  const btcUsd = asNumber(latest.close);
  const buyRate = asNumber(data?.p2p?.buy?.p2p_price);
  const sellRate = asNumber(data?.p2p?.sell?.p2p_price);
  const marketRate = asNumber(data?.p2p?.buy?.market_price || data?.p2p?.sell?.market_price);
  const selectedRate = priceSource === 'market' ? marketRate : side === 'BUY' ? buyRate : sellRate;
  const btcVnd = btcUsd * selectedRate;
  const numericAmount = asNumber(amount);
  const amountVnd = inputUnit === 'VND' ? numericAmount : numericAmount * btcVnd;
  const amountBtc = inputUnit === 'BTC' ? numericAmount : btcVnd > 0 ? numericAmount / btcVnd : 0;
  const walletBalance = asNumber(data?.wallet?.balance_vnd);
  const position = asNumber(data?.portfolio?.position_btc);
  const enough = side === 'BUY' ? walletBalance >= amountVnd : position >= amountBtc;
  const equity = walletBalance + position * btcVnd;

  const switchUnit = () => {
    if (inputUnit === 'VND') {
      setInputUnit('BTC');
      setAmount(amountBtc > 0 ? amountBtc.toFixed(8) : '0');
    } else {
      setInputUnit('VND');
      setAmount(amountVnd > 0 ? String(Math.round(amountVnd)) : '0');
    }
  };

  const execute = async () => {
    if (!enough || amountBtc <= 0 || amountVnd <= 0 || executing) return;
    setExecuting(true);
    try {
      const result = await apiRequest<TradeResponse>('/api/demo-trades', {
        method: 'POST',
        body: { side, amount_vnd: amountVnd, amount_btc: amountBtc, amount_usdt: amountBtc, price_source: priceSource, applied_price: btcVnd },
        timeout: 25_000,
      });
      const createdTrade: Trade = {
        ...result,
        side: result.side || side.toLowerCase(),
        amount_vnd: result.amount_vnd || amountVnd,
        amount_btc: result.amount_btc || result.amount_usdt || amountBtc,
        amount_usdt: result.amount_usdt || amountBtc,
        applied_price: result.applied_price || btcVnd,
        price_source: result.price_source || priceSource,
        created_at: result.created_at || new Date().toISOString(),
      };

      setData(current => {
        if (!current) return current;
        const oldTrades = current.trades?.data || [];
        const createdId = String(createdTrade.id || '');
        const oldBalance = asNumber(current.wallet?.balance_vnd);
        const oldPosition = asNumber(current.portfolio?.position_btc);
        const oldAverage = asNumber(current.portfolio?.avg_entry_vnd);
        const fallbackWallet = {
          ...current.wallet,
          balance_vnd: Math.max(0, oldBalance + (side === 'BUY' ? -amountVnd : amountVnd)),
        };
        const fallbackPortfolio = {
          ...current.portfolio,
          position_btc: Math.max(0, oldPosition + (side === 'BUY' ? amountBtc : -amountBtc)),
          avg_entry_vnd: side === 'BUY' && oldPosition + amountBtc > 0
            ? ((oldPosition * oldAverage) + amountVnd) / (oldPosition + amountBtc)
            : oldAverage,
          realized_pnl_vnd: side === 'SELL'
            ? asNumber(current.portfolio?.realized_pnl_vnd) + (amountVnd - oldAverage * amountBtc)
            : asNumber(current.portfolio?.realized_pnl_vnd),
        };
        return {
          ...current,
          wallet: result.wallet || fallbackWallet,
          portfolio: result.portfolio || fallbackPortfolio,
          trades: {
            ...current.trades,
            count: (current.trades?.count || oldTrades.length) + 1,
            data: [createdTrade, ...oldTrades.filter(item => !createdId || String(item.id || '') !== createdId)].slice(0, 20),
          },
        };
      });
      setSelectedTrade(createdTrade);
      clearApiCache('/api/demo-trades');
      clearApiCache('/api/wallet');
      showToast(`Đã khớp lệnh ${side} ${formatNumber(amountBtc, 8)} BTC demo. Số dư đã cập nhật.`, 'success');
      void load(true, true);
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : 'Không thể đặt lệnh.', 'error');
    } finally {
      setExecuting(false);
    }
  };

  const presets = inputUnit === 'VND' ? [1_000_000, 5_000_000, 10_000_000, 50_000_000] : [0.0001, 0.001, 0.005, 0.01];
  if (error && !data) return <ErrorState message={error} onRetry={() => void load(true)} />;

  return (
    <div className="page-enter">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-xl font-bold">Sàn giao dịch Bitcoin demo</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Mua/bán BTC, quy đổi BTC ↔ VNĐ và cập nhật ví ngay sau khi khớp lệnh.</p></div>
        <Badge variant="warning">Sandbox Only</Badge>
      </div>

      <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Metric label="BTC/USDT" value={formatUSD(btcUsd)} />
        <Metric label="1 BTC quy đổi" value={btcVnd ? formatVND(btcVnd) : '—'} />
        <Metric label="P2P BUY / SELL" value={`${buyRate ? formatVND(buyRate) : '—'} / ${sellRate ? formatVND(sellRate) : '—'}`} />
        <Metric label="Risk Score" value={`${Math.round(asNumber(data?.risk?.score))}/100`} />
        <Metric label="Ví khả dụng" value={formatVND(walletBalance)} />
        <Metric label="Equity ước tính" value={formatVND(equity)} />
      </section>

      <section className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_390px]">
        <Card className="min-w-0 p-4">
          <div className="mb-3 flex items-center justify-between gap-3"><SectionHeader title="BTC/USDT · 7 ngày" sub={`${rows.length} nến · OHLCV, EMA, Bollinger, RSI, Stochastic và MACD`} /><Button variant="ghost" size="sm" onClick={() => void load(true)}>↻ Làm mới</Button></div>
          {loading && !rows.length ? <Skeleton className="h-[760px] rounded-xl" /> : <TechnicalAnalysisChart rows={rows} density="standard" showBrush />}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><MiniMetric label="RSI 14" value={latest.rsi_14 == null ? '—' : formatNumber(latest.rsi_14, 2)} /><MiniMetric label="MACD Hist" value={latest.macd_hist == null ? '—' : formatNumber(latest.macd_hist, 2)} /><MiniMetric label="EMA20 / EMA50" value={`${formatNumber(latest.ema_20, 0)} / ${formatNumber(latest.ema_50, 0)}`} /><MiniMetric label="Volume" value={formatNumber(latest.volume, 2)} /></div>
        </Card>

        <div className="flex flex-col gap-4 xl:sticky xl:top-24">
          <Card className="p-5">
            <SectionHeader title="Đặt lệnh mua / bán" sub="Nhập VNĐ hoặc BTC; hệ thống tự quy đổi hai chiều" />
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-[var(--elevated)] p-1.5"><button onClick={() => setSide('BUY')} className={`trade-toggle buy ${side === 'BUY' ? 'active' : ''}`}>Mua BTC</button><button onClick={() => setSide('SELL')} className={`trade-toggle sell ${side === 'SELL' ? 'active' : ''}`}>Bán BTC</button></div>

            <div className="trade-converter">
              <div className="trade-converter-row">
                <Input label={inputUnit === 'VND' ? 'Bạn nhập số tiền' : 'Bạn nhập khối lượng'} type="number" min="0" step={inputUnit === 'VND' ? '10000' : '0.00000001'} value={amount} onChange={event => setAmount(event.target.value)} prefix={inputUnit === 'VND' ? '₫' : undefined} suffix={inputUnit === 'BTC' ? 'BTC' : undefined} />
                <button type="button" className="trade-swap-btn" onClick={switchUnit} title="Đổi đơn vị nhập">⇄</button>
              </div>
              <div className="trade-converter-readonly mt-3"><small>Quy đổi sang {inputUnit === 'VND' ? 'BTC' : 'VNĐ'}</small><strong>{inputUnit === 'VND' ? `${formatNumber(amountBtc, 8)} BTC` : formatVND(amountVnd)}</strong></div>
              <p className="mt-2 text-[10px] text-[var(--text-dim)]">1 BTC = {btcVnd ? formatVND(btcVnd) : '—'} theo nguồn giá đã chọn.</p>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">{presets.map(value => <button key={value} onClick={() => setAmount(String(value))} className="quick-chip">{inputUnit === 'VND' ? `${Number(value) / 1_000_000} triệu` : `${formatNumber(value, 4)} BTC`}</button>)}</div>
            <div className="mt-4"><Select label="Nguồn tỷ giá" value={priceSource} onChange={value => setPriceSource(value as 'p2p' | 'market')} options={[{ value: 'p2p', label: 'P2P USDT/VNĐ' }, { value: 'market', label: 'Giá quốc tế quy đổi' }]} /></div>
            <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-4">
              <div className="space-y-2"><OrderRow label="Giá BTC áp dụng" value={btcVnd ? formatVND(btcVnd) : '—'} /><OrderRow label="Giá trị lệnh" value={formatVND(amountVnd)} /><OrderRow label="Khối lượng lệnh" value={`${formatNumber(amountBtc, 8)} BTC`} /><OrderRow label={side === 'BUY' ? 'Số dư ví' : 'BTC đang giữ'} value={side === 'BUY' ? formatVND(walletBalance) : `${formatNumber(position, 8)} BTC`} /></div>
              <div className={`mt-3 rounded-lg p-2.5 text-xs ${enough ? 'bg-[#22C55E]/[0.08] text-[#22C55E]' : 'bg-[#EF4444]/[0.08] text-[#EF4444]'}`}>{enough ? '✓ Đủ điều kiện đặt lệnh demo.' : side === 'BUY' ? 'Không đủ số dư ví. Hãy nạp thêm tiền demo.' : 'Không đủ BTC mô phỏng để bán.'}</div>
            </div>
            <Button className="mt-4 w-full" loading={executing} disabled={!enough || amountBtc <= 0 || amountVnd <= 0} onClick={() => void execute()}>{side === 'BUY' ? 'Mua BTC demo' : 'Bán BTC demo'}</Button>
          </Card>

          <Card className="p-4"><SectionHeader title="Danh mục sau giao dịch" /><div className="space-y-2"><OrderRow label="BTC đang nắm giữ" value={`${formatNumber(position, 8)} BTC`} /><OrderRow label="Giá vốn bình quân" value={data?.portfolio?.avg_entry_vnd ? formatVND(data.portfolio.avg_entry_vnd) : '—'} /><OrderRow label="Lãi/lỗ đã chốt" value={formatVND(data?.portfolio?.realized_pnl_vnd)} color={asNumber(data?.portfolio?.realized_pnl_vnd) >= 0 ? '#22C55E' : '#EF4444'} /></div></Card>
        </div>
      </section>

      <Card className="mt-5 p-4">
        <SectionHeader title="Lịch sử giao dịch gần đây" sub="Bấm Xem hóa đơn để mở đầy đủ thời gian, lệnh, số tiền và tỷ giá" />
        <div className="overflow-x-auto"><table className="data-table"><thead><tr><th>Thời gian</th><th>Chiều</th><th>Số tiền</th><th>Khối lượng BTC</th><th>Giá áp dụng</th><th>Nguồn giá</th><th>Chi tiết</th></tr></thead><tbody>{(data?.trades?.data || []).map((trade, index) => <tr key={String(trade.id || index)}><td>{formatDateTime(trade.created_at)}</td><td><Badge variant={String(trade.side).toUpperCase() === 'BUY' ? 'success' : 'danger'}>{String(trade.side).toUpperCase()}</Badge></td><td className="tabular">{formatVND(trade.amount_vnd)}</td><td className="tabular">{formatNumber(trade.amount_btc || trade.amount_usdt, 8)}</td><td className="tabular">{formatVND(trade.applied_price)}</td><td>{String(trade.price_source || 'p2p').toUpperCase()}</td><td><button type="button" className="quick-chip" onClick={() => setSelectedTrade(trade)}>Xem hóa đơn</button></td></tr>)}</tbody></table>{!(data?.trades?.data || []).length && <p className="py-8 text-center text-sm text-[var(--text-sec)]">Chưa có giao dịch demo.</p>}</div>
      </Card>
      <div className="mt-5"><Disclaimer text="Mọi số dư, vị thế và lệnh trên trang này là mô phỏng phục vụ học tập. Không có tài sản hoặc tiền thật được giao dịch." /></div>

      {selectedTrade && <TradeReceipt trade={selectedTrade} onClose={() => setSelectedTrade(null)} />}
    </div>
  );
}

function TradeReceipt({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const side = String(trade.side || '').toUpperCase();
  return (
    <div className="receipt-modal-backdrop" role="dialog" aria-modal="true" aria-label="Chi tiết giao dịch" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="trade-receipt modal-in">
        <div className="trade-receipt-head"><span className="text-3xl">₿</span><h2 className="mt-2 text-lg font-black">HÓA ĐƠN GIAO DỊCH DEMO</h2><p className="mt-1 text-xs text-[var(--text-sec)]">BTC BigData Platform · Sandbox</p></div>
        <div className="trade-receipt-body">
          <ReceiptRow label="Mã giao dịch" value={String(trade.id || 'Đang đồng bộ')} />
          <ReceiptRow label="Thời gian" value={formatDateTime(trade.created_at)} />
          <ReceiptRow label="Loại lệnh" value={side === 'BUY' ? 'MUA BTC' : 'BÁN BTC'} />
          <ReceiptRow label="Nguồn giá" value={String(trade.price_source || 'p2p').toUpperCase()} />
          <ReceiptRow label="Giá BTC áp dụng" value={formatVND(trade.applied_price)} />
          <ReceiptRow label="Khối lượng" value={`${formatNumber(trade.amount_btc || trade.amount_usdt, 8)} BTC`} />
          <div className="receipt-total"><ReceiptRow label={side === 'BUY' ? 'TỔNG THANH TOÁN' : 'TỔNG THỰC NHẬN'} value={formatVND(trade.amount_vnd)} /></div>
          <p className="mt-4 text-center text-[10px] leading-relaxed text-[var(--text-dim)]">Biên nhận này chỉ xác nhận giao dịch mô phỏng, không có giá trị thanh toán hoặc kế toán.</p>
          <Button className="mt-4 w-full" variant="secondary" onClick={onClose}>Đóng hóa đơn</Button>
        </div>
      </div>
    </div>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) { return <div className="receipt-row"><span>{label}</span><strong>{value}</strong></div>; }
function Metric({ label, value }: { label: string; value: string }) { return <Card className="p-3"><p className="text-[10px] uppercase tracking-wider text-[var(--text-sec)]">{label}</p><strong className="mt-1 block truncate tabular text-sm">{value}</strong></Card>; }
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--elevated)] p-3"><span className="text-[10px] text-[var(--text-sec)]">{label}</span><strong className="mt-1 block tabular text-sm">{value}</strong></div>; }
function OrderRow({ label, value, color }: { label: string; value: string; color?: string }) { return <div className="flex items-center justify-between gap-3"><span className="text-xs text-[var(--text-sec)]">{label}</span><strong className="tabular text-sm" style={{ color: color || 'var(--text-main)' }}>{value}</strong></div>; }
