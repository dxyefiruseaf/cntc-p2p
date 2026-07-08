-- RLS an toàn cho kiến trúc Frontend -> Backend -> Supabase.
-- Frontend KHÔNG dùng service role. Backend dùng SERVICE_ROLE_KEY cho các thao tác server-side.

alter table public.btcusdt_ohlcv_1h enable row level security;
alter table public.p2p_spread_history enable row level security;
alter table public.ai_analysis_history enable row level security;
alter table public.trade_simulations enable row level security;

-- Nếu muốn cho frontend đọc trực tiếp bằng SUPABASE_ANON_KEY, bỏ comment 2 policy dưới.
-- Khuyến nghị MVP: giữ frontend chỉ gọi backend để bảo vệ cấu trúc dữ liệu và key.

-- drop policy if exists "Allow public read ohlcv" on public.btcusdt_ohlcv_1h;
-- create policy "Allow public read ohlcv"
-- on public.btcusdt_ohlcv_1h for select
-- to anon, authenticated
-- using (true);

-- drop policy if exists "Allow public read p2p" on public.p2p_spread_history;
-- create policy "Allow public read p2p"
-- on public.p2p_spread_history for select
-- to anon, authenticated
-- using (true);

-- ---------------------------------------------------------------------------
-- Feature upgrade v1 RLS
-- ---------------------------------------------------------------------------

alter table public.demo_trades enable row level security;
alter table public.alert_rules enable row level security;
alter table public.notification_log enable row level security;
alter table public.orders enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "user reads own demo trades" on public.demo_trades;
create policy "user reads own demo trades" on public.demo_trades
  for select using (auth.uid() = user_id);

drop policy if exists "user inserts own demo trades" on public.demo_trades;
create policy "user inserts own demo trades" on public.demo_trades
  for insert with check (auth.uid() = user_id);

drop policy if exists "user reads own ai history" on public.ai_analysis_history;
create policy "user reads own ai history" on public.ai_analysis_history
  for select using (user_id is null or auth.uid() = user_id);

drop policy if exists "user inserts own ai history" on public.ai_analysis_history;
create policy "user inserts own ai history" on public.ai_analysis_history
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "user reads own alert rules" on public.alert_rules;
create policy "user reads own alert rules" on public.alert_rules
  for select using (auth.uid() = user_id);

drop policy if exists "user inserts own alert rules" on public.alert_rules;
create policy "user inserts own alert rules" on public.alert_rules
  for insert with check (auth.uid() = user_id);

drop policy if exists "user updates own alert rules" on public.alert_rules;
create policy "user updates own alert rules" on public.alert_rules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user deletes own alert rules" on public.alert_rules;
create policy "user deletes own alert rules" on public.alert_rules
  for delete using (auth.uid() = user_id);

drop policy if exists "user reads own orders" on public.orders;
create policy "user reads own orders" on public.orders
  for select using (auth.uid() = user_id);

drop policy if exists "user reads own subscriptions" on public.subscriptions;
create policy "user reads own subscriptions" on public.subscriptions
  for select using (auth.uid() = user_id);
