from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Callable
import os
import subprocess
import sys

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.auth import require_admin
from app.cache import TTLCache
from app.config import get_settings
from app.data_loader import load_mock_data
from app.repositories.market_repository import (
    get_latest_ohlcv,
    get_ohlcv,
    get_p2p_spread,
    upsert_ohlcv,
    upsert_p2p,
)
from app.schemas import SeedRequest
from app.supabase_client import get_supabase

router = APIRouter(prefix="/api/admin", tags=["admin"])

BACKEND_ROOT = Path(__file__).resolve().parents[2]
SYNC_SCRIPT = BACKEND_ROOT / "scripts" / "sync_market_data.py"
DATA_FRESH_THRESHOLD_HOURS = 2.0

# Cache TTLs are intentionally short: Admin gets fast repeat loads while data
# still refreshes frequently enough for a monitoring dashboard.
OVERVIEW_CACHE_SECONDS = 45
ACTIVITY_CACHE_SECONDS = 30
USERS_CACHE_SECONDS = 60
SYSTEM_CACHE_SECONDS = 15
FRESHNESS_CACHE_SECONDS = 10
_ADMIN_CACHE = TTLCache(max_entries=256)

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


def _private_cache_headers(response: Response, seconds: int) -> None:
    response.headers["Cache-Control"] = f"private, max-age={seconds}, stale-while-revalidate={seconds * 2}"
    response.headers["Vary"] = "Authorization"


def _invalidate_admin_cache(*prefixes: str) -> None:
    if not prefixes:
        _ADMIN_CACHE.clear()
        return
    for prefix in prefixes:
        _ADMIN_CACHE.delete_prefix(prefix)


def _cached(key: str, ttl_seconds: int, factory: Callable[[], Any], refresh: bool = False) -> Any:
    if refresh:
        _ADMIN_CACHE.delete(key)
    return _ADMIN_CACHE.get_or_set(key, ttl_seconds, factory)


def _rows(
    table: str,
    fields: str = "*",
    *,
    limit: int = 100,
    offset: int = 0,
    order_by: str | None = None,
    filters: dict[str, Any] | None = None,
    in_filters: dict[str, list[Any]] | None = None,
) -> list[dict[str, Any]]:
    sb = get_supabase()
    if sb is None:
        return []
    try:
        query = sb.table(table).select(fields)
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        for key, values in (in_filters or {}).items():
            if not values:
                return []
            query = query.in_(key, values)
        if order_by:
            query = query.order(order_by, desc=True)
        if offset > 0:
            query = query.range(offset, offset + limit - 1)
        else:
            query = query.limit(limit)
        return query.execute().data or []
    except Exception:
        return []


def _count(
    table: str,
    field: str = "id",
    *,
    filters: dict[str, Any] | None = None,
    gte_filters: dict[str, Any] | None = None,
) -> int:
    sb = get_supabase()
    if sb is None:
        return 0
    try:
        query = sb.table(table).select(field, count="exact")
        for key, value in (filters or {}).items():
            query = query.eq(key, value)
        for key, value in (gte_filters or {}).items():
            query = query.gte(key, value)
        res = query.limit(1).execute()
        return int(res.count if res.count is not None else len(res.data or []))
    except Exception:
        return 0


def _rpc_json(name: str, params: dict[str, Any] | None = None) -> dict[str, Any] | None:
    sb = get_supabase()
    if sb is None:
        return None
    try:
        data = sb.rpc(name, params or {}).execute().data
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
    except Exception:
        return None
    return None


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


def _build_data_freshness() -> dict[str, Any]:
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


def _data_freshness(force: bool = False) -> dict[str, Any]:
    return _cached("admin:freshness", FRESHNESS_CACHE_SECONDS, _build_data_freshness, refresh=force)


def _sync_state_snapshot() -> dict[str, Any]:
    with _DATA_SYNC_STATE_LOCK:
        return dict(_DATA_SYNC_STATE)


def _set_sync_state(**updates: Any) -> None:
    with _DATA_SYNC_STATE_LOCK:
        _DATA_SYNC_STATE.update(updates)


