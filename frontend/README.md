# BTC BigData Frontend

Frontend Vite dùng để minh chứng trực tiếp cho bài báo cáo Công nghệ dịch vụ tài chính.

## Route chính

- `#business` — Chương 1: đề xuất mô hình kinh doanh.
- `#bmc` — Chương 2: Business Model Canvas 9 thành phần.
- `#experiment` — Chương 3: kịch bản thử nghiệm, gọi API thật.
- `#dashboard` — Dashboard giá và tín hiệu.
- `#chart` — Biểu đồ kỹ thuật.
- `#p2p` — P2P spread.
- `#tax` — Ước tính thuế.
- `#chat` — Chat AI Advisor.
- `#trade` — Mô phỏng giao dịch.
- `#history` — Lịch sử AI.

## Chạy local

```bash
npm install
cp .env.example .env
npm run dev
```

`.env`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Frontend chỉ gọi backend FastAPI. Không đưa API key AI hoặc Supabase service role key vào frontend.
