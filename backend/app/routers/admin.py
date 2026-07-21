from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any
import os
import subprocess
import sys

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import require_admin
from app.config import get_settings
from app.data_loader import load_mock_data
from app.repositories.market_repository import get_latest_ohlcv, get_ohlcv, get_p2p_spread, upsert_ohlcv, upsert_p2p
from app.schemas import SeedRequest
from app.supabase_client import get_supabase

router = APIRouter(prefix="/api/admin", tags=["admin"])

BACKEND_ROOT = Path(__file__).resolve().parents[2]
SYNC_SCRIPT = BACKEND_ROOT / "scripts" / "sync_market_data.py"
DATA_FRESH_THRESHOLD_HOURS = 2.0
_DATA_SYNC_STATE_LOCK = Lock()
_DATA_SYNC_STATE: dict[str, Any] = {
    "status": "idle",
    "started_at": None,
    "finished_at": None,
    "requested_by": None,
    "message": "Chưa có yêu cầu đồng bộ thủ công.",
    "error": None,
    "output_tail": None,
}


class AdminUserStatusUpdate(BaseModel):
    status: str = Field(..., pattern="^(active|suspended)$")


def _rows(table: str, fields: str = "*", *, limit: int = 100, order_by: str | None = None) -> list[dict[str, Any]]:
    sb = get_supabase()
    if sb is None:
        return []
    try:
        query = sb.table(table).select(fields)
        if order_by:
            query = query.order(order_by, desc=True)
        return query.limit(limit).execute().data or []
    except Exception:
        return []


def _count(table: str, field: str = "id", filters: dict[str, Any] | None = None) -> int:
    sb = get_supabase()
    if sb is None:
        return 0
    try:
        query = sb.table(table).select(field, count="exact")
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        res = query.execute()
        return int(res.count if res.count is not None else len(res.data or []))
    except Exception:
        try:
            query = sb.table(table).select(field)
            for key, value in (filters or {}).items():
                query = query.eq(key, value)
            return len(query.execute().data or [])
        except Exception:
            return 0


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value if value is not None else default)
    except (TypeError, ValueError):
        return default


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def _utc_iso(value: datetime | None) -> str | None:
    return value.astimezone(timezone.utc).isoformat() if value else None


def _freshness_item(timestamp: Any, now: datetime) -> dict[str, Any]:
    parsed = _parse_time(timestamp)
    if parsed is None:
        return {
            "timestamp": timestamp,
            "age_hours": None,
            "late_by_hours": None,
            "state": "missing",
            "fresh": False,
        }

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed = parsed.astimezone(timezone.utc)
    age_hours = max(0.0, (now - parsed).total_seconds() / 3600)
    late_by = max(0.0, age_hours - DATA_FRESH_THRESHOLD_HOURS)
    if age_hours <= DATA_FRESH_THRESHOLD_HOURS:
        state = "fresh"
    elif age_hours <= 6:
        state = "late"
    else:
        state = "stale"
    return {
        "timestamp": _utc_iso(parsed),
        "age_hours": round(age_hours, 2),
        "late_by_hours": round(late_by, 2),
        "state": state,
        "fresh": state == "fresh",
    }


def _data_freshness() -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    latest = get_latest_ohlcv() or {}
    p2p_rows = get_p2p_spread(1)
    ohlcv = _freshness_item(latest.get("timestamp"), now)
    p2p = _freshness_item((p2p_rows[0] if p2p_rows else {}).get("timestamp"), now)
    rank = {"fresh": 0, "late": 1, "stale": 2, "missing": 3}
    state = max((ohlcv["state"], p2p["state"]), key=lambda value: rank.get(value, 3))
    needs_sync = state != "fresh"
    if state == "fresh":
        message = "Dữ liệu thị trường đang đúng lịch đồng bộ."
    elif state == "late":
        message = "Dữ liệu đã trễ lịch. Nên đồng bộ ngay để tránh hiển thị số liệu cũ."
    elif state == "stale":
        message = "Dữ liệu đã quá cũ và cần đồng bộ ngay."
    else:
        message = "Chưa tìm thấy dữ liệu thị trường trong Supabase."
    return {
        "state": state,
        "needs_sync": needs_sync,
        "threshold_hours": DATA_FRESH_THRESHOLD_HOURS,
        "checked_at": now.isoformat(),
        "message": message,
        "ohlcv": ohlcv,
        "p2p": p2p,
    }


