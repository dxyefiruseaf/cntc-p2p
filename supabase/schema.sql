-- BTC BigData Platform — Supabase schema
-- Chạy file này trong Supabase SQL Editor trước khi seed dữ liệu.

create extension if not exists pgcrypto;

create table if not exists public.btcusdt_ohlcv_1h (
    timestamp timestamptz primary key,
    open numeric not null,
    high numeric not null,
    low numeric not null,
    close numeric not null,
    volume numeric not null,
    trades integer not null,
    rsi_14 numeric null,
    macd numeric null,
    macd_signal numeric null,
    macd_hist numeric null,
    bb_upper numeric null,
    bb_mid numeric null,
    bb_lower numeric null,
    bb_width numeric null,
    ema_20 numeric null,
    ema_50 numeric null,
    ema_200 numeric null,
    atr_14 numeric null,
    stoch_k numeric null,
    stoch_d numeric null,
    vol_ma_20 numeric null,
    created_at timestamptz not null default now()
);

create index if not exists idx_btcusdt_ohlcv_1h_timestamp_desc
    on public.btcusdt_ohlcv_1h (timestamp desc);

create table if not exists public.p2p_spread_history (
    timestamp timestamptz not null,
    asset text not null default 'USDT',
    fiat text not null default 'VND',
    trade_type text not null check (trade_type in ('BUY', 'SELL')),
    p2p_price numeric not null,
    p2p_price_min numeric null,
    p2p_price_max numeric null,
    samples integer null,
    market_price numeric not null,
    spread_pct numeric not null,
    created_at timestamptz not null default now(),
    primary key (timestamp, trade_type)
);

create index if not exists idx_p2p_spread_history_timestamp_desc
    on public.p2p_spread_history (timestamp desc);

create index if not exists idx_p2p_spread_history_trade_type_timestamp
    on public.p2p_spread_history (trade_type, timestamp desc);

create table if not exists public.ai_analysis_history (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    question text null,
    answer text not null,
    verdict text not null check (verdict in ('BUY', 'SELL', 'NEUTRAL')),
    confidence integer not null default 50 check (confidence between 0 and 100),
    reasons jsonb not null default '[]'::jsonb,
    risks jsonb not null default '[]'::jsonb,
    market_snapshot jsonb null,
    model_name text null
);

create index if not exists idx_ai_analysis_history_created_at_desc
    on public.ai_analysis_history (created_at desc);

-- Optional: lưu lịch sử mô phỏng giao dịch nếu sau này muốn chuyển từ localStorage lên Supabase.
create table if not exists public.trade_simulations (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    side text not null check (side in ('BUY', 'SELL')),
    amount_vnd numeric not null,
    usdt_amount numeric not null,
    p2p_price numeric not null,
    fee_vnd numeric not null default 0,
    tax_vnd numeric not null default 0,
    net_vnd numeric not null,
    note text null
);

create index if not exists idx_trade_simulations_created_at_desc
    on public.trade_simulations (created_at desc);
