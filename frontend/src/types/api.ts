export type JsonRecord = Record<string, unknown>;

export interface MarketRow {
  timestamp?: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  trades?: number;
  rsi_14?: number;
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
  bb_upper?: number;
  bb_mid?: number;
  bb_lower?: number;
  ema_20?: number;
  ema_50?: number;
  ema_200?: number;
  atr_14?: number;
  stoch_k?: number;
  stoch_d?: number;
  vol_ma_20?: number;
}

export interface P2PRow {
  timestamp?: string;
  trade_type?: 'BUY' | 'SELL' | string;
  p2p_price?: number;
  p2p_price_min?: number;
  p2p_price_max?: number;
  market_price?: number;
  spread_pct?: number;
  samples?: number;
}

export interface MarketOverview {
  latest: MarketRow;
  summary: {
    overall?: { verdict?: 'BUY' | 'SELL' | 'NEUTRAL' | string; buy?: number; sell?: number; neutral?: number };
    signals?: Record<string, { value?: number; signal?: string; note?: string }>;
  };
  ohlcv: { symbol?: string; timeframe?: string; hours?: number; count?: number; data: MarketRow[] };
  risk: { score?: number; level?: string; label_vi?: string; factors?: unknown[]; [key: string]: unknown };
  alerts: { count?: number; data?: Array<Record<string, unknown>>; disclaimer?: string };
  p2p: { count?: number; latest?: P2PRow; data: P2PRow[] };
  p2p_comparison?: Record<string, unknown>;
  status?: Record<string, unknown>;
  sources?: Record<string, string>;
}

export interface AuthProfile {
  id?: string;
  user_id?: string;
  email?: string;
  full_name?: string;
  display_name?: string;
  role?: string;
  status?: string;
  plan_id?: string;
  premium?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

export interface ApiList<T> {
  count?: number;
  data: T[];
  next_cursor?: string | null;
  has_next?: boolean;
  page?: number;
  total?: number;
  total_pages?: number;
  [key: string]: unknown;
}
