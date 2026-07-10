# News ticker, BTC animation và cookie banner

Bản nâng cấp này bổ sung các phần hoàn thiện trải nghiệm người dùng nhưng vẫn trong phạm vi môn Công nghệ dịch vụ tài chính.

## 1. BTC News ticker

Frontend có ticker chạy toàn cục ở phía trên nội dung chính. Người dùng bấm vào ticker để mở trang `#news`.

Backend API mới:

```http
GET /api/news/latest?limit=12
```

Cơ chế:

```text
RSS crypto news → backend/app/routers/news.py → /api/news/latest → frontend ticker/trang News
```

Nếu RSS lỗi hoặc môi trường offline, backend trả tin demo để website không bị vỡ khi thuyết trình.

Biến môi trường tùy chọn trong `backend/.env`:

```env
NEWS_RSS_URLS=https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml
NEWS_CACHE_TTL_SECONDS=600
```

Có thể truyền nhiều RSS bằng dấu phẩy.

## 2. Trang Market News

Route frontend:

```text
#news
```

Trang này hiển thị:

- News Context Layer
- Dòng tin BTC mới nhất
- Risk Score hiện tại
- Cảnh báo rule-based liên quan
- Cách dùng tin tức trong báo cáo

Thông điệp quan trọng: tin tức chỉ là lớp ngữ cảnh, không phải tín hiệu mua/bán độc lập.

## 3. BTC animation

Frontend thêm lớp animation nhẹ:

- Coin `₿` trôi nền nhẹ
- News ticker chạy ngang
- Hover animation cho news card
- Tôn trọng `prefers-reduced-motion` để giảm chuyển động nếu trình duyệt yêu cầu

Animation chỉ dùng để tăng cảm giác sản phẩm FinTech/Crypto, không làm che dữ liệu chính.

## 4. Cookie banner

Cookie banner xuất hiện lần đầu người dùng mở web.

Nội dung minh bạch:

- Lưu lựa chọn cookie consent
- Nhớ trạng thái sidebar
- Nhớ vị trí floating AI chat
- Không dùng cookie quảng cáo trong bản demo môn học

Frontend lưu lựa chọn bằng `localStorage` và cookie đơn giản:

```text
btc_bigdata_cookie_consent_v1
btc_cookie_consent
```

## 5. Gợi ý trình bày trong báo cáo

Có thể viết:

> Hệ thống bổ sung lớp tin tức thị trường và giao diện ticker nhằm cung cấp bối cảnh cho dữ liệu giá BTC. Tin tức không được dùng như tín hiệu giao dịch độc lập mà được kết hợp với Risk Score, cảnh báo kỹ thuật và độ mới dữ liệu. Ngoài ra, website có cookie banner minh bạch việc lưu trữ local preference, phù hợp với tiêu chí trải nghiệm người dùng và bảo vệ quyền riêng tư trong phạm vi demo học thuật.