def _dashboard_summary() -> dict[str, Any]:
    # Fast path: one PostgreSQL RPC replaces multiple table scans. The SQL
    # migration is included in supabase/schema.sql. Fallback keeps old DBs usable.
    rpc_summary = _rpc_json("admin_dashboard_summary")
    if rpc_summary:
        return rpc_summary

    now = datetime.now(timezone.utc)
    online_cutoff = (now - timedelta(hours=24)).isoformat()
    successful_orders = _rows(
        "orders", "amount_vnd", limit=1000, filters={"status": "success"}
    )
    trades = _rows("demo_trades", "amount_vnd", limit=1000)
    wallets = _rows("wallets", "balance_vnd", limit=1000)
    return {
        "total_users": _count("user_profiles", "user_id"),
        "active_users": _count("user_profiles", "user_id", filters={"status": "active"}),
        "online_24h": _count("user_profiles", "user_id", gte_filters={"last_login_at": online_cutoff}),
        "premium_users": _count("subscriptions", "user_id", filters={"active": True}),
        "successful_orders": _count("orders", "id", filters={"status": "success"}),
        "revenue_vnd": sum(_as_float(row.get("amount_vnd")) for row in successful_orders),
        "trade_count": _count("demo_trades", "id"),
        "trade_volume_vnd": sum(_as_float(row.get("amount_vnd")) for row in trades),
        "ai_questions": _count("ai_analysis_history", "id"),
        "active_alerts": _count("alert_rules", "id", filters={"active": True}),
        "wallet_balance_vnd": sum(_as_float(row.get("balance_vnd")) for row in wallets),
    }


def _profiles_for_ids(user_ids: set[str]) -> list[dict[str, Any]]:
    clean_ids = [value for value in user_ids if value]
    if not clean_ids:
        return []
    return _rows(
        "user_profiles",
        "user_id,email,full_name,role,status",
        limit=max(1, len(clean_ids)),
        in_filters={"user_id": clean_ids},
    )