def _sync_state_snapshot() -> dict[str, Any]:
    with _DATA_SYNC_STATE_LOCK:
        return dict(_DATA_SYNC_STATE)


def _set_sync_state(**updates: Any) -> None:
    with _DATA_SYNC_STATE_LOCK:
        _DATA_SYNC_STATE.update(updates)


def _run_manual_sync(requested_by: str | None) -> None:
    started_at = datetime.now(timezone.utc)
    _set_sync_state(
        status="running",
        started_at=started_at.isoformat(),
        finished_at=None,
        requested_by=requested_by,
        message="Đang lấy dữ liệu mới và cập nhật Supabase...",
        error=None,
        output_tail=None,
    )

    try:
        if not SYNC_SCRIPT.exists():
            raise RuntimeError(f"Không tìm thấy script đồng bộ: {SYNC_SCRIPT}")
        env = os.environ.copy()
        env.setdefault("PYTHONUNBUFFERED", "1")
        result = subprocess.run(
            [sys.executable, str(SYNC_SCRIPT)],
            cwd=str(BACKEND_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        combined = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part and part.strip())
        output_tail = combined[-3000:] if combined else None
        if result.returncode != 0:
            raise RuntimeError(output_tail or f"Script kết thúc với mã lỗi {result.returncode}")
        freshness = _data_freshness()
        _set_sync_state(
            status="success",
            finished_at=datetime.now(timezone.utc).isoformat(),
            message=(
                "Đồng bộ hoàn tất và dữ liệu đã trở lại trạng thái mới."
                if freshness.get("state") == "fresh"
                else "Đồng bộ hoàn tất nhưng dữ liệu vẫn chưa đạt ngưỡng mới; hãy kiểm tra nguồn dữ liệu."
            ),
            error=None,
            output_tail=output_tail,
        )
    except subprocess.TimeoutExpired as exc:
        _set_sync_state(
            status="failed",
            finished_at=datetime.now(timezone.utc).isoformat(),
            message="Đồng bộ vượt quá 5 phút và đã bị dừng.",
            error=str(exc),
        )
    except Exception as exc:
        _set_sync_state(
            status="failed",
            finished_at=datetime.now(timezone.utc).isoformat(),
            message="Không đồng bộ được dữ liệu.",
            error=str(exc),
        )


def _recent_activity(
    profiles: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    trades: list[dict[str, Any]],
    ai_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    profile_by_id = {str(row.get("user_id")): row for row in profiles}

    for row in orders[:12]:
        profile = profile_by_id.get(str(row.get("user_id")), {})
        items.append({
            "type": "premium",
            "title": "Thanh toán Premium Sandbox",
            "detail": profile.get("email") or "Người dùng",
            "status": row.get("status") or "pending",
            "amount_vnd": row.get("amount_vnd"),
            "created_at": row.get("paid_at") or row.get("created_at"),
        })
    for row in trades[:12]:
        profile = profile_by_id.get(str(row.get("user_id")), {})
        items.append({
            "type": "trade",
            "title": f"Lệnh {str(row.get('side') or '').upper()} demo",
            "detail": profile.get("email") or "Người dùng",
            "status": "completed",
            "amount_vnd": row.get("amount_vnd"),
            "created_at": row.get("created_at"),
        })
    for row in ai_rows[:10]:
        profile = profile_by_id.get(str(row.get("user_id")), {})
        items.append({
            "type": "ai",
            "title": "Câu hỏi AI Advisor",
            "detail": profile.get("email") or "Người dùng",
            "status": str(row.get("verdict") or "NEUTRAL").lower(),
            "created_at": row.get("created_at"),
        })

    items.sort(key=lambda item: _parse_time(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return items[:18]


@router.get("/me")
def admin_me(request: Request):
    admin = require_admin(request)
    return {
        "user_id": admin["id"],
        "email": admin.get("email"),
        "role": "admin",
        "status": (admin.get("profile") or {}).get("status", "active"),
    }


@router.get("/dashboard")
def admin_dashboard(request: Request):
    admin = require_admin(request)
    settings = get_settings()
    now = datetime.now(timezone.utc)
    online_cutoff = now - timedelta(hours=24)

    profiles = _rows(
        "user_profiles",
        "user_id,email,full_name,role,status,password_set,created_at,last_login_at",
        limit=1000,
        order_by="created_at",
    )
    orders = _rows(
        "orders",
        "id,user_id,plan_id,amount_vnd,vnp_txn_ref,status,created_at,paid_at",
        limit=120,
        order_by="created_at",
    )
    trades = _rows(
        "demo_trades",
        "id,user_id,side,amount_vnd,amount_usdt,applied_price,created_at",
        limit=120,
        order_by="created_at",
    )
    ai_rows = _rows(
        "ai_analysis_history",
        "id,user_id,question,verdict,confidence,created_at",
        limit=120,
        order_by="created_at",
    )
    alerts = _rows("alert_rules", "id,user_id,active,created_at", limit=1000, order_by="created_at")
    subscriptions = _rows("subscriptions", "user_id,plan_id,active,expires_at", limit=1000)
    wallets = _rows("wallets", "user_id,balance_vnd,balance_usdt_demo,updated_at", limit=1000)

    active_profiles = [row for row in profiles if str(row.get("status") or "active") == "active"]
    online_users = sum(
        1
        for row in profiles
        if (last_login := _parse_time(row.get("last_login_at"))) and last_login >= online_cutoff
    )
    active_premium = [row for row in subscriptions if row.get("active") is True]
    successful_orders = [row for row in orders if row.get("status") == "success"]
    revenue_vnd = sum(_as_float(row.get("amount_vnd")) for row in successful_orders)
    trade_volume_vnd = sum(_as_float(row.get("amount_vnd")) for row in trades)
    wallet_balance_vnd = sum(_as_float(row.get("balance_vnd")) for row in wallets)
    latest = get_latest_ohlcv() or {}
    market_series = get_ohlcv(72)

    return {
        "admin": {"email": admin.get("email"), "role": "admin"},
        "summary": {
            "total_users": len(profiles) or _count("user_profiles", "user_id"),
            "active_users": len(active_profiles),
            "online_24h": online_users,
            "premium_users": len(active_premium),
            "successful_orders": len(successful_orders),
            "revenue_vnd": revenue_vnd,
            "trade_count": len(trades),
            "trade_volume_vnd": trade_volume_vnd,
            "ai_questions": _count("ai_analysis_history"),
            "active_alerts": sum(1 for row in alerts if row.get("active") is True),
            "wallet_balance_vnd": wallet_balance_vnd,
        },
        "market": {
            "latest": latest,
            "series": market_series,
        },
        "activity": _recent_activity(profiles, orders, trades, ai_rows),
        "system": {
            "api": "operational",
            "database": "operational" if get_supabase() is not None else "not_configured",
            "ai_provider": settings.ai_provider,
            "environment": settings.app_env,
            "data_points": len(market_series),
            "checked_at": now.isoformat(),
            "data_freshness": _data_freshness(),
            "data_sync": _sync_state_snapshot(),
        },
    }


@router.get("/data-sync/status")
def admin_data_sync_status(request: Request):
    require_admin(request)
    return {
        "data": _data_freshness(),
        "sync": _sync_state_snapshot(),
    }


@router.post("/data-sync", status_code=202)
def start_admin_data_sync(background_tasks: BackgroundTasks, request: Request):
    admin = require_admin(request)
    with _DATA_SYNC_STATE_LOCK:
        if _DATA_SYNC_STATE.get("status") in {"queued", "running"}:
            raise HTTPException(status_code=409, detail="Một tiến trình đồng bộ dữ liệu đang chạy")
        _DATA_SYNC_STATE.update({
            "status": "queued",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "requested_by": admin.get("email"),
            "message": "Yêu cầu đồng bộ đã được đưa vào hàng đợi.",
            "error": None,
            "output_tail": None,
        })
    background_tasks.add_task(_run_manual_sync, admin.get("email"))
    return {
        "accepted": True,
        "data": _data_freshness(),
        "sync": _sync_state_snapshot(),
    }


@router.get("/users")
def admin_users(
    request: Request,
    limit: int = Query(100, ge=1, le=500),
    search: str = Query("", max_length=120),
):
    require_admin(request)
    profiles = _rows(
        "user_profiles",
        "user_id,email,full_name,role,status,password_set,created_at,last_login_at",
        limit=500,
        order_by="created_at",
    )
    subscriptions = _rows("subscriptions", "user_id,plan_id,active,expires_at", limit=1000)
    wallets = _rows("wallets", "user_id,balance_vnd,balance_usdt_demo,updated_at", limit=1000)
    trades = _rows("demo_trades", "user_id,amount_vnd,side,created_at", limit=3000)

    subscription_by_user = {
        str(row.get("user_id")): row
        for row in subscriptions
        if row.get("active") is True
    }
    wallet_by_user = {str(row.get("user_id")): row for row in wallets}
    trade_count_by_user: dict[str, int] = {}
    for row in trades:
        user_id = str(row.get("user_id") or "")
        trade_count_by_user[user_id] = trade_count_by_user.get(user_id, 0) + 1

    needle = search.strip().lower()
    if needle:
        profiles = [
            row for row in profiles
            if needle in str(row.get("email") or "").lower()
            or needle in str(row.get("full_name") or "").lower()
        ]

    data = []
    for row in profiles[:limit]:
        user_id = str(row.get("user_id"))
        subscription = subscription_by_user.get(user_id)
        wallet = wallet_by_user.get(user_id, {})
        data.append({
            **row,
            "plan_id": subscription.get("plan_id") if subscription else "free",
            "premium_active": bool(subscription),
            "premium_expires_at": subscription.get("expires_at") if subscription else None,
            "wallet_balance_vnd": wallet.get("balance_vnd", 0),
            "wallet_balance_btc": wallet.get("balance_usdt_demo", 0),
            "trade_count": trade_count_by_user.get(user_id, 0),
        })

    return {"count": len(data), "total": len(profiles), "data": data}


@router.patch("/users/{user_id}/status")
def update_admin_user_status(user_id: str, payload: AdminUserStatusUpdate, request: Request):
    admin = require_admin(request)
    if user_id == admin["id"] and payload.status != "active":
        raise HTTPException(status_code=400, detail="Không thể tự khóa tài khoản admin đang đăng nhập")

    sb = get_supabase()
    if sb is None:
        raise HTTPException(status_code=503, detail="Supabase chưa được cấu hình")
    try:
        res = (
            sb.table("user_profiles")
            .update({"status": payload.status})
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Không cập nhật được trạng thái người dùng: {exc}") from exc
    if not res.data:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    return res.data[0]


@router.post("/seed-demo-data")
def seed_demo_data(payload: SeedRequest):
    # Keep backward compatibility with scheduled seed/sync jobs that use the
    # dedicated token and do not have a user session.
    settings = get_settings()
    if payload.token != settings.admin_seed_token:
        raise HTTPException(status_code=403, detail="Token seed không hợp lệ")

    mock = load_mock_data()
    ohlcv_rows = mock["ohlcv"]["data"][-payload.limit_ohlcv :]
    p2p_rows = mock["p2p"]["data"][: payload.limit_p2p]

    ohlcv_count = upsert_ohlcv(ohlcv_rows)
    p2p_count = upsert_p2p(p2p_rows)
    return {"ok": True, "inserted_or_updated": {"ohlcv": ohlcv_count, "p2p": p2p_count}}
