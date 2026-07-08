from __future__ import annotations

import hashlib
import hmac
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.config import get_settings
from app.repositories.market_repository import create_order, get_order_by_txn_ref, update_order_status, upsert_subscription

router = APIRouter(prefix="/api/payment", tags=["payment"])

PLANS = {
    "premium_monthly": {"name": "Premium tháng", "amount_vnd": 49000, "days": 30},
    "premium_demo": {"name": "Premium demo", "amount_vnd": 10000, "days": 7},
}


class CreatePaymentRequest(BaseModel):
    plan_id: str = Field("premium_monthly")


def _vnp_hash(params: dict[str, Any], secret: str) -> str:
    filtered = {k: str(v) for k, v in params.items() if v is not None and k not in {"vnp_SecureHash", "vnp_SecureHashType"}}
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


@router.post("/create")
async def create_payment(payload: CreatePaymentRequest, request: Request):
    settings = get_settings()
    user = get_current_user(request)
    plan = PLANS.get(payload.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Gói không hợp lệ")
    if not settings.vnpay_tmn_code or not settings.vnpay_hash_secret:
        raise HTTPException(status_code=503, detail="VNPay Sandbox chưa được cấu hình")

    now = datetime.now(timezone.utc)
    txn_ref = f"{user['id'][:8]}-{int(now.timestamp())}-{uuid4().hex[:6]}"
    order = create_order({
        "user_id": user["id"],
        "plan_id": payload.plan_id,
        "amount_vnd": plan["amount_vnd"],
        "vnp_txn_ref": txn_ref,
        "status": "pending",
    })
    if not order:
        raise HTTPException(status_code=503, detail="Không tạo được đơn hàng")

    params = {
        "vnp_Version": "2.1.0",
        "vnp_Command": "pay",
        "vnp_TmnCode": settings.vnpay_tmn_code,
        "vnp_Amount": int(plan["amount_vnd"] * 100),
        "vnp_CurrCode": "VND",
        "vnp_TxnRef": txn_ref,
        "vnp_OrderInfo": f"BTC BigData {plan['name']} Sandbox",
        "vnp_OrderType": "other",
        "vnp_Locale": "vn",
        "vnp_ReturnUrl": settings.vnpay_return_url,
        "vnp_IpAddr": _client_ip(request),
        "vnp_CreateDate": now.strftime("%Y%m%d%H%M%S"),
    }
    params["vnp_SecureHash"] = _vnp_hash(params, settings.vnpay_hash_secret)
    payment_url = f"{settings.vnpay_pay_url}?{urllib.parse.urlencode(sorted(params.items()))}"
    return {"payment_url": payment_url, "txn_ref": txn_ref, "sandbox": True}


@router.get("/return", response_class=HTMLResponse)
async def payment_return(request: Request):
    params = dict(request.query_params)
    ok = _verify_vnp(params)
    txn_ref = params.get("vnp_TxnRef", "")
    target = f"{get_settings().frontend_url.rstrip('/')}/#payment-result?txn_ref={urllib.parse.quote(txn_ref)}&verified={'1' if ok else '0'}"
    return f"""
    <html lang=\"vi\"><head><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"1;url={target}\"><title>VNPay Sandbox</title></head>
    <body style=\"font-family:Arial;padding:32px\"><h2>Đang chuyển về BTC BigData...</h2><p>Trạng thái chữ ký: {'hợp lệ' if ok else 'không hợp lệ'}.</p><p><a href=\"{target}\">Bấm vào đây nếu trình duyệt không tự chuyển.</a></p></body></html>
    """


@router.post("/ipn")
async def payment_ipn(request: Request):
    params = dict(request.query_params)
    if not params:
        try:
            params = await request.json()
        except Exception:
            params = {}
    if not _verify_vnp(params):
        return {"RspCode": "97", "Message": "Invalid signature"}

    txn_ref = params.get("vnp_TxnRef")
    order = get_order_by_txn_ref(str(txn_ref)) if txn_ref else None
    if not order:
        return {"RspCode": "01", "Message": "Order not found"}

    if params.get("vnp_ResponseCode") == "00":
        paid_at = datetime.now(timezone.utc).isoformat()
        update_order_status(str(txn_ref), "success", paid_at)
        plan = PLANS.get(order["plan_id"], PLANS["premium_monthly"])
        upsert_subscription({
            "user_id": order["user_id"],
            "plan_id": order["plan_id"],
            "active": True,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=plan["days"])).isoformat(),
        })
        return {"RspCode": "00", "Message": "Confirm Success"}

    update_order_status(str(txn_ref), "failed")
    return {"RspCode": "00", "Message": "Confirm Failed Payment"}


@router.get("/status")
async def payment_status(txn_ref: str):
    order = get_order_by_txn_ref(txn_ref)
    if not order:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn hàng")
    return order
