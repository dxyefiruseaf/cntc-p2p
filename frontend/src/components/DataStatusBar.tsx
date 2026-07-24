import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarket } from '../context/MarketContext';
import { apiRequest } from '../lib/api';
import { formatDateTime, relativeTime } from '../lib/format';

type StatusTone = 'green' | 'orange' | 'red';

type DataStatusPayload = {
  latest_ohlcv_timestamp?: string;
  latest_p2p_timestamp?: string;
  ohlcv_age_hours?: number | null;
  p2p_age_hours?: number | null;
  is_ohlcv_fresh?: boolean;
  is_p2p_fresh?: boolean;
  note?: string;
};

type StatusViewProps = {
  ohlcvTimestamp?: string;
  p2pTimestamp?: string;
  ohlcvAgeHours?: number | null;
  p2pAgeHours?: number | null;
  source?: string;
  loading?: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onDetails?: () => void;
  detailsLabel?: string;
};

function parseAgeHours(timestamp?: string): number | null {
  if (!timestamp) return null;
  const milliseconds = new Date(timestamp).getTime();
  if (!Number.isFinite(milliseconds)) return null;
  return Math.max(0, (Date.now() - milliseconds) / 3_600_000);
}

function newestTimestamp(rows: Array<{ timestamp?: string }>): string | undefined {
  let newest: string | undefined;
  let newestValue = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (!row.timestamp) continue;
    const value = new Date(row.timestamp).getTime();
    if (Number.isFinite(value) && value > newestValue) {
      newest = row.timestamp;
      newestValue = value;
    }
  }
  return newest;
}

function toneForAge(ageHours: number | null, error = false): StatusTone {
  if (error || ageHours == null || ageHours > 6) return 'red';
  if (ageHours > 2) return 'orange';
  return 'green';
}

function worstTone(...tones: StatusTone[]): StatusTone {
  if (tones.includes('red')) return 'red';
  if (tones.includes('orange')) return 'orange';
  return 'green';
}

function toneLabel(tone: StatusTone, refreshing?: boolean): string {
  if (refreshing) return 'Đang cập nhật dữ liệu';
  if (tone === 'green') return 'Dữ liệu đang mới';
  if (tone === 'orange') return 'Dữ liệu cần chú ý';
  return 'Dữ liệu cũ hoặc gián đoạn';
}

function ageLabel(ageHours: number | null, timestamp?: string): string {
  if (timestamp) return relativeTime(timestamp);
  if (ageHours == null) return 'chưa xác định';
  if (ageHours < 1) return `${Math.max(1, Math.round(ageHours * 60))} phút trước`;
  return `${ageHours.toFixed(ageHours >= 10 ? 0 : 1)} giờ trước`;
}

function StatusMetric({ label, tone, value, title }: { label: string; tone: StatusTone; value: string; title?: string }) {
  return (
    <div className={`data-status-metric data-status-metric-${tone}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DataStatusBarView({
  ohlcvTimestamp,
  p2pTimestamp,
  ohlcvAgeHours,
  p2pAgeHours,
  source,
  loading,
  refreshing,
  error,
  onRefresh,
  onDetails,
  detailsLabel = 'Chi tiết dữ liệu',
}: StatusViewProps) {
  const [, setClock] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(value => value + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const liveOhlcvAge = ohlcvAgeHours ?? parseAgeHours(ohlcvTimestamp);
  const liveP2pAge = p2pAgeHours ?? parseAgeHours(p2pTimestamp);
  const ohlcvTone = loading && !ohlcvTimestamp ? 'orange' : toneForAge(liveOhlcvAge, Boolean(error && !ohlcvTimestamp));
  const p2pTone = loading && !p2pTimestamp ? 'orange' : toneForAge(liveP2pAge, Boolean(error && !p2pTimestamp));
  const tone = loading && !ohlcvTimestamp ? 'orange' : worstTone(ohlcvTone, p2pTone);

  return (
    <section className={`data-status-bar data-status-${tone}`} aria-live="polite">
      <div className="data-status-main">
        <span className={`data-status-beacon ${refreshing ? 'is-refreshing' : ''}`} />
        <div className="min-w-0">
          <p className="data-status-title">{toneLabel(tone, refreshing)}</p>
          <p className="data-status-message">
            {error && !ohlcvTimestamp ? error : tone === 'green'
              ? 'Các nguồn chính nằm trong ngưỡng cập nhật 2 giờ.'
              : tone === 'orange'
                ? 'Một nguồn đã quá 2 giờ; vẫn có thể xem nhưng nên kiểm tra timestamp.'
                : 'Không nên diễn giải tín hiệu mới trước khi dữ liệu được đồng bộ lại.'}
          </p>
        </div>
      </div>

      <div className="data-status-metrics">
        <StatusMetric label="OHLCV" tone={ohlcvTone} value={ageLabel(liveOhlcvAge, ohlcvTimestamp)} title={formatDateTime(ohlcvTimestamp)} />
        <StatusMetric label="P2P" tone={p2pTone} value={ageLabel(liveP2pAge, p2pTimestamp)} title={formatDateTime(p2pTimestamp)} />
        <div className="data-status-source" title={source || 'Nguồn dữ liệu'}>
          <span>Nguồn</span>
          <strong>{source || 'đang xác định'}</strong>
        </div>
      </div>

      <div className="data-status-actions">
        {onRefresh && <button type="button" onClick={onRefresh} disabled={refreshing || loading} className="data-status-button" aria-label="Làm mới trạng thái dữ liệu">{refreshing ? 'Đang tải…' : '↻ Làm mới'}</button>}
        {onDetails && <button type="button" onClick={onDetails} className="data-status-button primary">{detailsLabel} →</button>}
      </div>
    </section>
  );
}

export function MarketDataStatusBar() {
  const market = useMarket();
  const navigate = useNavigate();
  const p2pTimestamp = useMemo(() => newestTimestamp(market.p2pRows), [market.p2pRows]);
  const source = String(market.data?.sources?.ohlcv || 'cache').replace('supabase', 'Supabase').replace('public_api', 'Public API').replace('mock', 'Fallback');

  return (
    <DataStatusBarView
      ohlcvTimestamp={market.latest.timestamp}
      p2pTimestamp={p2pTimestamp}
      source={source}
      loading={market.loading}
      refreshing={market.refreshing}
      error={market.error}
      onRefresh={() => void market.refresh(Math.max(168, market.loadedHours || 168), true)}
      onDetails={() => navigate('/data')}
    />
  );
}

export function RemoteDataStatusBar() {
  const navigate = useNavigate();
  const [data, setData] = useState<DataStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setData(await apiRequest<DataStatusPayload>('/api/data-status', {
        force,
        cacheTtl: 60_000,
        timeout: 18_000,
        retries: 1,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không kiểm tra được trạng thái dữ liệu.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 120_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <DataStatusBarView
      ohlcvTimestamp={data?.latest_ohlcv_timestamp}
      p2pTimestamp={data?.latest_p2p_timestamp}
      ohlcvAgeHours={data?.ohlcv_age_hours}
      p2pAgeHours={data?.p2p_age_hours}
      source="Supabase / Binance"
      loading={loading}
      refreshing={refreshing}
      error={error}
      onRefresh={() => void load(true)}
      onDetails={() => navigate('/admin/system')}
      detailsLabel="Hệ thống"
    />
  );
}
