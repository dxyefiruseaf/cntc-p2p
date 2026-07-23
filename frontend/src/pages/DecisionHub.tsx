import { useMemo, useState } from 'react';
import { apiRequest } from '../lib/api';
import { asNumber, formatNumber, formatPercent, formatUSD, formatVND } from '../lib/format';
import { useMarket } from '../context/MarketContext';
import { useToast } from '../context/ToastContext';
import { Badge, Button, Card, Disclaimer, RiskMeter, SectionHeader } from '../components/ui';

type AIAnswer = {
  verdict?: string;
  confidence?: number;
  answer?: string;
  reasons?: string[];
  risks?: string[];
  suggested_action?: string;
  disclaimer?: string;
  risk_score?: number;
  risk_level?: string;
};

const prompts = [
  'Giờ nên mua hay bán BTC?',
  'Giải thích RSI và MACD hiện tại',
  'Tôi muốn mua BTC bằng 5 triệu, hãy nêu rủi ro',
  'P2P hiện tại đang lợi hay thiệt?',
];

export default function DecisionHub() {
  const market = useMarket();
  const { showToast } = useToast();
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState<AIAnswer | null>(null);
  const [loading, setLoading] = useState(false);

  const latest = market.latest;
  const verdict = String(market.data?.summary?.overall?.verdict || 'NEUTRAL').toUpperCase();
  const risk = asNumber(market.data?.risk?.score);
  const current = asNumber(latest.close);
  const buy = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'BUY');
  const sell = market.p2pRows.find(row => String(row.trade_type).toUpperCase() === 'SELL');
  const confidence = Math.round(Math.max(50, Math.min(92, 50 + Math.abs(asNumber(latest.macd_hist)) / Math.max(1, current) * 10000 + Math.abs(asNumber(latest.rsi_14) - 50) / 3)));

  const indicators = useMemo(() => [
    { name: 'RSI 14', value: latest.rsi_14 == null ? '—' : formatNumber(latest.rsi_14, 2), state: asNumber(latest.rsi_14) > 70 ? 'Quá mua' : asNumber(latest.rsi_14) < 30 ? 'Quá bán' : 'Trung lập', tone: asNumber(latest.rsi_14) > 70 ? 'danger' : asNumber(latest.rsi_14) < 30 ? 'success' : 'neutral' },
    { name: 'MACD Histogram', value: latest.macd_hist == null ? '—' : formatNumber(latest.macd_hist, 2), state: asNumber(latest.macd_hist) >= 0 ? 'Động lượng dương' : 'Động lượng âm', tone: asNumber(latest.macd_hist) >= 0 ? 'success' : 'danger' },
    { name: 'EMA20 / EMA50', value: `${formatNumber(latest.ema_20, 0)} / ${formatNumber(latest.ema_50, 0)}`, state: asNumber(latest.ema_20) >= asNumber(latest.ema_50) ? 'Xu hướng tăng' : 'Xu hướng giảm', tone: asNumber(latest.ema_20) >= asNumber(latest.ema_50) ? 'success' : 'danger' },
    { name: 'P2P BUY / SELL', value: `${buy?.p2p_price ? formatVND(buy.p2p_price) : '—'} / ${sell?.p2p_price ? formatVND(sell.p2p_price) : '—'}`, state: 'USDT/VNĐ', tone: 'info' },
  ], [latest, buy, sell]);

  const ask = async (text = question) => {
    const value = text.trim();
    if (!value || loading) return;
    setQuestion(value);
    setLoading(true);
    setResponse(null);
    try {
      const data = await apiRequest<AIAnswer>('/api/ai/ask', { method: 'POST', body: { question: value, risk_profile: 'moderate' }, timeout: 35_000 });
      setResponse(data);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Không thể kết nối AI.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-enter">
      <section className="decision-hero mb-5 overflow-hidden rounded-2xl border border-[var(--border-soft)] p-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_.7fr]">
          <div>
            <div className="mb-3 flex flex-wrap gap-2"><Badge variant="violet">AI Decision Support</Badge><Badge variant={verdict === 'BUY' ? 'success' : verdict === 'SELL' ? 'danger' : 'neutral'}>{verdict === 'BUY' ? 'MUA' : verdict === 'SELL' ? 'BÁN' : 'TRUNG LẬP'}</Badge><Badge variant="warning">Risk {Math.round(risk)}/100</Badge></div>
            <h1 className="text-2xl font-bold text-[var(--text-main)]">Decision Hub</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[var(--text-sec)]">Tổng hợp dữ liệu kỹ thuật, P2P, rủi ro và giải thích AI thành một luồng hỗ trợ quyết định. Hệ thống không tự đặt lệnh và không thay thế đánh giá của người dùng.</p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Metric label="BTC/USDT" value={formatUSD(current)} /><Metric label="Độ tin cậy" value={`${confidence}%`} /><Metric label="Risk Score" value={`${Math.round(risk)}/100`} /><Metric label="Xu hướng" value={verdict} /></div>
          </div>
          <Card className="flex items-center justify-around p-4">
            <RiskMeter score={risk} />
            <div className="h-20 w-px bg-[var(--border-soft)]" />
            <div className="text-center"><p className="text-xs text-[var(--text-sec)]">Tín hiệu tổng hợp</p><strong className={`mt-2 block text-3xl ${verdict === 'BUY' ? 'text-[#22C55E]' : verdict === 'SELL' ? 'text-[#EF4444]' : 'text-[var(--text-main)]'}`}>{verdict === 'BUY' ? 'MUA' : verdict === 'SELL' ? 'BÁN' : 'CHỜ'}</strong><p className="mt-1 text-[10px] text-[var(--text-dim)]">Dựa trên rule-based signals</p></div>
          </Card>
        </div>
      </section>

      <section className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-[1fr_360px]">
        <Card className="p-5">
          <SectionHeader title="Bảng tín hiệu quyết định" sub="Đọc nhanh trạng thái từng nhóm dữ liệu" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{indicators.map((item, index) => <article key={item.name} className="card-reveal rounded-xl border border-[var(--border-soft)] bg-[var(--elevated)] p-4" style={{ animationDelay: `${index * 55}ms` }}><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-[var(--text-sec)]">{item.name}</p><strong className="mt-1 block tabular text-lg">{item.value}</strong></div><Badge variant={item.tone as 'success' | 'danger' | 'neutral' | 'info'}>{item.state}</Badge></div></article>)}</div>
          <div className="mt-4 rounded-xl border border-[#F7931A]/18 bg-[#F7931A]/[0.055] p-4"><h3 className="text-sm font-semibold text-[#F7931A]">Kế hoạch tham khảo</h3><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"><PlanStep index="01" title="Quy mô vị thế" text={risk >= 60 ? 'Ưu tiên vị thế nhỏ, tránh dùng đòn bẩy.' : 'Có thể chia nhỏ vốn thay vì vào lệnh một lần.'} /><PlanStep index="02" title="Điều kiện vào lệnh" text="Chờ xác nhận thêm từ EMA, MACD và khối lượng." /><PlanStep index="03" title="Quản trị rủi ro" text="Xác định mức dừng lỗ và số vốn chấp nhận mất trước khi đặt lệnh." /></div></div>
        </Card>
        <Card className="p-5">
          <SectionHeader title="Bối cảnh P2P" sub="Chi phí quy đổi cho người dùng Việt Nam" />
          <div className="space-y-3"><MetricRow label="P2P BUY" value={buy?.p2p_price ? formatVND(buy.p2p_price) : '—'} color="#22C55E" /><MetricRow label="P2P SELL" value={sell?.p2p_price ? formatVND(sell.p2p_price) : '—'} color="#EF4444" /><MetricRow label="Spread BUY" value={buy?.spread_pct == null ? '—' : formatPercent(buy.spread_pct, 3)} /><MetricRow label="Spread SELL" value={sell?.spread_pct == null ? '—' : formatPercent(sell.spread_pct, 3)} /></div>
          <div className="mt-4 rounded-xl bg-[var(--elevated)] p-3 text-xs leading-relaxed text-[var(--text-sec)]">P2P có thể ảnh hưởng đáng kể đến giá mua/bán thực tế. Luôn so sánh nguồn giá trước khi mô phỏng giao dịch.</div>
        </Card>
      </section>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><Badge variant="violet">AI Trade Explanation</Badge><h2 className="mt-2 text-lg font-semibold">Nhờ AI giải thích theo câu hỏi của bạn</h2><p className="mt-1 text-xs text-[var(--text-sec)]">AI sử dụng dữ liệu backend hiện tại và trả lời theo đúng chủ đề được hỏi.</p></div>{response?.verdict && <Badge variant={response.verdict === 'BUY' ? 'success' : response.verdict === 'SELL' ? 'danger' : 'neutral'}>{response.verdict} · {response.confidence || 50}%</Badge>}</div>
        <div className="mb-3 flex flex-wrap gap-2">{prompts.map(item => <button key={item} onClick={() => void ask(item)} className="rounded-lg border border-[#8B5CF6]/25 bg-[#8B5CF6]/10 px-3 py-1.5 text-xs text-[#A78BFA] hover:bg-[#8B5CF6]/20">{item}</button>)}</div>
        <textarea value={question} onChange={event => setQuestion(event.target.value)} placeholder="VD: Tôi muốn mua BTC bằng 5 triệu hôm nay, hãy giải thích rủi ro và kế hoạch tham khảo." rows={3} className="w-full resize-y rounded-xl border border-[var(--border)] bg-[var(--elevated)] px-4 py-3 text-sm text-[var(--text-main)] outline-none placeholder:text-[var(--text-dim)] focus:border-[#8B5CF6] focus:ring-2 focus:ring-[#8B5CF6]/15" />
        <Button onClick={() => void ask()} loading={loading} className="mt-3 w-full bg-[#8B5CF6] text-white hover:bg-[#7C3AED] border-[#8B5CF6]">✨ Nhờ AI giải thích</Button>
        {loading && <div className="mt-4 rounded-xl border border-[#8B5CF6]/20 bg-[var(--elevated)] p-4"><p className="mb-3 text-xs text-[#A78BFA]">AI đang phân tích dữ liệu...</p>{[82, 70, 88, 58].map(width => <div key={width} className="skeleton mb-2 h-3 rounded" style={{ width: `${width}%` }} />)}</div>}
        {response && !loading && <div className="modal-in mt-4 rounded-xl border border-[#8B5CF6]/22 bg-[var(--elevated)] p-4"><div className="flex items-center justify-between"><strong className="text-xs text-[#A78BFA]">Phản hồi AI</strong><button onClick={() => void navigator.clipboard?.writeText(response.answer || '')} className="text-xs text-[var(--text-sec)] hover:text-[#A78BFA]">📋 Sao chép</button></div><p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-[var(--text-main)]">{response.answer}</p>{response.reasons?.length ? <div className="mt-4"><p className="text-xs font-semibold text-[var(--text-sec)]">Lý do chính</p><ul className="mt-2 space-y-1 text-xs text-[var(--text-sec)]">{response.reasons.map(reason => <li key={reason}>• {reason}</li>)}</ul></div> : null}{response.suggested_action && <div className="mt-4 rounded-lg bg-[#22C55E]/[0.06] p-3 text-xs text-[#22C55E]">Gợi ý: {response.suggested_action}</div>}</div>}
        <div className="mt-4"><Disclaimer text={response?.disclaimer || 'Phân tích AI chỉ mang tính tham khảo dựa trên dữ liệu sandbox. Không phải tư vấn tài chính, đầu tư hoặc pháp lý.'} /></div>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-[var(--border-soft)] bg-[var(--elevated)] p-3"><span className="text-[10px] text-[var(--text-sec)]">{label}</span><strong className="mt-1 block tabular text-sm">{value}</strong></div>; }
function MetricRow({ label, value, color }: { label: string; value: string; color?: string }) { return <div className="flex items-center justify-between rounded-lg bg-[var(--elevated)] px-3 py-2.5"><span className="text-xs text-[var(--text-sec)]">{label}</span><strong className="tabular text-sm" style={{ color: color || 'var(--text-main)' }}>{value}</strong></div>; }
function PlanStep({ index, title, text }: { index: string; title: string; text: string }) { return <div className="rounded-lg bg-[var(--elevated)] p-3"><span className="text-[10px] font-bold text-[#F7931A]">{index}</span><strong className="mt-1 block text-xs">{title}</strong><p className="mt-1 text-[10px] leading-relaxed text-[var(--text-sec)]">{text}</p></div>; }
