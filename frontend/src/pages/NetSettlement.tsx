import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import { asNumber, clamp, formatNumber, formatVND } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Input, SectionHeader, Select } from '../components/ui';
import { useToast } from '../context/ToastContext';

type LegalSource = { title?: string; provision?: string; url?: string };
type Settlement = {
  side?: string;
  unit?: string;
  amount_input?: number;
  amount_usdt?: number;
  price_source?: string;
  applied_price?: number;
  applied_price_age_minutes?: number;
  gross_amount_vnd?: number;
  tax?: {
    country?: string;
    tax_rate_pct?: number;
    tax_amount?: number;
    formula?: { tax?: string; net?: string; substitution?: string };
    legal_basis?: LegalSource[];
    methodology_note?: string;
    note?: string;
    disclaimer?: string;
  };
  net_amount_vnd?: number;
  comparison?: { alt_price_source?: string; alt_applied_price?: number; difference_vnd?: number; verdict?: string };
  warnings?: string[];
  source?: { p2p_timestamp?: string; trade_type?: string; p2p_price?: number; market_price?: number };
};

export default function NetSettlement() {
  const [side, setSide] = useState<'sell' | 'buy'>('sell');
  const [unit, setUnit] = useState<'vnd' | 'usdt'>('vnd');
  const [amount, setAmount] = useState('100000000');
  const [priceSource, setPriceSource] = useState<'p2p' | 'market'>('p2p');
  const [country, setCountry] = useState('VN');
  const [holdingDays, setHoldingDays] = useState('0');
  const [result, setResult] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const calculate = async () => {
    const numeric = Number(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) { setError('Số tiền phải lớn hơn 0.'); return; }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ amount: String(numeric), unit, side, price_source: priceSource, country, holding_days: holdingDays || '0' });
      setResult(await apiRequest<Settlement>(`/api/net-settlement?${params}`, { force: true, cacheTtl: 0, timeout: 20_000 }));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể tính thực nhận.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void calculate(); }, []);

  const gross = asNumber(result?.gross_amount_vnd);
  const tax = asNumber(result?.tax?.tax_amount);
  const net = asNumber(result?.net_amount_vnd);
  const retained = gross > 0 ? clamp(net / gross * 100, 0, 100) : 0;
  const difference = asNumber(result?.comparison?.difference_vnd);
  const sourceLabel = result?.price_source === 'p2p' ? 'P2P' : 'Thị trường';
  const steps = useMemo(() => [
    { icon: '①', title: 'Nguồn giá', value: sourceLabel, sub: result?.applied_price ? `${formatVND(result.applied_price)} / USDT` : 'Chưa có dữ liệu' },
    { icon: '②', title: 'Quy đổi', value: formatVND(gross), sub: `${formatNumber(result?.amount_usdt, 4)} USDT` },
    { icon: '③', title: 'Khấu trừ', value: `− ${formatVND(tax)}`, sub: `Thuế ${formatNumber(result?.tax?.tax_rate_pct, 2)}%` },
    { icon: '④', title: 'Thực nhận', value: formatVND(net), sub: `${formatNumber(retained, 2)}% giá trị` },
  ], [result, sourceLabel, gross, tax, net, retained]);
  const presets = unit === 'vnd' ? [10_000_000, 50_000_000, 100_000_000, 500_000_000] : [100, 500, 1_000, 5_000];

  return (
    <div className="page-enter">
      <div className="mb-5"><h1 className="text-xl font-bold">Tính thực nhận có công thức</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Hiển thị toàn bộ bước: nguồn giá, quy đổi, thuế, thực nhận và căn cứ tham chiếu.</p></div>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(350px,.72fr)_minmax(0,1.28fr)]">
        <Card className="settlement-form-card p-5">
          <SectionHeader title="Thiết lập giao dịch" sub="Chọn chiều, số lượng và nguồn giá" />
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--elevated)] p-1.5">
            <button onClick={() => setSide('sell')} className={`trade-side-card ${side === 'sell' ? 'active sell' : ''}`}><span className="text-lg">↓</span><div><strong>Bán USDT</strong><small>Nhận VNĐ</small></div></button>
            <button onClick={() => setSide('buy')} className={`trade-side-card ${side === 'buy' ? 'active buy' : ''}`}><span className="text-lg">↑</span><div><strong>Mua USDT</strong><small>Dùng VNĐ</small></div></button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3"><Select label="Đơn vị nhập" value={unit} onChange={value => { setUnit(value as 'vnd' | 'usdt'); setAmount(value === 'vnd' ? '100000000' : '1000'); }} options={[{ value: 'vnd', label: 'VNĐ' }, { value: 'usdt', label: 'USDT' }]} /><Select label="Nguồn giá" value={priceSource} onChange={value => setPriceSource(value as 'p2p' | 'market')} options={[{ value: 'p2p', label: 'P2P' }, { value: 'market', label: 'Thị trường' }]} /></div>
          <div className="mt-4"><Input label={unit === 'vnd' ? 'Số tiền giao dịch' : 'Số lượng USDT'} type="number" min="1" value={amount} onChange={event => setAmount(event.target.value)} error={error} prefix={unit === 'vnd' ? '₫' : '₮'} /></div>
          <div className="mt-3 flex flex-wrap gap-2">{presets.map(value => <button key={value} onClick={() => setAmount(String(value))} className="quick-chip">{unit === 'vnd' ? `${value / 1_000_000} triệu` : `${formatNumber(value, 0)} USDT`}</button>)}</div>
          <div className="mt-4 grid grid-cols-2 gap-3"><Select label="Quốc gia" value={country} onChange={setCountry} options={[{ value: 'VN', label: 'Việt Nam' }, { value: 'US', label: 'Hoa Kỳ' }]} />{country === 'US' ? <Input label="Ngày nắm giữ" type="number" min="0" value={holdingDays} onChange={event => setHoldingDays(event.target.value)} suffix="ngày" /> : <div className="rounded-lg border border-[var(--border-soft)] bg-[var(--elevated)] p-3 text-xs text-[var(--text-sec)]"><strong className="block text-[var(--text-main)]">Mô hình Việt Nam</strong>0,10% trên giá trị bán; chiều mua có thuế bán bằng 0.</div>}</div>
          <Button className="mt-5 w-full" loading={loading} onClick={() => void calculate()}>⚖ Tính số tiền thực nhận</Button>

          <div className="formula-box mt-5">
            <p className="text-xs font-semibold text-[#F7931A]">Công thức thực nhận</p>
            <div className="formula-line">Giá trị quy đổi = Số lượng USDT × Giá áp dụng</div>
            <div className="formula-line">{result?.tax?.formula?.tax || 'Thuế dự kiến = Cơ sở tính thuế × Thuế suất'}</div>
            <div className="formula-line">{result?.tax?.formula?.net || 'Thực nhận = Giá trị quy đổi − Thuế dự kiến'}</div>
            {result?.tax?.formula?.substitution && <p className="mt-3 text-xs leading-relaxed text-[var(--text-sec)]"><b>Thế số:</b> {result.tax.formula.substitution}</p>}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="relative overflow-hidden p-5">
            <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-[#22C55E]/[0.055] blur-3xl" />
            <div className="relative flex flex-wrap items-start justify-between gap-3"><SectionHeader title="Dòng tiền sau giao dịch" sub="Nguồn giá → Quy đổi → Khấu trừ → Thực nhận" />{result && <Badge variant={result.warnings?.length ? 'warning' : 'success'}>{result.warnings?.length ? 'Cần chú ý' : 'Dữ liệu hợp lệ'}</Badge>}</div>
            {loading && !result ? <div className="skeleton h-96 rounded-xl" /> : result ? (
              <div className="relative">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{steps.map((step, index) => <div key={step.title} className={`settlement-step card-reveal ${index === 3 ? 'final' : ''}`} style={{ animationDelay: `${index * 70}ms` }}><div className="mb-3 flex items-center justify-between"><span className="text-lg text-[#F7931A]">{step.icon}</span>{index < 3 && <span className="text-[var(--text-dim)]">→</span>}</div><p className="text-xs text-[var(--text-sec)]">{step.title}</p><strong className={`mt-1 block tabular text-lg ${index === 3 ? 'text-[#22C55E]' : 'text-[var(--text-main)]'}`}>{step.value}</strong><small className="mt-1 block text-[10px] text-[var(--text-dim)]">{step.sub}</small></div>)}</div>
                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_.8fr]">
                  <div className="rounded-2xl border border-[#22C55E]/25 bg-[#22C55E]/[0.06] p-5"><p className="text-xs uppercase tracking-wider text-[#22C55E]">Số tiền thực nhận ước tính</p><strong className="mt-2 block tabular text-3xl text-[#22C55E]">{formatVND(net)}</strong><div className="mt-4"><div className="mb-2 flex justify-between text-xs"><span className="text-[var(--text-sec)]">Tỷ lệ giữ lại</span><strong>{formatNumber(retained, 2)}%</strong></div><div className="h-3 overflow-hidden rounded-full bg-[var(--elevated)]"><div className="h-full rounded-full bg-[#22C55E] transition-[width] duration-700" style={{ width: `${retained}%` }} /></div></div></div>
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--elevated)] p-5"><p className="text-xs text-[var(--text-sec)]">So với nguồn giá thay thế</p><strong className={`mt-2 block tabular text-2xl ${difference > 0 ? 'text-[#22C55E]' : difference < 0 ? 'text-[#EF4444]' : 'text-[var(--text-main)]'}`}>{difference >= 0 ? '+' : ''}{formatVND(difference)}</strong><p className="mt-2 text-xs leading-relaxed text-[var(--text-sec)]">Nguồn thay thế: <b>{result.comparison?.alt_price_source === 'p2p' ? 'P2P' : 'Thị trường'}</b> · {result.comparison?.alt_applied_price ? formatVND(result.comparison.alt_applied_price) : '—'} / USDT.</p></div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><MiniMetric label="Giá áp dụng" value={formatVND(result.applied_price)} /><MiniMetric label="Tuổi dữ liệu" value={`${formatNumber(result.applied_price_age_minutes, 1)} phút`} /><MiniMetric label="Thuế dự kiến" value={formatVND(tax)} /><MiniMetric label="Chiều giao dịch" value={side === 'sell' ? 'Bán USDT' : 'Mua USDT'} /></div>
                {result.tax?.methodology_note && <div className="mt-4 rounded-xl border border-[#3B82F6]/20 bg-[#3B82F6]/[0.055] p-3 text-xs leading-relaxed text-[var(--text-sec)]"><b>Phương pháp:</b> {result.tax.methodology_note}</div>}
                {result.warnings?.map(warning => <div key={warning} className="mt-4 rounded-xl border border-[#F59E0B]/25 bg-[#F59E0B]/[0.06] p-3 text-xs text-[#F59E0B]">⚠ {warning}</div>)}
              </div>
            ) : <div className="flex min-h-96 items-center justify-center text-sm text-[var(--text-sec)]">Nhập thông tin để xem luồng thực nhận.</div>}
          </Card>

          <Card className="p-5">
            <SectionHeader title="Nguồn của công thức" sub="Văn bản pháp lý hoặc tài liệu phương pháp đang được mô hình tham chiếu" />
            <div className="grid gap-3 md:grid-cols-2">{(result?.tax?.legal_basis || []).map((source, index) => <div className="legal-source-card" key={`${source.title}-${index}`}><p className="text-xs font-bold text-[var(--text-main)]">{source.title}</p><p className="mt-2 text-xs leading-relaxed text-[var(--text-sec)]">{source.provision}</p>{source.url && <a className="mt-3 inline-block" href={source.url} target="_blank" rel="noreferrer">Mở nguồn chính thức ↗</a>}</div>)}</div>
            {!result?.tax?.legal_basis?.length && <p className="text-sm text-[var(--text-sec)]">Nhấn tính để tải nguồn tham chiếu.</p>}
          </Card>
        </div>
      </div>
      <div className="mt-5"><Disclaimer text={result?.tax?.disclaimer || 'Công cụ chỉ mô phỏng giá P2P, tỷ giá tham chiếu và thuế. Không thay thế tư vấn tài chính, pháp lý hoặc thuế.'} /></div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--elevated)] p-3"><span className="text-[10px] text-[var(--text-sec)]">{label}</span><strong className="mt-1 block tabular text-sm">{value}</strong></div>; }
