# Mapping giữa báo cáo và website

Website được thiết kế để khi thuyết trình có thể mở từng trang tương ứng với từng chương trong đề cương.

## Chương 1 — Đề xuất mô hình kinh doanh

Route: `#business`

Nội dung trên web:
- 1.1 Giới thiệu bài toán: ba câu hỏi chính của nhà đầu tư Bitcoin cá nhân.
- 1.2 Nhu cầu thị trường và tính cấp thiết: phân tích kỹ thuật, P2P spread, thuế.
- 1.3 Đề xuất mô hình: BTC BigData AI Advisor.
- 1.4 Đánh giá phù hợp/mới/sáng tạo/khả thi: bốn card tiêu chí.
- 1.5 Mục tiêu đề tài: giảm thời gian ra quyết định, hỗ trợ tuân thủ, có MVP chạy được.
- 1.6 Đối thủ: TradingView, CoinMarketCap/CoinGecko, nhóm Facebook/Zalo.
- 1.7 Lợi thế: tích hợp kỹ thuật + P2P + thuế + AI tiếng Việt trong một nền tảng.

## Chương 2 — Business Model Canvas

Route: `#bmc`

Nội dung trên web:
- 2.1 Khung BMC số dạng lưới 9 thành phần.
- 2.1.2 Đối chiếu tính phù hợp/mới/sáng tạo/khả thi với Chương 1.
- 2.1.3 Điền đầy đủ 9 thành phần.
- 2.2 Phân tích chi tiết từng thành phần: click vào từng ô BMC để xem mô tả sâu.

9 thành phần gồm:
- Customer Segments
- Value Propositions
- Channels
- Customer Relationships
- Revenue Streams
- Key Resources
- Key Activities
- Key Partnerships
- Cost Structure

## Chương 3 — Thử nghiệm mô hình kinh doanh

Route: `#experiment`

Nội dung trên web:
- 3.1 Cấu trúc chung: website trình bày nền móng minh chứng.
- 3.2.1 Kiến trúc 4 tầng: Pipeline → Automation → Backend → Frontend.
- 3.2.2 Tính năng: OHLCV, chỉ báo kỹ thuật, P2P spread, thuế, AI.
- 3.3 Kịch bản thử nghiệm: các nút gọi `/api/latest`, `/api/p2p-spread`, `/api/tax-estimate`, `/api/ai/ask`.
- 3.3.3 Thư viện: Vite frontend, ECharts, FastAPI backend, Supabase, AI provider.
- 3.3.4 AI API miễn phí: Gemini/Groq/OpenAI compatible hoặc mock mode.
- 3.3.5 Demo thực tế: chụp màn hình kết quả trong khung “Kết quả thử nghiệm”.

## Các route minh chứng kỹ thuật

- `#dashboard`: Dashboard giá, tín hiệu tổng hợp, mini chart.
- `#chart`: Biểu đồ OHLCV/EMA/RSI.
- `#p2p`: P2P spread BUY/SELL, nút chuyển sang giao dịch demo.
- `#tax`: Form tính thuế.
- `#chat`: Chat AI advisor.
- `#trade`: Mô phỏng giao dịch P2P.
- `#history`: Lịch sử phân tích AI.
