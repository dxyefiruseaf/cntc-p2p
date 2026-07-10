# Ví điện tử demo + QR Code VNPay Sandbox

Tính năng này bổ sung một ví điện tử mô phỏng cho phạm vi học phần Công nghệ dịch vụ tài chính.

## Ý nghĩa học phần

- **Ví điện tử**: người dùng có số dư ví demo và lịch sử biến động số dư.
- **Thanh toán QR Code**: frontend tạo QR từ `payment_url` của VNPay Sandbox.
- **Payment Gateway**: VNPay Sandbox minh họa trung gian thanh toán, không phát sinh tiền thật.
- **Data Management**: backend lưu giao dịch nạp ví, trạng thái thanh toán và lịch sử ví trong Supabase.

## API mới

```text
GET  /api/wallet/me
GET  /api/wallet/transactions
POST /api/wallet/topup/create
GET  /api/wallet/topup/status?txn_ref=...
GET  /api/wallet/topup/return
```

## Cấu hình backend `.env`

```env
VNPAY_TMN_CODE=...
VNPAY_HASH_SECRET=...
VNPAY_PAY_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNPAY_RETURN_URL=https://your-render-app.onrender.com/api/payment/return
VNPAY_WALLET_RETURN_URL=https://your-render-app.onrender.com/api/wallet/topup/return
FRONTEND_URL=https://your-vercel-app.vercel.app
```

Nếu để trống `VNPAY_WALLET_RETURN_URL`, backend sẽ tự suy ra từ `VNPAY_RETURN_URL` bằng cách đổi `/api/payment/return` thành `/api/wallet/topup/return`.

## Supabase migration

Chạy lại:

```sql
-- supabase/schema.sql
-- supabase/rls.sql
```

Các bảng mới:

```text
wallets
wallet_topups
wallet_transactions
```

## Frontend

Trang mới:

```text
#wallet
```

Người dùng đăng nhập, nhập số tiền nạp, bấm **Tạo QR nạp ví**, sau đó quét QR hoặc bấm mở trang thanh toán Sandbox.
