import { supabase } from './supabase';

const API_BASE = String(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');
const DATA_API_BASE = String(import.meta.env.VITE_DATA_API_BASE_URL || API_BASE).replace(/\/+$/, '');

const DATA_PREFIXES = [
  '/api/overview',
  '/api/dashboard/summary',
  '/api/latest',
  '/api/ohlcv',
  '/api/indicators',
  '/api/p2p',
  '/api/data-status',
  '/api/data-reliability',
  '/api/risk-score',
  '/api/market-alerts',
  '/api/news',
  '/api/tax-estimate',
  '/api/net-settlement',
];

const CACHE_TTL: Array<[RegExp, number]> = [
  [/\/api\/(overview|dashboard\/summary|latest)/, 30_000],
  [/\/api\/(ohlcv|p2p-spread|p2p-comparison)/, 60_000],
  [/\/api\/(risk-score|market-alerts|indicators)/, 30_000],
  [/\/api\/news/, 300_000],
  [/\/api\/data-/, 30_000],
  [/\/api\/admin\/(overview|dashboard|system)/, 20_000],
  [/\/api\/(wallet|demo-trades|alerts|payment)/, 8_000],
];

interface CacheEntry { expiresAt: number; value: unknown }
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeout?: number;
  cacheTtl?: number;
  force?: boolean;
  auth?: boolean;
  retries?: number;
  retryDelay?: number;
}

function isDataPath(path: string): boolean {
  return DATA_PREFIXES.some(prefix => path.startsWith(prefix));
}

function endpoint(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${isDataPath(normalized) ? DATA_API_BASE : API_BASE}${normalized}`;
}

function ttlFor(path: string): number {
  return CACHE_TTL.find(([pattern]) => pattern.test(path))?.[1] ?? 0;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    if (typeof value.detail === 'string') return value.detail;
    if (typeof value.message === 'string') return value.message;
    if (Array.isArray(value.detail)) {
      return value.detail.map(item => (item && typeof item === 'object' && 'msg' in item ? String((item as { msg?: unknown }).msg) : String(item))).join(', ');
    }
  }
  return `Yêu cầu thất bại (HTTP ${status})`;
}

function retryable(error: unknown): boolean {
  if (error instanceof ApiError) return [408, 425, 429, 500, 502, 503, 504].includes(error.status);
  return error instanceof TypeError;
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError('Yêu cầu đã bị hủy.', 499));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new ApiError('Yêu cầu đã bị hủy.', 499));
    }, { once: true });
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase();
  const cacheKey = `${method}:${path}`;
  const ttl = options.cacheTtl ?? ttlFor(path);
  const now = Date.now();
  const canShareInflight = method === 'GET' && !options.force && !options.signal;

  if (method === 'GET' && !options.force) {
    const found = cache.get(cacheKey);
    if (found && found.expiresAt > now) return found.value as T;
    if (canShareInflight) {
      const running = inflight.get(cacheKey);
      if (running) return running as Promise<T>;
    }
  }

  const task = (async () => {
    const {
      body,
      timeout = 15_000,
      cacheTtl: _cacheTtl,
      force: _force,
      auth = true,
      retries = method === 'GET' ? 1 : 0,
      retryDelay = 650,
      signal: externalSignal,
      headers: customHeaders,
      ...fetchOptions
    } = options;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (externalSignal?.aborted) throw new ApiError('Yêu cầu đã bị hủy.', 499);

      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);
      const abortExternal = () => controller.abort();
      externalSignal?.addEventListener('abort', abortExternal, { once: true });

      try {
        const headers: Record<string, string> = {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(auth ? await authHeaders() : {}),
          ...(customHeaders as Record<string, string> | undefined),
        };
        const response = await fetch(endpoint(path), {
          ...fetchOptions,
          method,
          body: body === undefined ? undefined : JSON.stringify(body),
          headers,
          signal: controller.signal,
        });

        const type = response.headers.get('content-type') || '';
        const payload: unknown = type.includes('application/json') ? await response.json() : await response.text();
        if (!response.ok) throw new ApiError(errorMessage(payload, response.status), response.status, payload);

        if (method === 'GET' && ttl > 0) cache.set(cacheKey, { expiresAt: Date.now() + ttl, value: payload });
        if (method !== 'GET') clearApiCache();
        return payload as T;
      } catch (error) {
        let normalized = error;
        if (error instanceof DOMException && error.name === 'AbortError') {
          normalized = externalSignal?.aborted
            ? new ApiError('Yêu cầu đã bị hủy.', 499)
            : new ApiError(timedOut ? 'Máy chủ phản hồi chậm. Hệ thống sẽ tự thử lại.' : 'Yêu cầu đã bị hủy.', timedOut ? 408 : 499);
        }
        lastError = normalized;
        const shouldRetry = attempt < retries && !externalSignal?.aborted && retryable(normalized);
        if (!shouldRetry) throw normalized;
        await delay(retryDelay * (attempt + 1), externalSignal);
      } finally {
        window.clearTimeout(timeoutId);
        externalSignal?.removeEventListener('abort', abortExternal);
      }
    }
    throw lastError;
  })();

  if (canShareInflight) inflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (canShareInflight && inflight.get(cacheKey) === task) inflight.delete(cacheKey);
  }
}

export function clearApiCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.includes(prefix)) cache.delete(key);
}

export function apiUrl(path: string): string {
  return endpoint(path);
}
