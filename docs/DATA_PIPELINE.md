# DATA PIPELINE — cập nhật dữ liệu liên tục

## Vì sao chart đang dừng ở 01/07?

Nếu bạn chạy `seed_supabase_from_mock.py`, Supabase chỉ nhận dữ liệu tĩnh từ `mock_data.json`. File mock dùng để demo/fallback, không phải pipeline live. Vì vậy biểu đồ có thể dừng ở ngày trong file mock.

Để dữ liệu tự đi đến hôm nay, cần chạy job đồng bộ:

```text
Nguồn dữ liệu mới
  → scripts/sync_market_data.py
  → Supabase
  → FastAPI backend
  → Frontend chart/dashboard
```

## Script đồng bộ chính

```bash
cd backend
python scripts/sync_market_data.py
```

Script này đọc `.env`, lấy dữ liệu mới và `upsert` vào Supabase.

## Chọn nguồn dữ liệu

Trong `backend/.env`:

```env
# Cách 1: lấy từ API Render đang có của nhóm
SYNC_SOURCE=public_api
PUBLIC_DATA_API_URL=https://btc-bigdata-is55a.onrender.com
SYNC_HOURS=720
```

Cách này nhanh, nhưng nếu API Render cũng đang cũ thì Supabase cũng chỉ nhận dữ liệu cũ.

```env
# Cách 2: lấy trực tiếp OHLCV từ Binance và tự tính indicator
SYNC_SOURCE=binance
SYNC_HOURS=720
SYNC_P2P_FROM_BINANCE=true
SYNC_P2P_PUBLIC_FALLBACK=true
```

Cách này phù hợp hơn nếu muốn chứng minh pipeline Big Data độc lập: mỗi giờ tự lấy nến mới, tự tính indicator, tự lưu Supabase.

## Kiểm tra dữ liệu có mới không

Sau khi chạy backend:

```text
GET http://localhost:8000/api/data-status
```

Nếu kết quả có:

```json
{
  "is_ohlcv_fresh": true,
  "ohlcv_age_hours": 1.2
}
```

thì dữ liệu OHLCV đang mới. Nếu `false`, hãy chạy lại script sync hoặc kiểm tra GitHub Actions.

## Chạy tự động bằng GitHub Actions

File đã có sẵn:

```text
.github/workflows/sync-market-data.yml
```

Workflow này chạy mỗi giờ bằng cron:

```yaml
- cron: "0 * * * *"
```

Cần cấu hình trong GitHub repository:

### Secrets

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Variables khuyên dùng

- `SYNC_SOURCE=binance` hoặc `public_api`
- `SYNC_HOURS=720`
- `PUBLIC_DATA_API_URL=https://btc-bigdata-is55a.onrender.com`
- `SYNC_P2P_FROM_BINANCE=true`
- `SYNC_P2P_PUBLIC_FALLBACK=true`

## Lưu ý cho báo cáo Big Data

Trong báo cáo có thể trình bày pipeline như sau:

> Hệ thống không phụ thuộc vào dữ liệu mock. Dữ liệu mock chỉ dùng cho demo/fallback. Dữ liệu vận hành thật được cập nhật định kỳ bằng job tự động: lấy dữ liệu thị trường theo giờ, tính chỉ báo kỹ thuật, chuẩn hóa dữ liệu và upsert vào Supabase. Backend FastAPI đọc Supabase để phục vụ frontend và AI Advisor. Cách này giúp hệ thống có tính tự động hóa, có kho dữ liệu lịch sử và sẵn sàng mở rộng sang BigQuery khi quy mô dữ liệu lớn hơn.
