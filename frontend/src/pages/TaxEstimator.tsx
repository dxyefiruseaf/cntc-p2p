import { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import { asNumber, clamp, formatNumber, formatVND } from '../lib/format';
import { Badge, Button, Card, Disclaimer, Input, SectionHeader, Select } from '../components/ui';
import { useToast } from '../context/ToastContext';

type LegalSource = { title?: string; provision?: string; url?: string };
type TaxResult = {
  country?: string;
  gross_amount?: number;
  taxable_base?: string;
  tax_rate_pct?: number;
  tax_amount?: number;
  net_amount?: number;
  formula?: { tax?: string; net?: string; substitution?: string };
  legal_basis?: LegalSource[];
  methodology_note?: string;
  note?: string;
  disclaimer?: string;
};
const presets = [10_000_000, 50_000_000, 100_000_000, 500_000_000];

export default function TaxEstimator() {
  const [country, setCountry] = useState('VN');
  const [amount, setAmount] = useState('100000000');
  const [holdingDays, setHoldingDays] = useState('0');
  const [result, setResult] = useState<TaxResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { showToast } = useToast();

  const calculate = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) { setError('Giá trị phải lớn hơn 0.'); return; }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ amount: String(value), country, holding_days: holdingDays || '0' });
      setResult(await apiRequest<TaxResult>(`/api/tax-estimate?${params}`, { force: true, cacheTtl: 0 }));
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Không thể tính thuế.';
      setError(message);
      showToast(message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void calculate(); }, []);
  const rate = clamp(asNumber(result?.tax_rate_pct), 0, 100);
  const retained = clamp(100 - rate, 0, 100);
  const displayMoney = (value: unknown) => country === 'VN' ? formatVND(value) : `$${formatNumber(value, 2)}`;
  const circumference = 2 * Math.PI * 46;
  const dash = circumference * (rate / 100);
  const flow = useMemo(() => [
    { label: country === 'VN' ? 'Giá trị bán' : 'Lãi vốn giả định', value: displayMoney(result?.gross_amount ?? Number(amount)), color: 'var(--text-main)' },
    { label: 'Thuế dự kiến', value: `− ${displayMoney(result?.tax_amount)}`, color: '#EF4444' },
    { label: 'Còn lại', value: displayMoney(result?.net_amount), color: '#22C55E' },
  ], [result, country, amount]);

  return (
    <div className="page-enter">
      <div className="mb-5"><h1 className="text-xl font-bold">Ước tính thuế có công thức và nguồn</h1><p className="mt-1 text-sm text-[var(--text-sec)]">Mỗi kết quả hiển thị rõ cơ sở tính, phép thế số và văn bản tham chiếu.</p></div>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(340px,.72fr)_minmax(0,1.28fr)]">
        <Card className="tax-card-visual overflow-hidden p-5">
          <SectionHeader title="Thông tin tính toán" sub="Nhập dữ liệu giao dịch để xem ước tính" />
          <div className="space-y-4">
            <Select label="Quốc gia" value={country} onChange={value => { setCountry(value); setResult(null); }} options={[{ value: 'VN', label: 'Việt Nam' }, { value: 'US', label: 'Hoa Kỳ (mô phỏng)' }]} />
            <Input label={country === 'VN' ? 'Giá trị bán (VNĐ)' : 'Lợi nhuận vốn chịu thuế giả định (USD)'} type="number" min="1" value={amount} onChange={event => setAmount(event.target.value)} error={error} prefix={country === 'VN' ? '₫' : '$'} />
            <div><span className="mb-2 block text-xs font-medium text-[var(--text-sec)]">Chọn nhanh</span><div className="flex flex-wrap gap-2">{presets.map(value => <button key={value} onClick={() => setAmount(String(country === 'VN' ? value : Math.round(value / 25_000)))} className="quick-chip">{country === 'VN' ? `${value / 1_000_000} triệu` : `$${formatNumber(value / 25_000, 0)}`}</button>)}</div></div>
            {country === 'US' && <Input label="Số ngày nắm giữ" type="number" min="0" value={holdingDays} onChange={event => setHoldingDays(event.target.value)} hint="Từ 365 ngày trở lên được mô phỏng là dài hạn." suffix="ngày" />}
            <Button className="w-full" loading={loading} onClick={() => void calculate()}>🧮 Tính thuế dự kiến</Button>
          </div>

          <div className="formula-box mt-5">
            <p className="text-xs font-semibold text-[#F7931A]">Công thức đang áp dụng</p>
            <div className="formula-line">{result?.formula?.tax || (country === 'VN' ? 'Thuế TNCN = Giá trị bán × 0,1%' : 'Thuế = Lãi vốn chịu thuế × Thuế suất')}</div>
            <div className="formula-line">{result?.formula?.net || 'Giá trị sau thuế = Cơ sở tính thuế − Thuế dự kiến'}</div>
            {result?.formula?.substitution && <p className="mt-3 text-xs leading-relaxed text-[var(--text-sec)]"><b>Thế số:</b> {result.formula.substitution}</p>}
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="relative overflow-hidden p-5">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#F7931A]/[0.06] blur-3xl" />
            <div className="relative flex flex-wrap items-start justify-between gap-4">
              <SectionHeader title="Kết quả ước tính" sub="Phân bổ trực quan sau khấu trừ thuế" />
              {result && <Badge variant={rate <= 1 ? 'success' : rate <= 15 ? 'warning' : 'danger'}>{result.country}</Badge>}
            </div>
            {!result && loading ? (
              <div className="skeleton h-96 rounded-xl" />
            ) : result ? (
              <div className="relative">
                <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-[220px_1fr]">
                  <div className="flex flex-col items-center">
                    <div className="relative h-48 w-48">
                      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                        <circle cx="60" cy="60" r="46" fill="none" stroke="var(--border)" strokeWidth="10" />
                        <circle cx="60" cy="60" r="46" fill="none" stroke={rate <= 1 ? '#22C55E' : rate <= 15 ? '#F59E0B' : '#EF4444'} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${dash} ${circumference - dash}`} className="tax-ring" />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <strong className="tabular text-3xl">{formatNumber(rate, 2)}%</strong>
                        <span className="text-xs text-[var(--text-sec)]">thuế suất</span>
                      </div>
                    </div>
                    <p className="mt-2 text-center text-xs text-[var(--text-sec)]">Giữ lại khoảng <strong className="text-[#22C55E]">{formatNumber(retained, 2)}%</strong> giá trị</p>
                  </div>
                  <div className="space-y-3">
                    {flow.map((item, index) => (
                      <div key={item.label} className="result-flow-row card-reveal" style={{ animationDelay: `${index * 80}ms` }}>
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-bold text-[var(--text-sec)]">{index + 1}</span>
                        <div className="flex-1"><p className="text-xs text-[var(--text-sec)]">{item.label}</p><strong className="tabular text-lg" style={{ color: item.color }}>{item.value}</strong></div>
                        {index < 2 && <span className="text-[var(--text-dim)]">→</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-6">
                  <div className="mb-2 flex justify-between text-xs"><span className="text-[var(--text-sec)]">Tỷ lệ còn lại sau thuế</span><strong className="text-[#22C55E]">{formatNumber(retained, 2)}%</strong></div>
                  <div className="h-3 overflow-hidden rounded-full bg-[var(--elevated)]"><div className="h-full rounded-full bg-gradient-to-r from-[#22C55E] to-[#3B82F6] transition-[width] duration-700" style={{ width: `${retained}%` }} /></div>
                </div>
                <div className="mt-5 rounded-xl border border-[#3B82F6]/20 bg-[#3B82F6]/[0.055] p-4">
                  <p className="text-xs font-semibold text-[#60A5FA]">Giải thích kết quả</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--text-sec)]">{result.note}</p>
                  {result.methodology_note && <p className="mt-2 text-xs leading-relaxed text-[var(--text-dim)]">{result.methodology_note}</p>}
                </div>
              </div>
            ) : (
              <div className="flex min-h-96 items-center justify-center text-sm text-[var(--text-sec)]">Nhập dữ liệu và nhấn tính để xem kết quả.</div>
            )}
          </Card>

          <Card className="p-5">
            <SectionHeader title="Nguồn pháp lý / phương pháp" sub="Mở văn bản gốc để kiểm tra cơ sở của công thức" />
            <div className="grid gap-3 md:grid-cols-2">{(result?.legal_basis || []).map((source, index) => <div className="legal-source-card" key={`${source.title}-${index}`}><p className="text-xs font-bold text-[var(--text-main)]">{source.title}</p><p className="mt-2 text-xs leading-relaxed text-[var(--text-sec)]">{source.provision}</p>{source.url && <a className="mt-3 inline-block" href={source.url} target="_blank" rel="noreferrer">Mở nguồn chính thức ↗</a>}</div>)}</div>
            {!result?.legal_basis?.length && <p className="text-sm text-[var(--text-sec)]">Nhấn tính để tải công thức và nguồn tham chiếu từ backend.</p>}
          </Card>
        </div>
      </div>
      <div className="mt-5"><Disclaimer text={result?.disclaimer || 'Kết quả chỉ là ước tính tham khảo, không thay thế tư vấn thuế chuyên nghiệp hoặc quy định pháp luật tại thời điểm giao dịch.'} /></div>
    </div>
  );
}
