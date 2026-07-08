# Supabase Setup

## Bảng dữ liệu chính

- `btcusdt_ohlcv_1h`: nến BTC/USDT 1 giờ + chỉ báo kỹ thuật.
- `p2p_spread_history`: lịch sử spread P2P BUY/SELL.
- `ai_analysis_history`: lịch sử trả lời AI.
- `trade_simulations`: bảng mở rộng nếu muốn lưu giao dịch demo lên database.

## Cách chạy

1. Vào Supabase SQL Editor.
2. Chạy `supabase/schema.sql`.
3. Chạy `supabase/rls.sql`.
4. Điền key vào `backend/.env`.
5. Chạy seed:

```bash
cd backend
python scripts/seed_supabase_from_mock.py
```

## Bảo mật

- `SUPABASE_SERVICE_ROLE_KEY` chỉ dùng ở backend.
- Frontend không gọi Supabase trực tiếp trong kiến trúc này.
- Không commit file `.env`.
