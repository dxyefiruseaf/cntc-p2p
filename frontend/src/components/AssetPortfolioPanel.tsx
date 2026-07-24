import { asNumber, formatNumber, formatPercent, formatVND } from '../lib/format';
import { Badge, Card } from './ui';

type AssetRecord = Record<string, unknown> | null | undefined;

type Props = {
  wallet?: AssetRecord;
  portfolio?: AssetRecord;
  valuation?: AssetRecord;
  btcPriceVnd?: number;
  title?: string;
  subtitle?: string;
  className?: string;
};

export default function AssetPortfolioPanel({
  wallet,
  portfolio,
  valuation,
  btcPriceVnd,
  title = 'Tổng quan tài sản demo',
  subtitle = 'Số dư VNĐ và lượng Bitcoin đang nắm giữ được cập nhật sau mỗi lệnh.',
  className = '',
}: Props) {
  const cash = asNumber(valuation?.cash_vnd, asNumber(wallet?.balance_vnd));
  const position = asNumber(valuation?.position_btc, asNumber(portfolio?.position_btc));
  const referencePrice = asNumber(btcPriceVnd, asNumber(valuation?.btc_price_vnd));
  const btcValue = asNumber(valuation?.btc_market_value_vnd, position * referencePrice);
  const equity = asNumber(valuation?.total_equity_vnd, cash + btcValue);
  const costBasis = asNumber(valuation?.cost_basis_vnd, asNumber(portfolio?.cost_basis_vnd));
  const avgEntry = asNumber(valuation?.avg_entry_vnd, asNumber(portfolio?.avg_entry_vnd));
  const realizedPnl = asNumber(valuation?.realized_pnl_vnd, asNumber(portfolio?.realized_pnl_vnd));
  const unrealizedPnl = asNumber(valuation?.unrealized_pnl_vnd, btcValue - costBasis);
  const unrealizedPct = costBasis > 0
    ? asNumber(valuation?.unrealized_pnl_pct, unrealizedPnl / costBasis * 100)
    : 0;
  const allocation = equity > 0
    ? asNumber(valuation?.btc_allocation_pct, btcValue / equity * 100)
    : 0;
  const pnlPositive = unrealizedPnl >= 0;

  return (
    <Card className={`overflow-hidden p-0 ${className}`}>
      <div className="border-b border-[var(--border-soft)] bg-[var(--surface-2)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F7931A]">Tài sản Sandbox</p>
            <h2 className="mt-1 text-lg font-bold">{title}</h2>
            <p className="mt-1 text-xs text-[var(--text-sec)]">{subtitle}</p>
          </div>
          <Badge variant="warning">Không phải tài sản thật</Badge>
        </div>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-xs text-[var(--text-sec)]">Tổng tài sản ước tính</span>
            <p className="mt-1 tabular text-3xl font-black text-[#F7931A]">{formatVND(equity)}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-[var(--text-sec)]">Tỷ trọng BTC</span>
            <p className="mt-1 tabular text-lg font-bold">{formatNumber(allocation, 2)}%</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[var(--border-soft)] sm:grid-cols-4">
        <AssetMetric label="Tiền mặt khả dụng" value={formatVND(cash)} note="Số dư ví VNĐ" />
        <AssetMetric label="BTC đang nắm giữ" value={`${formatNumber(position, 8)} BTC`} note="Cập nhật sau BUY/SELL" emphasis />
        <AssetMetric label="Giá trị BTC tạm tính" value={referencePrice > 0 ? formatVND(btcValue) : 'Chưa có giá'} note={referencePrice > 0 ? `1 BTC ≈ ${formatVND(referencePrice)}` : 'Đang chờ dữ liệu giá'} />
        <AssetMetric label="Giá vốn BTC" value={formatVND(costBasis)} note={avgEntry > 0 ? `Bình quân ${formatVND(avgEntry)}/BTC` : 'Chưa có vị thế mua'} />
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <PnlRow
          label="Lãi/lỗ chưa chốt"
          value={`${formatVND(unrealizedPnl)} (${formatPercent(unrealizedPct)})`}
          positive={pnlPositive}
        />
        <PnlRow
          label="Lãi/lỗ đã chốt"
          value={formatVND(realizedPnl)}
          positive={realizedPnl >= 0}
        />
      </div>
    </Card>
  );
}

function AssetMetric({ label, value, note, emphasis = false }: { label: string; value: string; note: string; emphasis?: boolean }) {
  return (
    <div className="min-w-0 bg-[var(--surface)] p-4">
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-sec)]">{label}</p>
      <strong className={`mt-1 block break-words tabular text-sm sm:text-base ${emphasis ? 'text-[#F7931A]' : ''}`}>{value}</strong>
      <small className="mt-1 block text-[10px] text-[var(--text-dim)]">{note}</small>
    </div>
  );
}

function PnlRow({ label, value, positive }: { label: string; value: string; positive: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${positive ? 'border-[#22C55E]/25 bg-[#22C55E]/[0.06]' : 'border-[#EF4444]/25 bg-[#EF4444]/[0.06]'}`}>
      <span className="text-xs text-[var(--text-sec)]">{label}</span>
      <strong className={`mt-1 block tabular text-sm ${positive ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>{value}</strong>
    </div>
  );
}
