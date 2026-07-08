# Backend — BTC BigData API

FastAPI backend giữ vai trò trung gian giữa frontend, Supabase và AI provider.

## Cài đặt

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
python run.py
```

## Cấu hình `.env`

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AI_PROVIDER=mock
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

## Thứ tự lấy dữ liệu

1. Supabase nếu đã cấu hình và có dữ liệu.
2. Public API cũ nếu bật `USE_PUBLIC_API_FALLBACK=true`.
3. Mock local trong `app/data/mock_data.json`.

Nhờ đó backend vẫn chạy được khi mới clone project.

## Sync dữ liệu live vào Supabase

Seed mock chỉ dùng cho demo. Để cập nhật dữ liệu mới:

```bash
python scripts/sync_market_data.py
```

Chọn nguồn trong `.env`:

```env
SYNC_SOURCE=public_api
# hoặc
SYNC_SOURCE=binance
SYNC_HOURS=720
```

Kiểm tra độ mới của dữ liệu:

```text
GET /api/data-status
```