def _recent_activity_rows() -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    orders = _rows(
        "orders",
        "id,user_id,plan_id,amount_vnd,vnp_txn_ref,status,created_at,paid_at",
        limit=30,
        order_by="created_at",
    )
    trades = _rows(
        "demo_trades",
        "id,user_id,side,amount_vnd,amount_usdt,applied_price,created_at",
        limit=30,
        order_by="created_at",
    )
    ai_rows = _rows(
        "ai_analysis_history",
        "id,user_id,question,verdict,confidence,created_at",
        limit=30,
        order_by="created_at",
    )
    user_ids = {
        str(row.get("user_id") or "")
        for rows in (orders, trades, ai_rows)
        for row in rows
    }
    profiles = _profiles_for_ids(user_ids)
    return profiles, orders, trades, ai_rows


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

    items.sort(
        key=lambda item: _parse_time(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return items[:18]


def _system_payload(*, data_points: int = 0, force_freshness: bool = False) -> dict[str, Any]:
    settings = get_settings()
    return {
        "api": "operational",
        "database": "operational" if get_supabase() is not None else "not_configured",
        "ai_provider": settings.ai_provider,
        "environment": settings.app_env,
        "data_points": data_points,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "data_freshness": _data_freshness(force=force_freshness),
        "data_sync": _sync_state_snapshot(),
    }


def _overview_data() -> dict[str, Any]:
    profiles, orders, trades, ai_rows = _recent_activity_rows()
    market_series = get_ohlcv(72)
    return {
        "summary": _dashboard_summary(),
        "market": {"latest": get_latest_ohlcv() or {}, "series": market_series},
        "activity": _recent_activity(profiles, orders, trades, ai_rows),
        "system": _system_payload(data_points=len(market_series)),
    }


def _activity_data() -> dict[str, Any]:
    profiles, orders, trades, ai_rows = _recent_activity_rows()
    return {
        "summary": _dashboard_summary(),
        "market": {"latest": get_latest_ohlcv() or {}, "series": []},
        "activity": _recent_activity(profiles, orders, trades, ai_rows),
        "system": _system_payload(data_points=72),
    }


def _system_data() -> dict[str, Any]:
    market_series = get_ohlcv(72)
    return {
        "summary": _dashboard_summary(),
        "market": {"latest": get_latest_ohlcv() or {}, "series": []},
        "activity": [],
        "system": _system_payload(data_points=len(market_series)),
    }


def _normalize_admin_users_rpc(data: dict[str, Any], page: int, limit: int) -> dict[str, Any]:
    rows = data.get("data") if isinstance(data.get("data"), list) else []
    total = int(data.get("total") or 0)
    return {
        "count": len(rows),
        "total": total,
        "page": int(data.get("page") or page),
        "page_size": int(data.get("page_size") or limit),
        "has_next": bool(data.get("has_next", page * limit < total)),
        "data": rows,
    }


def _users_page_fallback(page: int, limit: int, search: str, status: str, plan: str) -> dict[str, Any]:
    sb = get_supabase()
    if sb is None:
        return {"count": 0, "total": 0, "page": page, "page_size": limit, "has_next": False, "data": []}

    # Fallback for databases that have not run Feature upgrade v4 yet. It is
    # still bounded and cached, unlike the previous 500/1000/3000-row scans.
    try:
        query = sb.table("user_profiles").select(
            "user_id,email,full_name,role,status,password_set,created_at,last_login_at",
            count="exact",
        )
        needle = search.strip().replace(",", " ")
        if needle:
            query = query.or_(f"email.ilike.%{needle}%,full_name.ilike.%{needle}%")
        if status in {"active", "suspended"}:
            query = query.eq("status", status)
        query = query.order("created_at", desc=True)
        # Fetch a slightly wider window only when a plan filter must be applied
        # in Python. Normal requests fetch exactly one page.
        multiplier = 4 if plan in {"premium", "free"} else 1
        raw_limit = min(200, limit * multiplier)
        offset = (page - 1) * raw_limit
        result = query.range(offset, offset + raw_limit - 1).execute()
        profiles = result.data or []
        raw_total = int(result.count if result.count is not None else len(profiles))
    except Exception:
        profiles = _rows(
            "user_profiles",
            "user_id,email,full_name,role,status,password_set,created_at,last_login_at",
            limit=min(200, limit * 4),
            order_by="created_at",
        )
        raw_total = len(profiles)

    user_ids = [str(row.get("user_id")) for row in profiles if row.get("user_id")]
    subscriptions = _rows(
        "subscriptions",
        "user_id,plan_id,active,expires_at",
        limit=max(1, len(user_ids) * 2),
        filters={"active": True},
        in_filters={"user_id": user_ids},
    )
    wallets = _rows(
        "wallets",
        "user_id,balance_vnd,balance_usdt_demo,updated_at",
        limit=max(1, len(user_ids)),
        in_filters={"user_id": user_ids},
    )
    trades = _rows(
        "demo_trades",
        "user_id",
        limit=max(200, len(user_ids) * 100),
        in_filters={"user_id": user_ids},
    )

    subscription_by_user = {str(row.get("user_id")): row for row in subscriptions}
    wallet_by_user = {str(row.get("user_id")): row for row in wallets}
    trade_count_by_user: dict[str, int] = {}
    for row in trades:
        user_id = str(row.get("user_id") or "")
        trade_count_by_user[user_id] = trade_count_by_user.get(user_id, 0) + 1

    data: list[dict[str, Any]] = []
    for row in profiles:
        user_id = str(row.get("user_id"))
        subscription = subscription_by_user.get(user_id)
        is_premium = bool(subscription)
        if plan == "premium" and not is_premium:
            continue
        if plan == "free" and is_premium:
            continue
        wallet = wallet_by_user.get(user_id, {})
        data.append({
            **row,
            "plan_id": subscription.get("plan_id") if subscription else "free",
            "premium_active": is_premium,
            "premium_expires_at": subscription.get("expires_at") if subscription else None,
            "wallet_balance_vnd": wallet.get("balance_vnd", 0),
            "wallet_balance_btc": wallet.get("balance_usdt_demo", 0),
            "trade_count": trade_count_by_user.get(user_id, 0),
        })
        if len(data) >= limit:
            break

    total = raw_total if plan == "all" else len(data) + ((page - 1) * limit)
    return {
        "count": len(data),
        "total": total,
        "page": page,
        "page_size": limit,
        "has_next": (page * limit < raw_total) if plan == "all" else len(data) == limit,
        "data": data,
    }


def _users_page(page: int, limit: int, search: str, status: str, plan: str) -> dict[str, Any]:
    rpc_data = _rpc_json(
        "admin_users_page",
        {
            "p_page": page,
            "p_limit": limit,
            "p_search": search.strip(),
            "p_status": status,
            "p_plan": plan,
        },
    )
    if rpc_data:
        return _normalize_admin_users_rpc(rpc_data, page, limit)
    return _users_page_fallback(page, limit, search, status, plan)


def _users_data(page: int, limit: int, search: str, status: str, plan: str) -> dict[str, Any]:
    return {
        "summary": {},
        "market": {"latest": get_latest_ohlcv() or {}, "series": []},
        "activity": [],
        "system": _system_payload(data_points=72),
        "users": _users_page(page, limit, search, status, plan),
    }


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
        _invalidate_admin_cache()
        freshness = _data_freshness(force=True)
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


@router.get("/me")
def admin_me(request: Request):
    admin = require_admin(request)
    return {
        "user_id": admin["id"],
        "email": admin.get("email"),
        "role": "admin",
        "status": (admin.get("profile") or {}).get("status", "active"),
    }


@router.get("/overview")
def admin_overview(
    request: Request,
    response: Response,
    refresh: bool = Query(False),
):
    admin = require_admin(request)
    _private_cache_headers(response, OVERVIEW_CACHE_SECONDS)
    payload = dict(_cached("admin:overview", OVERVIEW_CACHE_SECONDS, _overview_data, refresh=refresh))
    payload["admin"] = {"email": admin.get("email"), "role": "admin"}
    return payload


@router.get("/dashboard")
def admin_dashboard(
    request: Request,
    response: Response,
    refresh: bool = Query(False),
):
    """Backward-compatible alias for older frontends."""
    return admin_overview(request, response, refresh)


@router.get("/activity")
def admin_activity(
    request: Request,
    response: Response,
    refresh: bool = Query(False),
):
    admin = require_admin(request)
    _private_cache_headers(response, ACTIVITY_CACHE_SECONDS)
    payload = dict(_cached("admin:activity", ACTIVITY_CACHE_SECONDS, _activity_data, refresh=refresh))
    payload["admin"] = {"email": admin.get("email"), "role": "admin"}
    return payload


@router.get("/system")
def admin_system(
    request: Request,
    response: Response,
    refresh: bool = Query(False),
):
    admin = require_admin(request)
    _private_cache_headers(response, SYSTEM_CACHE_SECONDS)
    payload = dict(_cached("admin:system", SYSTEM_CACHE_SECONDS, _system_data, refresh=refresh))
    # Sync state changes faster than the cached infrastructure snapshot.
    payload["system"] = {**(payload.get("system") or {}), "data_sync": _sync_state_snapshot()}
    payload["admin"] = {"email": admin.get("email"), "role": "admin"}
    return payload


@router.get("/data-sync/status")
def admin_data_sync_status(request: Request, response: Response):
    require_admin(request)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization"
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
    _invalidate_admin_cache("admin:system", "admin:freshness")
    background_tasks.add_task(_run_manual_sync, admin.get("email"))
    return {
        "accepted": True,
        "data": _data_freshness(force=True),
        "sync": _sync_state_snapshot(),
    }


@router.get("/users")
def admin_users(
    request: Request,
    response: Response,
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=10, le=100),
    search: str = Query("", max_length=120),
    status: str = Query("all", pattern="^(all|active|suspended)$"),
    plan: str = Query("all", pattern="^(all|premium|free)$"),
    refresh: bool = Query(False),
):
    admin = require_admin(request)
    normalized_search = search.strip().lower()
    key = f"admin:users:{page}:{limit}:{status}:{plan}:{normalized_search}"
    _private_cache_headers(response, USERS_CACHE_SECONDS)
    payload = dict(
        _cached(
            key,
            USERS_CACHE_SECONDS,
            lambda: _users_data(page, limit, normalized_search, status, plan),
            refresh=refresh,
        )
    )
    payload["admin"] = {"email": admin.get("email"), "role": "admin"}
    return payload


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
    _invalidate_admin_cache("admin:users", "admin:overview", "admin:activity", "admin:system")
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
    _invalidate_admin_cache()
    return {"ok": True, "inserted_or_updated": {"ohlcv": ohlcv_count, "p2p": p2p_count}}
