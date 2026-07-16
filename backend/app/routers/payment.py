from __future__ import annotations

import hashlib
import hmac
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.config import get_settings
from app.repositories.market_repository import (
    cancel_user_subscriptions,
    create_order,
    get_active_subscription,
    get_order_by_txn_ref,
    update_order_status,
    upsert_subscription,
)

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


def _frontend_base_url() -> str:
    """Return a clean frontend origin for redirects.

    VNPay return URLs must redirect to the SPA root, not to a stale hash such as
    /#block or /#set-password. Some deployments accidentally set FRONTEND_URL
    with a hash/path, so we strip query/hash and keep only scheme + host.
    """
    raw = (get_settings().frontend_url or "http://localhost:5173").strip()
    parsed = urllib.parse.urlsplit(raw)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return raw.split("#", 1)[0].split("?", 1)[0].rstrip("/") or "http://localhost:5173"


def _apply_payment_result(txn_ref: str, params: dict[str, Any], verified: bool) -> str:
    """Update order status from browser return as a safe fallback.

    VNPay usually calls IPN, but in sandbox/demo it may be delayed or not called.
    Updating on the verified browser return keeps the demo flow from getting stuck
    at pending.
    """
    if not txn_ref:
        return "missing_txn"
    order = get_order_by_txn_ref(str(txn_ref))
    if not order:
        return "order_not_found"
    if not verified:
        return str(order.get("status") or "invalid_signature")

    response_code = str(params.get("vnp_ResponseCode") or "")
    transaction_status = str(params.get("vnp_TransactionStatus") or response_code)
    paid = response_code == "00" and transaction_status == "00"

    if paid:
        if order.get("status") != "success":
            paid_at = datetime.now(timezone.utc).isoformat()
            update_order_status(str(txn_ref), "success", paid_at)
            plan = PLANS.get(order["plan_id"], PLANS["premium_monthly"])
            upsert_subscription({
                "user_id": order["user_id"],
                "plan_id": order["plan_id"],
                "active": True,
                "expires_at": (datetime.now(timezone.utc) + timedelta(days=plan["days"])).isoformat(),
            })
        return "success"

    if order.get("status") not in {"success", "failed"}:
        update_order_status(str(txn_ref), "failed")
    return "failed"



def _plan_response(plan_id: str | None) -> dict[str, Any]:
    if not plan_id or plan_id == "free":
        return {"id": "free", "name": "Free", "amount_vnd": 0, "days": None}
    plan = PLANS.get(plan_id, PLANS["premium_monthly"])
    return {"id": plan_id, "name": plan["name"], "amount_vnd": plan["amount_vnd"], "days": plan["days"]}


def _is_subscription_expired(subscription: dict[str, Any] | None) -> bool:
    if not subscription or not subscription.get("expires_at"):
        return False
    try:
        expires_raw = str(subscription["expires_at"]).replace("Z", "+00:00")
        expires_at = datetime.fromisoformat(expires_raw)
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return expires_at < datetime.now(timezone.utc)
    except Exception:
        return False


@router.get("/subscription")
async def subscription_status(request: Request):
    user = get_current_user(request)
    subscription = get_active_subscription(user["id"])
    if _is_subscription_expired(subscription):
        cancel_user_subscriptions(user["id"])
        subscription = None

    if not subscription:
        return {
            "active": False,
            "plan_id": "free",
            "plan_name": "Free",
            "plan": _plan_response("free"),
            "features": ["Dashboard", "P2P spread", "AI cơ bản", "Ví QR demo"],
            "sandbox": True,
        }

    plan_id = str(subscription.get("plan_id") or "premium_monthly")
    plan = _plan_response(plan_id)
    return {
        "active": True,
        "plan_id": plan_id,
        "plan_name": plan["name"],
        "plan": plan,
        "expires_at": subscription.get("expires_at"),
        "subscription": subscription,
        "features": [
            "Phân tích kỹ thuật nâng cao",
            "Theo dõi chênh lệch P2P",
            "Cảnh báo nâng cao",
            "Ước tính chi phí/thuế",
            "AI Advisor",
            "Lịch sử dữ liệu sâu hơn",
            "Xuất báo cáo phân tích demo",
        ],
        "sandbox": True,
        "message": "Premium Sandbox đang hoạt động",
    }


@router.post("/cancel-subscription")
async def cancel_subscription(request: Request):
    user = get_current_user(request)
    cancel_user_subscriptions(user["id"])
    return {
        "active": False,
        "plan_id": "free",
        "plan_name": "Free",
        "plan": _plan_response("free"),
        "sandbox": True,
        "message": "Đã hủy Premium Sandbox. Tài khoản đã quay về gói Free.",
    }


@router.get("/return")
async def payment_return(request: Request):
    params = dict(request.query_params)
    verified = _verify_vnp(params)
    txn_ref = str(params.get("vnp_TxnRef") or "")
    result_status = _apply_payment_result(txn_ref, params, verified)

    query = urllib.parse.urlencode({
        "txn_ref": txn_ref,
        "verified": "1" if verified else "0",
        "status": result_status,
        "response_code": str(params.get("vnp_ResponseCode") or ""),
    })
    target = f"{_frontend_base_url()}/#payment-result?{query}"
    return RedirectResponse(target, status_code=302)


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
