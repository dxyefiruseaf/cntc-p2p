import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { apiRequest } from '../lib/api';
import type { MarketOverview, MarketRow, P2PRow } from '../types/api';

interface MarketState {
  data: MarketOverview | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  direction: 'up' | 'down' | 'flat';
  loadedHours: number;
  lastUpdatedAt: number | null;
  refresh: (hours?: number, force?: boolean) => Promise<void>;
  latest: MarketRow;
  rows: MarketRow[];
  p2pRows: P2PRow[];
}

interface CachedMarketSnapshot {
  savedAt: number;
  data: MarketOverview;
}

const MARKET_CACHE_KEY = 'btc_market_overview_v2';
const MARKET_CACHE_MAX_AGE = 10 * 60_000;
const DEFAULT_HOURS = 168;
const AUTO_REFRESH_MS = 60_000;
const MarketContext = createContext<MarketState | null>(null);

function readCachedSnapshot(): CachedMarketSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(MARKET_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedMarketSnapshot;
    if (!parsed?.data || !parsed.savedAt || Date.now() - parsed.savedAt > MARKET_CACHE_MAX_AGE) return null;
    return parsed;
  } catch {
    return null;
  }
}

function cacheSnapshot(data: MarketOverview): void {
  try {
    const ohlcvRows = data.ohlcv?.data || [];
    const p2pRows = data.p2p?.data || [];
    const compact: MarketOverview = {
      ...data,
      ohlcv: {
        ...data.ohlcv,
        hours: Math.min(Number(data.ohlcv?.hours || DEFAULT_HOURS), DEFAULT_HOURS),
        count: Math.min(ohlcvRows.length, DEFAULT_HOURS),
        data: ohlcvRows.slice(-DEFAULT_HOURS),
      },
      p2p: {
        ...data.p2p,
        count: Math.min(p2pRows.length, DEFAULT_HOURS * 2),
        data: p2pRows.slice(0, DEFAULT_HOURS * 2),
      },
    };
    window.sessionStorage.setItem(MARKET_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: compact }));
  } catch {
    // Storage can be unavailable or full; live data still works normally.
  }
}

export function MarketProvider({ children }: { children: ReactNode }) {
  const cached = useMemo(readCachedSnapshot, []);
  const [data, setData] = useState<MarketOverview | null>(cached?.data || null);
  const [loading, setLoading] = useState(!cached?.data);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<'up' | 'down' | 'flat'>('flat');
  const [loadedHours, setLoadedHours] = useState(Number(cached?.data.ohlcv?.hours || 0));
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(cached?.savedAt || null);

  const dataRef = useRef<MarketOverview | null>(cached?.data || null);
  const loadedHoursRef = useRef(Number(cached?.data.ohlcv?.hours || 0));
  const lastUpdatedRef = useRef<number>(cached?.savedAt || 0);
  const lastPrice = useRef<number | null>(Number(cached?.data.latest?.close || 0) || null);
  const activeRequest = useRef<{ hours: number; controller: AbortController; promise: Promise<void> } | null>(null);

  const refresh = useCallback((hours = DEFAULT_HOURS, force = false): Promise<void> => {
    const normalizedHours = Math.max(24, Math.min(720, Math.round(hours)));
    const currentAge = Date.now() - lastUpdatedRef.current;
    if (!force && dataRef.current && loadedHoursRef.current >= normalizedHours && currentAge < 30_000) {
      return Promise.resolve();
    }

    const running = activeRequest.current;
    if (running) {
      if (!force && running.hours >= normalizedHours) return running.promise;
      running.controller.abort();
    }

    const controller = new AbortController();
    const task = (async () => {
      if (!dataRef.current) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const next = await apiRequest<MarketOverview>(`/api/overview?hours=${normalizedHours}`, {
          signal: controller.signal,
          force,
          cacheTtl: 30_000,
          timeout: 28_000,
          retries: 1,
          retryDelay: 900,
        });
        const price = Number(next.latest?.close || 0);
        if (lastPrice.current !== null && price && price !== lastPrice.current) setDirection(price > lastPrice.current ? 'up' : 'down');
        else setDirection('flat');
        if (price) lastPrice.current = price;

        const receivedHours = Number(next.ohlcv?.hours || normalizedHours);
        const updatedAt = Date.now();
        dataRef.current = next;
        loadedHoursRef.current = receivedHours;
        lastUpdatedRef.current = updatedAt;
        setData(next);
        setLoadedHours(receivedHours);
        setLastUpdatedAt(updatedAt);
        cacheSnapshot(next);
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (!dataRef.current) setError(reason instanceof Error ? reason.message : 'Không tải được dữ liệu thị trường.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
        if (activeRequest.current?.controller === controller) activeRequest.current = null;
      }
    })();

    activeRequest.current = { hours: normalizedHours, controller, promise: task };
    return task;
  }, []);

  useEffect(() => {
    void refresh(DEFAULT_HOURS);
    const interval = window.setInterval(() => {
      const stale = Date.now() - lastUpdatedRef.current >= AUTO_REFRESH_MS;
      if (document.visibilityState === 'visible' && stale && loadedHoursRef.current <= DEFAULT_HOURS) {
        void refresh(DEFAULT_HOURS);
      }
    }, AUTO_REFRESH_MS);
    const onVisibility = () => {
      const stale = Date.now() - lastUpdatedRef.current >= 45_000;
      if (document.visibilityState === 'visible' && stale && loadedHoursRef.current <= DEFAULT_HOURS) {
        void refresh(DEFAULT_HOURS);
      }
    };
    const onOnline = () => void refresh(Math.max(DEFAULT_HOURS, Math.min(loadedHoursRef.current, DEFAULT_HOURS)), true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      activeRequest.current?.controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [refresh]);

  const value = useMemo<MarketState>(() => ({
    data,
    loading,
    refreshing,
    error,
    direction,
    loadedHours,
    lastUpdatedAt,
    refresh,
    latest: data?.latest || {},
    rows: data?.ohlcv?.data || [],
    p2pRows: data?.p2p?.data || [],
  }), [data, loading, refreshing, error, direction, loadedHours, lastUpdatedAt, refresh]);

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketState {
  const value = useContext(MarketContext);
  if (!value) throw new Error('useMarket must be used inside MarketProvider');
  return value;
}
