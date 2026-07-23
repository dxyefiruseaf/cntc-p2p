import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiRequest, clearApiCache } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { Badge, Button, Card, Disclaimer, SectionHeader, Skeleton, StatusDot } from '../../components/ui';
import { useToast } from '../../context/ToastContext';

type SyncState = {
  status?: string;
  started_at?: string | null;
  finished_at?: string | null;
  message?: string;
  error?: string | null;
  duration_seconds?: number | null;
  output_tail?: string | null;
};

type Payload = { system?: Record<string, unknown>; summary?: Record<string, unknown> };
type SyncStatusPayload = { data?: Record<string, unknown>; sync?: SyncState };

const ACTIVE_SYNC_STATES = new Set(['queued', 'running']);

export default function AdminSystem() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const { showToast } = useToast();
  const lastStatusRef = useRef('idle');

  const mergeSyncStatus = useCallback((payload: SyncStatusPayload) => {
    setData(current => ({
      ...(current || {}),
      system: {
        ...(current?.system || {}),
        ...(payload.data ? { data_freshness: payload.data } : {}),
        ...(payload.sync ? { data_sync: payload.sync } : {}),
        checked_at: new Date().toISOString(),
      },
    }));
  }, []);

  const load = useCallback(async (force = false) => {
    if (!data) setLoading(true);
    try {
      const payload = await apiRequest<Payload>(`/api/admin/system${force ? '?refresh=true' : ''}`, {
        force,
        timeout: 20_000,
        retries: 1,
      });
      setData(payload);
      const state = String(((payload.system?.data_sync || {}) as SyncState).status || 'idle').toLowerCase();
      lastStatusRef.current = state;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Không tải được hệ thống.', 'error');
    } finally {
      setLoading(false);
    }
  }, [data, showToast]);

  useEffect(() => { void load(); }, []); // initial infrastructure snapshot

  const sync = (data?.system?.data_sync || {}) as SyncState;
  const syncStatus = String(sync.status || 'idle').toLowerCase();
  const syncActive = ACTIVE_SYNC_STATES.has(syncStatus);

  const pollSync = useCallback(async () => {
    try {
      const payload = await apiRequest<SyncStatusPayload>(`/api/admin/data-sync/status?t=${Date.now()}`, {
        force: true,
        cacheTtl: 0,
        timeout: 12_000,
        retries: 1,
      });
      const nextStatus = String(payload.sync?.status || 'idle').toLowerCase();
      const previousStatus = lastStatusRef.current;
      mergeSyncStatus(payload);
      lastStatusRef.current = nextStatus;

      if (ACTIVE_SYNC_STATES.has(previousStatus) && !ACTIVE_SYNC_STATES.has(nextStatus)) {
        clearApiCache();
        if (nextStatus === 'success') {
          showToast(payload.sync?.message || 'Đồng bộ dữ liệu thành công.', 'success', 4500);
        } else if (nextStatus === 'failed') {
          showToast(payload.sync?.error || payload.sync?.message || 'Đồng bộ dữ liệu thất bại.', 'error', 6000);
        }
        window.setTimeout(() => void load(true), 300);
      }
    } catch (error) {
      // A temporary polling failure should not reset a server-side sync job.
      if (!data) showToast(error instanceof Error ? error.message : 'Không kiểm tra được tiến trình đồng bộ.', 'error');
    }
  }, [data, load, mergeSyncStatus, showToast]);

  useEffect(() => {
    if (!syncActive) return;
    void pollSync();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void pollSync();
    }, 1500);
    return () => window.clearInterval(interval);
  }, [syncActive, pollSync]);

  const startSync = async () => {
    setStarting(true);
    try {
      const payload = await apiRequest<SyncStatusPayload>('/api/admin/data-sync', {
        method: 'POST',
        cacheTtl: 0,
        timeout: 15_000,
      });
      clearApiCache();
      mergeSyncStatus(payload);
      lastStatusRef.current = String(payload.sync?.status || 'queued').toLowerCase();
      showToast(payload.sync?.message || 'Đã đưa yêu cầu đồng bộ vào hàng đợi.', 'info', 2500);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Không bắt đầu được đồng bộ.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const sys = data?.system || {};
  const freshness = (sys.data_freshness || {}) as Record<string, unknown>;
  const services = useMemo<Array<[string, unknown]>>(() => [
    ['Backend API', sys.api],
    ['PostgreSQL / Supabase', sys.database],
    ['AI Provider', sys.ai_provider],
    ['Môi trường', sys.environment],
    ['OHLCV', freshness.state],
    ['Tiến trình đồng bộ', sync.status],
  ], [freshness.state, sync.status, sys.ai_provider, sys.api, sys.database, sys.environment]);

  return (
    <div className="page-enter space-y-5">
      <header className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <Badge variant="gold">System Control</Badge>
          <h1 className="mt-2 text-2xl font-extrabold">Trạng thái hệ thống</h1>
          <p className="mt-1 text-sm text-[var(--text-sec)]">Theo dõi backend, Supabase, dữ liệu thị trường và quy trình đồng bộ.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" loading={loading && Boolean(data)} onClick={() => void load(true)}>Kiểm tra lại</Button>
          <Button loading={starting || syncActive} disabled={syncActive} onClick={() => void startSync()}>
            {syncActive ? 'Đang đồng bộ…' : 'Đồng bộ dữ liệu'}
          </Button>
        </div>
      </header>

      {loading && !data ? (
        <div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-32" />)}</div>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {services.map(([name, value], index) => {
              const normalized = String(value || '').toLowerCase();
              const ok = ['operational', 'fresh', 'success', 'idle', 'mock', 'groq', 'gemini', 'openai', 'production', 'development'].includes(normalized);
              return (
                <Card key={name} className="card-reveal p-5" style={{ animationDelay: `${index * 45}ms` }}>
                  <div className="flex items-center justify-between"><StatusDot status={ok ? 'online' : 'warning'} /><Badge variant={ok ? 'success' : 'warning'}>{String(value || 'unknown')}</Badge></div>
                  <h2 className="mt-5 font-semibold">{name}</h2>
                  <p className="mt-1 text-xs text-[var(--text-sec)]">Kiểm tra lúc {formatDateTime(sys.checked_at)}</p>
                </Card>
              );
            })}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <SectionHeader title="Độ mới dữ liệu" />
              <div className="space-y-3">
                <div className="metric-box"><span>Trạng thái</span><strong>{String(freshness.state || 'unknown')}</strong></div>
                <div className="metric-box"><span>Ngưỡng</span><strong>{formatNumber(freshness.threshold_hours, 0)} giờ</strong></div>
                <div className="metric-box"><span>Thông báo</span><strong className="text-sm leading-relaxed">{String(freshness.message || '—')}</strong></div>
              </div>
            </Card>

            <Card className="p-5">
              <SectionHeader title="Đồng bộ thủ công" />
              <div className="space-y-3">
                <div className="metric-box"><span>Trạng thái</span><strong>{String(sync.status || 'idle')}</strong></div>
                <div className="metric-box"><span>Bắt đầu</span><strong className="text-sm">{formatDateTime(sync.started_at)}</strong></div>
                <div className="metric-box"><span>Kết thúc</span><strong className="text-sm">{formatDateTime(sync.finished_at)}</strong></div>
                {sync.duration_seconds != null && <div className="metric-box"><span>Thời gian chạy</span><strong>{formatNumber(sync.duration_seconds, 1)} giây</strong></div>}
                <div className={`rounded-xl border p-3 text-sm ${syncStatus === 'failed' ? 'border-[#EF4444]/30 bg-[#EF4444]/[0.07] text-[#FCA5A5]' : syncStatus === 'success' ? 'border-[#22C55E]/30 bg-[#22C55E]/[0.07] text-[#86EFAC]' : 'border-[var(--border-soft)] bg-[var(--surface-2)] text-[var(--text-sec)]'}`}>
                  {String(sync.error || sync.message || 'Chưa có tiến trình đang chạy.')}
                </div>
              </div>
            </Card>
          </section>
        </>
      )}

      <Disclaimer text="Các chỉ số hệ thống phục vụ vận hành và trình diễn. Khi database hoặc API bên thứ ba gián đoạn, backend có thể trả trạng thái degraded thay vì làm sập toàn bộ Admin Console." tone="info" />
    </div>
  );
}
