# Feature Upgrade — Trong phạm vi môn học

Bản nâng cấp này biến website từ dashboard BTC + AI chat thành nền tảng hỗ trợ ra quyết định tài chính có giải thích, nhưng vẫn giữ phạm vi học thuật, không giao dịch thật và không đưa lời khuyên đầu tư cá nhân.

## Tính năng mới

### 1. Data Reliability

Route frontend: `#reliability`  
API backend: `GET /api/data-reliability`

Mục tiêu: giúp người dùng biết dữ liệu giá và dữ liệu P2P có đang đủ mới hay không.

Hiển thị:
- Nguồn dữ liệu OHLCV và P2P.
- Thời điểm cập nhật mới nhất.
- Tuổi dữ liệu theo giờ.
- Trạng thái Fresh / Cần kiểm tra.
- Cơ chế GitHub Actions đồng bộ mỗi giờ.

### 2. Risk Score 0–100

Route frontend: `#risk`  
API backend: `GET /api/risk-score`

Risk Score là mô hình rule-based, dễ giải thích trong bài báo cáo. Hệ thống tổng hợp:
- RSI.
- MACD histogram.
- EMA50/EMA200.
- Bollinger Band width.
- ATR.
- Volume so với MA20.
- Độ mới dữ liệu.

Kết quả gồm:
- `score`: 0–100.
- `level`: LOW / MEDIUM / HIGH.
- `label_vi`: mô tả tiếng Việt.
- `factors`: các yếu tố đóng góp điểm rủi ro.
- `recommendation`: hành động thận trọng.

### 3. Rule-based Market Alerts

Route frontend: `#risk`  
API backend: `GET /api/market-alerts`

Hệ thống sinh cảnh báo từ dữ liệu hiện tại:
- RSI quá mua/quá bán.
- MACD histogram âm.
- Giá gần dải Bollinger trên/dưới.
- ATR cao.
- Dữ liệu OHLCV/P2P cũ.
- P2P spread lệch mạnh.

Đây là cảnh báo tham khảo, không phải lệnh giao dịch.

### 4. P2P Comparison

Route frontend: `#risk` và `#settlement`  
API backend: `GET /api/p2p-comparison`

So sánh:
- Giá P2P.
- Giá thị trường quy đổi VNĐ.
- Chênh lệch VNĐ/USDT.
- Chênh lệch phần trăm.
- Kết luận chiều mua/bán có lợi hơn hay kém lợi hơn.

### 5. Indicator Guide

Route frontend: `#guide`

Trang giải thích ngắn gọn cho người mới:
- RSI.
- MACD.
- EMA 20/50/200.
- Bollinger Bands.
- ATR.
- Volume MA20.

## API mới

```text
GET /api/data-reliability
GET /api/risk-score
GET /api/market-alerts
GET /api/p2p-comparison
```

## GitHub Actions cập nhật

Workflow sync dữ liệu đã mặc định dùng:

```text
SYNC_SOURCE=binance
BINANCE_API_BASE=https://data-api.binance.vision
```

Cấu hình này tránh lỗi `451` khi GitHub Actions gọi `api.binance.com` từ một số vùng runner.

## Ghi chú báo cáo

Có thể mô tả tính mới như sau:

> Hệ thống không chỉ hiển thị giá BTC mà còn kiểm tra độ tin cậy dữ liệu, tổng hợp rủi ro thành Risk Score 0–100, sinh cảnh báo rule-based, so sánh giá sàn với giá P2P và dùng AI để giải thích bằng tiếng Việt. Các tính năng này giúp người dùng phổ thông giảm phụ thuộc vào cảm tính khi đọc dữ liệu tài chính, đồng thời vẫn giữ phạm vi học thuật vì không thực hiện giao dịch thật và không đưa lời khuyên đầu tư cá nhân.
