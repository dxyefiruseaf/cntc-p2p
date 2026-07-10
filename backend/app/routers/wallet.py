from __future__ import annotations

import hashlib
import hmac
import urllib.parse
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.config import get_settings
from app.repositories.market_repository import (
    create_wallet_topup,
    get_wallet_for_user,
    get_wallet_topup_by_txn_ref,
    list_wallet_transactions,
    mark_wallet_topup_failed,
    mark_wallet_topup_success,
)

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


class CreateWalletTopupRequest(BaseModel):
    amount_vnd: int = Field(..., ge=10_000, le=50_000_000)


class DemoConfirmTopupRequest(BaseModel):
    txn_ref: str = Field(..., min_length=6, max_length=120)


def _vnp_hash(params: dict[str, Any], secret: str) -> str:
    filtered = {
        k: str(v)
        for k, v in params.items()
        if v is not None and k not in {"vnp_SecureHash", "vnp_SecureHashType"}
    }
    query = urllib.parse.urlencode(sorted(filtered.items()))
    return hmac.new(secret.encode("utf-8"), query.encode("utf-8"), hashlib.sha512).hexdigest()


def _verify_vnp(params: dict[str, Any]) -> bool:
    settings = get_settings()
    received = params.get("vnp_SecureHash")
    if not settings.vnpay_hash_secret or not received:
        return False
    expected = _vnp_hash(params, settings.vnpay_hash_secret)
    return hmac.compare_digest(str(received).lower(), expected.lower())


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "127.0.0.1"


def _wallet_return_url(request: Request) -> str:
    settings = get_settings()
    if settings.vnpay_wallet_return_url:
        return settings.vnpay_wallet_return_url
    if settings.vnpay_return_url:
        return settings.vnpay_return_url.replace("/api/payment/return", "/api/wallet/topup/return")
    return str(request.url_for("wallet_topup_return"))


@router.get("/me")
async def wallet_me(request: Request):
    user = get_current_user(request)
    wallet = get_wallet_for_user(user["id"])
    transactions = list_wallet_transactions(user["id"], limit=10)
    return {
        "wallet": wallet,
        "transactions": transactions,
        "sandbox": True,
        "disclaimer": "Ví điện tử demo phục vụ học phần, không phát sinh tiền thật.",
    }


@router.get("/transactions")
async def wallet_transactions(request: Request, limit: int = 50):
    user = get_current_user(request)
    return {"data": list_wallet_transactions(user["id"], limit=max(1, min(limit, 100)))}


@router.post("/topup/create")
async def create_topup(payload: CreateWalletTopupRequest, request: Request):
    """Create a wallet top-up.

    Default course mode is internal demo payment: no bank app, no real money, no VNPay key required.
    Set WALLET_DEMO_PAYMENT_ENABLED=false and configure VNPay to use real VNPay Sandbox redirect.
    """
    settings = get_settings()
    user = get_current_user(request)

    now = datetime.now(timezone.utc)
    prefix = "DEMO" if settings.wallet_demo_payment_enabled else "WALLET"
    txn_ref = f"{prefix}-{user['id'][:8]}-{int(now.timestamp())}-{uuid4().hex[:6]}"

    topup = create_wallet_topup({
        "user_id": user["id"],
        "amount_vnd": payload.amount_vnd,
        "vnp_txn_ref": txn_ref,
        "status": "pending",
    })
    if not topup:
        raise HTTPException(status_code=503, detail="Không tạo được giao dịch nạp ví")

    # Demo mode: QR is a local/demo payload and user confirms with a button.
    # This is the safest mode for presentations because it never opens a real banking/payment flow.
    if settings.wallet_demo_payment_enabled:
        demo_confirm_url = f"{settings.frontend_url.rstrip('/')}/#wallet?demo_txn_ref={urllib.parse.quote(txn_ref)}&demo_amount={payload.amount_vnd}"
        qr_payload = (
            "BTC_BIGDATA_WALLET_DEMO_TOPUP|"
            f"txn_ref={txn_ref}|amount_vnd={payload.amount_vnd}|mode=coursework_no_real_money"
        )
        create_wallet_topup({
            "user_id": user["id"],
            "amount_vnd": payload.amount_vnd,
            "vnp_txn_ref": txn_ref,
            "status": "pending",
            "payment_url": demo_confirm_url,
        }, upsert=True)
        return {
            "payment_url": demo_confirm_url,
            "qr_payload": qr_payload,
            "demo_confirm_url": demo_confirm_url,
            "txn_ref": txn_ref,
            "amount_vnd": payload.amount_vnd,
            "sandbox": True,
            "payment_mode": "demo",
            "message": "Thanh toán demo không mất phí: quét QR để minh họa, sau đó bấm Xác nhận thanh toán demo để cộng ví.",
        }

    # VNPay Sandbox mode: requires sandbox merchant keys.
    if not settings.vnpay_tmn_code or not settings.vnpay_hash_secret:
        raise HTTPException(status_code=503, detail="VNPay Sandbox chưa được cấu hình. Bật WALLET_DEMO_PAYMENT_ENABLED=true để demo không mất phí.")

    return_url = _wallet_return_url(request)
    params = {
        "vnp_Version": "2.1.0",
        "vnp_Command": "pay",
        "vnp_TmnCode": settings.vnpay_tmn_code,
        "vnp_Amount": int(payload.amount_vnd * 100),
        "vnp_CurrCode": "VND",
        "vnp_TxnRef": txn_ref,
        "vnp_OrderInfo": f"Nap vi dien tu demo BTC BigData {payload.amount_vnd} VND",
        "vnp_OrderType": "billpayment",
        "vnp_Locale": "vn",
        "vnp_ReturnUrl": return_url,
        "vnp_IpAddr": _client_ip(request),
        "vnp_CreateDate": now.strftime("%Y%m%d%H%M%S"),
    }
    params["vnp_SecureHash"] = _vnp_hash(params, settings.vnpay_hash_secret)
    payment_url = f"{settings.vnpay_pay_url}?{urllib.parse.urlencode(sorted(params.items()))}"

    create_wallet_topup({
        "user_id": user["id"],
        "amount_vnd": payload.amount_vnd,
        "vnp_txn_ref": txn_ref,
        "status": "pending",
        "payment_url": payment_url,
    }, upsert=True)

    return {
        "payment_url": payment_url,
        "qr_payload": payment_url,
        "txn_ref": txn_ref,
        "amount_vnd": payload.amount_vnd,
        "sandbox": True,
        "payment_mode": "vnpay_sandbox",
        "message": "Quét QR hoặc mở liên kết để thanh toán qua VNPay Sandbox.",
    }


