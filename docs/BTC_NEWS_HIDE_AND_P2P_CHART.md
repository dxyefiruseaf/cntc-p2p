# Cập nhật: Ẩn BTC News và đường giá BTC P2P trên biểu đồ kỹ thuật

## 1. Ẩn thanh BTC News

Thanh `BTC News` có thêm nút `×` ở bên phải. Khi bấm, frontend lưu lựa chọn vào `localStorage` với key:

```text
btc_bigdata_live_news_hidden_v1
```

Sau khi ẩn, layout dashboard không còn bị đẩy/che bởi ticker. Người dùng có thể bật lại bằng nút nhỏ `₿ Hiện BTC News`.

## 2. Đường giá mua/bán BTC theo P2P

Trang `#chart` bây giờ gọi song song:

```text
GET /api/ohlcv?hours=N
GET /api/p2p-spread?hours=N
```

Biểu đồ kỹ thuật vẫn giữ nến `BTC/USDT`, EMA và RSI. Ngoài ra có thêm hai đường trên trục VNĐ bên phải:

```text
BTC P2P bán (VNĐ) = close BTC/USDT × giá USDT/VNĐ P2P chiều SELL
BTC P2P mua (VNĐ) = close BTC/USDT × giá USDT/VNĐ P2P chiều BUY
```

Hai đường này giúp người dùng Việt Nam thấy giá Bitcoin thực tế nếu quy đổi qua thị trường P2P, thay vì chỉ nhìn giá quốc tế bằng USD.

## 3. Fix thêm khi host

Frontend có hàm `apiUrl(endpoint)` để tránh lỗi double slash:

```text
https://backend.onrender.com//api/latest
```

thành:

```text
https://backend.onrender.com/api/latest
```

Timeout API mặc định cũng tăng lên 30 giây để phù hợp Render free/cold start.
