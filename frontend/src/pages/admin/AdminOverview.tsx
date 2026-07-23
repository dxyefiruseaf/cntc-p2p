import { useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../../lib/api';
import { formatDateTime, formatNumber, formatUSD, formatVND } from '../../lib/format';
import { Badge, Button, Card, KPICard, SectionHeader, Skeleton, StatusDot } from '../../components/ui';
import TechnicalAnalysisChart from '../../components/TechnicalAnalysisChart';
import { useToast } from '../../context/ToastContext';

type Overview = {
  summary?: Record<string, unknown>;
  market?: { latest?: Record<string, unknown> };
  system?: Record<string, unknown>;
  degraded?: boolean;
};
type Series = { data?: Array<Record<string, unknown>> };
type Activity = { data?: Array<Record<string, unknown>> };

export default function AdminOverview() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const lazyRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  const load = async (force = false) => {
    setLoading(true);
    try {
      setOverview(await apiRequest<Overview>(`/api/admin/overview${force ? '?refresh=true' : ''}`, { force }));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Không tải được Admin Overview.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const element = lazyRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries[0]?.isIntersecting) return;
      observer.disconnect();
      void Promise.allSettled([
        apiRequest<Series>('/api/admin/market-series?hours=168'),
        apiRequest<Activity>('/api/admin/activity-feed?limit=8'),
      ]).then(([seriesResult, activityResult]) => {
        if (seriesResult.status === 'fulfilled') setSeries(seriesResult.value);
        if (activityResult.status === 'fulfilled') setActivity(activityResult.value);
      });
    }, { rootMargin: '240px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const summary = overview?.summary || {};
  const latest = overview?.market?.latest || {};
  const system = overview?.system || {};
  const kpis = useMemo(() => [
    ['Tổng người dùng', formatNumber(summary.total_users, 0), '👥', '#3B82F6'],
    ['Đang hoạt động', formatNumber(summary.active_users, 0), '●', '#22C55E'],
    ['Premium', formatNumber(summary.premium_users, 0), '◆', '#F7931A'],
    ['Doanh thu Sandbox', formatVND(summary.revenue_vnd), '₫', '#22C55E'],
    ['Giao dịch demo', formatNumber(summary.trade_count, 0), '↔', '#8B5CF6'],
    ['Yêu cầu AI', formatNumber(summary.ai_questions, 0), '✦', '#8B5CF6'],
    ['BTC/USDT', formatUSD(latest.close), '₿', '#F7931A'],
    ['Cảnh báo đang bật', formatNumber(summary.active_alerts, 0), '🔔', '#F59E0B'],
  ] as const, [summary, latest]);

  return (
    <div className="page-enter space-y-5">
      <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <Badge variant="gold">BitAdmin</Badge>
          <h1 className="mt-2 text-2xl font-extrabold">Tổng quan hệ thống</h1>
          <p className="mt-1 text-sm text-[var(--text-sec)]">Theo dõi vận hành, người dùng và thị trường trên cùng một màn hình.</p>
        </div>
        <Button variant="secondary" loading={loading} onClick={() => void load(true)}>Làm mới</Button>
      </header>

      {overview?.degraded && <div className="rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-3 text-sm text-[#F59E0B]">Một số nguồn Supabase đang tạm gián đoạn. Dashboard vẫn hiển thị phần dữ liệu khả dụng.</div>}

      {loading && !overview ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-28" />)}</div>
      ) : (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map(([label, value, icon, color], index) => <KPICard key={label} label={label} value={value} icon={icon} accent={color} delay={index * 35} />)}
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <Card className="p-5">
          <SectionHeader title="Trạng thái nhanh" />
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusMetric label="Backend API" value={String(system.api || 'unknown')} status={system.api === 'operational' ? 'online' : 'warning'} />
            <StatusMetric label="Database" value={String(system.database || 'unknown')} status={system.database === 'operational' ? 'online' : 'warning'} />
            <div className="metric-box"><span>AI Provider</span><strong>{String(system.ai_provider || '—')}</strong></div>
            <div className="metric-box"><span>Môi trường</span><strong>{String(system.environment || '—')}</strong></div>
          </div>
        </Card>
        <Card className="hero-surface p-5">
          <p className="text-xs uppercase tracking-wider text-[var(--text-sec)]">Market snapshot</p>
          <p className="mt-2 tabular text-3xl font-black text-[#F7931A]">{formatUSD(latest.close)}</p>
          <p className="mt-2 text-sm text-[var(--text-sec)]">RSI {formatNumber(latest.rsi_14, 2)} · MACD {formatNumber(latest.macd_hist, 2)}</p>
          <p className="mt-4 text-xs text-[var(--text-dim)]">Cập nhật {formatDateTime(latest.timestamp)}</p>
        </Card>
      </section>

      <div ref={lazyRef} className="grid items-start gap-4 xl:grid-cols-[1.5fr_.5fr]">
        <Card className="min-w-0 p-5">
          <SectionHeader title="Biểu đồ kỹ thuật BTC" sub="168 giờ gần nhất · nến OHLCV và toàn bộ chỉ báo chính" />
          {series ? <TechnicalAnalysisChart rows={series.data || []} density="standard" showBrush /> : <Skeleton className="h-[760px]" />}
        </Card>
        <Card className="p-5">
          <SectionHeader title="Hoạt động gần đây" />
          {activity ? (
            <div className="space-y-2">{(activity.data || []).map((row, index) => (
              <div key={String(row.id || index)} className="rounded-xl border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
                <div className="flex items-center justify-between gap-2"><strong className="text-sm">{String(row.title || row.type || 'Hoạt động')}</strong><Badge variant={String(row.status).includes('success') || String(row.status) === 'completed' ? 'success' : 'neutral'}>{String(row.status || '—')}</Badge></div>
                <p className="mt-1 truncate text-xs text-[var(--text-sec)]">{String(row.detail || '')}</p>
                <p className="mt-1 text-[10px] text-[var(--text-dim)]">{formatDateTime(row.created_at)}</p>
              </div>
            ))}</div>
          ) : <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-16" />)}</div>}
        </Card>
      </div>
    </div>
  );
}

function StatusMetric({ label, value, status }: { label: string; value: string; status: 'online' | 'warning' }) {
  return <div className="metric-box"><span>{label}</span><strong className="flex items-center gap-2"><StatusDot status={status} />{value}</strong></div>;
}