@router.post("/topup/demo-confirm")
async def demo_confirm_topup(payload: DemoConfirmTopupRequest, request: Request):
    """Confirm a demo top-up without real money.

    This endpoint is intentionally available only when WALLET_DEMO_PAYMENT_ENABLED=true.
    It is for classroom/demo use and still checks that the top-up belongs to the logged-in user.
    """
    settings = get_settings()
    if not settings.wallet_demo_payment_enabled:
        raise HTTPException(status_code=403, detail="Chế độ thanh toán demo đang tắt")

    user = get_current_user(request)
    topup = get_wallet_topup_by_txn_ref(payload.txn_ref)
    if not topup or topup.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Không tìm thấy giao dịch nạp ví demo")
    if topup.get("status") == "failed":
        raise HTTPException(status_code=400, detail="Giao dịch đã thất bại, không thể xác nhận")

    updated = mark_wallet_topup_success(payload.txn_ref)
    wallet = get_wallet_for_user(user["id"])
    return {
        "ok": True,
        "payment_mode": "demo",
        "message": "Đã xác nhận thanh toán demo. Số dư ví đã được cộng, không phát sinh tiền thật.",
        "topup": updated,
        "wallet": wallet,
    }


@router.get("/topup/status")
async def topup_status(request: Request, txn_ref: str):
    user = get_current_user(request)
    topup = get_wallet_topup_by_txn_ref(txn_ref)
    if not topup or topup.get("user_id") != user["id"]:
        raise HTTPException(status_code=404, detail="Không tìm thấy giao dịch nạp ví")
    return topup


@router.get("/topup/return", response_class=HTMLResponse, name="wallet_topup_return")
async def wallet_topup_return(request: Request):
    params = dict(request.query_params)
    ok = _verify_vnp(params)
    txn_ref = str(params.get("vnp_TxnRef", ""))
    response_code = str(params.get("vnp_ResponseCode", ""))
    transaction_status = str(params.get("vnp_TransactionStatus", ""))
    paid = ok and response_code == "00" and (not transaction_status or transaction_status == "00")

    if txn_ref:
        topup = get_wallet_topup_by_txn_ref(txn_ref)
        if topup:
            if paid:
                mark_wallet_topup_success(txn_ref)
            elif ok:
                mark_wallet_topup_failed(txn_ref)

    settings = get_settings()
    status = "success" if paid else "failed"
    target = (
        f"{settings.frontend_url.rstrip('/')}/#wallet?txn_ref={urllib.parse.quote(txn_ref)}"
        f"&wallet_paid={'1' if paid else '0'}&verified={'1' if ok else '0'}&status={status}"
    )
    return f"""
    <html lang="vi"><head><meta charset="utf-8"><meta http-equiv="refresh" content="1;url={target}"><title>VNPay Wallet Sandbox</title></head>
    <body style="font-family:Arial;padding:32px"><h2>Đang chuyển về ví điện tử demo...</h2><p>Trạng thái: {'thành công' if paid else 'thất bại hoặc chữ ký không hợp lệ'}.</p><p><a href="{target}">Bấm vào đây nếu trình duyệt không tự chuyển.</a></p></body></html>
    """
