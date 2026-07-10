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

-- ---------------------------------------------------------------------------
-- Feature upgrade v1: Auth-owned histories, alerts, and VNPay sandbox
-- ---------------------------------------------------------------------------

alter table public.ai_analysis_history
    add column if not exists user_id uuid references auth.users(id);

create index if not exists idx_ai_analysis_history_user_created_at_desc
    on public.ai_analysis_history (user_id, created_at desc);

create table if not exists public.demo_trades (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) not null,
    side text not null check (side in ('buy', 'sell')),
    amount_vnd numeric not null,
    amount_usdt numeric null,
    price_source text not null check (price_source in ('p2p', 'market')),
    applied_price numeric null,
    created_at timestamptz default now()
);

create index if not exists idx_demo_trades_user_created_at_desc
    on public.demo_trades (user_id, created_at desc);

create table if not exists public.alert_rules (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) not null,
    metric text not null check (metric in ('price', 'rsi', 'p2p_spread_sell', 'p2p_spread_buy')),
    operator text not null check (operator in ('gt', 'lt')),
    threshold numeric not null,
    active boolean default true,
    last_triggered_at timestamptz,
    created_at timestamptz default now()
);

create index if not exists idx_alert_rules_active
    on public.alert_rules (active);
create index if not exists idx_alert_rules_user_created_at_desc
    on public.alert_rules (user_id, created_at desc);

create table if not exists public.notification_log (
    id uuid primary key default gen_random_uuid(),
    alert_rule_id uuid references public.alert_rules(id),
    sent_at timestamptz default now(),
    channel text default 'email',
    status text check (status in ('sent', 'failed', 'skipped'))
);

create table if not exists public.orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users(id) not null,
    plan_id text not null,
    amount_vnd numeric not null,
    vnp_txn_ref text unique not null,
    status text default 'pending' check (status in ('pending', 'success', 'failed')),
    created_at timestamptz default now(),
    paid_at timestamptz
);

create index if not exists idx_orders_user_created_at_desc
    on public.orders (user_id, created_at desc);

create table if not exists public.subscriptions (
    user_id uuid references auth.users(id) not null,
    plan_id text not null,
    active boolean default false,
    expires_at timestamptz,
    primary key (user_id, plan_id)
);

-- ---------------------------------------------------------------------------
-- Feature upgrade v2: Demo e-wallet + QR Code top-up via VNPay Sandbox
-- ---------------------------------------------------------------------------

create table if not exists public.wallets (
    user_id uuid primary key references auth.users(id) on delete cascade,
    balance_vnd numeric not null default 0 check (balance_vnd >= 0),
    balance_usdt_demo numeric not null default 0 check (balance_usdt_demo >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.wallet_topups (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    amount_vnd numeric not null check (amount_vnd > 0),
    vnp_txn_ref text unique not null,
    status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
    payment_url text null,
    created_at timestamptz not null default now(),
    paid_at timestamptz null
);

create index if not exists idx_wallet_topups_user_created_at_desc
    on public.wallet_topups (user_id, created_at desc);

create table if not exists public.wallet_transactions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    type text not null check (type in ('topup', 'payment', 'refund', 'adjustment')),
    amount_vnd numeric not null,
    balance_after_vnd numeric null,
    description text null,
    ref_id text null,
    created_at timestamptz not null default now()
);

create index if not exists idx_wallet_transactions_user_created_at_desc
    on public.wallet_transactions (user_id, created_at desc);
