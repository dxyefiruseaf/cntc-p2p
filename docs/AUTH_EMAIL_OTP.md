# Chuyển xác thực email từ Magic Link sang OTP Code

## Mục tiêu

Bản trước dùng Supabase Magic Link. Sau khi người dùng bấm link, Supabase trả session trong URL fragment dạng `#access_token=...&refresh_token=...`. Cách này chạy được nhưng dễ gây hiểu nhầm là lộ key và có thể gặp lỗi `otp_expired` khi link hết hạn hoặc bị email client mở trước.

Bản này chuyển sang luồng OTP code:

```text
Người dùng nhập email
→ Supabase gửi mã OTP qua email
→ Người dùng nhập mã trên website
→ Frontend gọi verifyOtp
→ Sau khi xác thực, người dùng đặt mật khẩu để dùng lâu dài
```

## File đã chỉnh

```text
frontend/src/main.js
```

Các thay đổi chính:

- Tắt parse token từ URL bằng `detectSessionInUrl: false`.
- Bỏ nút gửi Magic Link.
- Thêm nút gửi mã OTP qua email.
- Thêm ô nhập mã OTP cho đăng ký và đăng nhập.
- Dùng `supabase.auth.verifyOtp({ email, token, type: 'email' })`.
- Tự xóa các hash cũ như `#access_token=...` hoặc `#error_code=otp_expired` khỏi thanh địa chỉ.
- Chuẩn hóa `VITE_API_BASE_URL` để tránh lỗi double slash khi host.

## Cấu hình Supabase bắt buộc

Vào Supabase Dashboard:

```text
Authentication → Email Templates
```

Chọn template dùng cho OTP/Magic Link rồi sửa nội dung email để hiển thị mã:

```html
<p>Mã xác thực BTC BigData của bạn là:</p>
<h2>{{ .Token }}</h2>
<p>Mã có thời hạn ngắn. Không chia sẻ mã này cho người khác.</p>
```

Không nên để nút/link dùng `{{ .ConfirmationURL }}` nếu mục tiêu là tránh token trên URL.

## Luồng sử dụng

### Đăng ký

1. Vào trang Tài khoản.
2. Nhập email.
3. Bấm `Gửi mã OTP xác thực`.
4. Mở email, copy mã 6 số.
5. Nhập mã trên website.
6. Sau khi xác thực thành công, đặt mật khẩu.

### Đăng nhập

Có 2 cách:

1. Đăng nhập bằng mật khẩu đã đặt.
2. Hoặc bấm `Gửi mã OTP qua email`, nhập mã OTP để đăng nhập không cần link.

## Ghi chú bảo mật

- `VITE_SUPABASE_ANON_KEY` vẫn có thể nằm ở frontend vì đây là public anon key.
- Tuyệt đối không đặt `SUPABASE_SERVICE_ROLE_KEY` trên Vercel/frontend.
- Nếu người dùng từng bấm magic link cũ, frontend sẽ xóa token khỏi URL và yêu cầu dùng luồng OTP mới.
