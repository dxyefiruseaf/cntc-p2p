# BTC BigData Fullstack

Dự án đã được tách thành 2 phần độc lập:

```text
btc-bigdata-fullstack/
├── frontend/          # Vite + HTML/CSS/JS, giao diện Stitch UI
├── backend/           # FastAPI, Supabase, AI Advisor
├── supabase/          # SQL schema + RLS
├── docs/              # Tài liệu triển khai
└── .github/workflows/ # CI mẫu cho GitHub
```


## Website đã khớp với đề cương báo cáo

Frontend hiện có các route phục vụ trực tiếp Chương 1–3:

- `#business`: Chương 1 — bài toán, nhu cầu thị trường, mô hình đề xuất, đối thủ và lợi thế.
- `#bmc`: Chương 2 — Business Model Canvas 9 thành phần, có thể click từng ô để xem phân tích.
- `#experiment`: Chương 3 — kiến trúc 4 tầng và kịch bản thử nghiệm gọi API thật.
- `#dashboard`, `#chart`, `#p2p`, `#tax`, `#chat`, `#trade`, `#history`: các trang minh chứng sản phẩm.

Xem chi tiết tại `docs/REPORT_WEBSITE_MAPPING.md`.

## Luồng hệ thống

```text
Frontend -> Backend FastAPI -> Supabase
                       ├── AI Provider: Gemini/Groq/OpenAI/mock
                       ├── Public API fallback: https://btc-bigdata-is55a.onrender.com
                       └── Local mock fallback: backend/app/data/mock_data.json
```

Frontend không gọi Supabase trực tiếp và không chứa API key AI. Tất cả key nhạy cảm nằm trong `backend/.env`.

## Chạy local

### 1. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python run.py
```

Backend chạy tại:

```text
http://localhost:8000
http://localhost:8000/docs
```

### 2. Frontend

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Frontend chạy tại:

```text
http://localhost:5173
```

## Setup Supabase

1. Tạo project Supabase.
2. Mở SQL Editor.
3. Chạy `supabase/schema.sql`.
4. Chạy `supabase/rls.sql`.
5. Copy `SUPABASE_URL` và `service_role key` vào `backend/.env`.
6. Seed dữ liệu demo:

```bash
cd backend
python scripts/seed_supabase_from_mock.py
```

## AI API

Trong `backend/.env`:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your-key
```

Hoặc:

```env
AI_PROVIDER=groq
GROQ_API_KEY=your-key
```

Nếu chưa có key, để:

```env
AI_PROVIDER=mock
```

Backend vẫn trả lời bằng rule-based advisor để demo.

## Endpoint chính

- `GET /api/latest`
- `GET /api/ohlcv?hours=168`
- `GET /api/indicators/summary`
- `GET /api/p2p-spread?hours=168`
- `GET /api/tax-estimate?amount=100000000&country=VN`
- `POST /api/ai/ask`
- `GET /api/ai/history?limit=24`

## Lưu ý GitHub

- Commit `.env.example`, không commit `.env`.
- Không đưa `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY` lên GitHub.
- Khi deploy backend, khai báo secret trên Render/Railway/Fly.io/Vercel Serverless tùy nền tảng.

## Cập nhật dữ liệu liên tục

Nếu chart đang dừng ở ngày cũ, nguyên nhân thường là bạn mới seed dữ liệu từ `mock_data.json`. Để dữ liệu cập nhật đến hiện tại, chạy:

```bash
cd backend
python scripts/sync_market_data.py
```

Sau đó kiểm tra:

```text
http://localhost:8000/api/data-status
```

Để tự động chạy mỗi giờ trên GitHub, cấu hình workflow:

```text
.github/workflows/sync-market-data.yml
```

và thêm repository secrets:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Xem hướng dẫn chi tiết trong `docs/DATA_PIPELINE.md`.
