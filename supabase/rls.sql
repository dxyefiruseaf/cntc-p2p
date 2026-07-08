-- RLS an toàn cho kiến trúc Frontend -> Backend -> Supabase.
-- Frontend KHÔNG gọi Supabase trực tiếp. Backend dùng SERVICE_ROLE_KEY nên bypass RLS.

alter table public.btcusdt_ohlcv_1h enable row level security;
alter table public.p2p_spread_history enable row level security;
alter table public.ai_analysis_history enable row level security;
alter table public.trade_simulations enable row level security;

-- Nếu muốn cho frontend đọc trực tiếp bằng SUPABASE_ANON_KEY, bỏ comment 2 policy dưới.
-- Khuyến nghị MVP: giữ frontend chỉ gọi backend để bảo vệ cấu trúc dữ liệu và key.

-- create policy "Allow public read ohlcv"
-- on public.btcusdt_ohlcv_1h for select
-- to anon, authenticated
-- using (true);

-- create policy "Allow public read p2p"
-- on public.p2p_spread_history for select
-- to anon, authenticated
-- using (true);
