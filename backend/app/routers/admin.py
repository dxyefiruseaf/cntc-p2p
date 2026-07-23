from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Callable
import json
import logging
import os
import subprocess
import sys
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.auth import invalidate_user_auth_cache, require_admin
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
logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).resolve().parents[2]
SYNC_SCRIPT = BACKEND_ROOT / "scripts" / "sync_market_data.py"
SYNC_STATE_FILE = BACKEND_ROOT / ".runtime" / "admin_data_sync_state.json"
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
    "job_id": None,
    "duration_seconds": None,
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
    fields: str,
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
    read_errors: list[str] = []

    try:
        latest = get_latest_ohlcv() or {}
    except Exception as exc:
        logger.exception("Could not read latest OHLCV for Admin freshness")
        latest = {}
        read_errors.append(f"ohlcv:{type(exc).__name__}")

    try:
        p2p_rows = get_p2p_spread(1)
    except Exception as exc:
        logger.exception("Could not read P2P freshness for Admin overview")
        p2p_rows = []
        read_errors.append(f"p2p:{type(exc).__name__}")

    ohlcv = _freshness_item(latest.get("timestamp"), now)
    p2p = _freshness_item((p2p_rows[0] if p2p_rows else {}).get("timestamp"), now)
    rank = {"fresh": 0, "late": 1, "stale": 2, "missing": 3}
    state = max((ohlcv["state"], p2p["state"]), key=lambda value: rank.get(value, 3))
    needs_sync = state != "fresh"
    if read_errors:
        message = "Tạm thời không đọc được đầy đủ dữ liệu Supabase; Dashboard đang dùng dữ liệu cache hoặc trạng thái dự phòng."
    elif state == "fresh":
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
        "degraded": bool(read_errors),
        "read_errors": read_errors,
        "ohlcv": ohlcv,
        "p2p": p2p,
    }


def _data_freshness(force: bool = False) -> dict[str, Any]:
    return _cached("admin:freshness", FRESHNESS_CACHE_SECONDS, _build_data_freshness, refresh=force)


def _load_sync_state_unlocked() -> None:
    try:
        if not SYNC_STATE_FILE.exists():
            return
        payload = json.loads(SYNC_STATE_FILE.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            _DATA_SYNC_STATE.update(payload)
    except Exception as exc:
        logger.warning("Could not read persisted data sync state: %s", exc)


def _write_sync_state_unlocked() -> None:
    try:
        SYNC_STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = SYNC_STATE_FILE.with_suffix(".tmp")
        temporary.write_text(json.dumps(_DATA_SYNC_STATE, ensure_ascii=False, default=str), encoding="utf-8")
        temporary.replace(SYNC_STATE_FILE)
    except Exception as exc:
        logger.warning("Could not persist data sync state: %s", exc)


def _sync_state_snapshot() -> dict[str, Any]:
    with _DATA_SYNC_STATE_LOCK:
        _load_sync_state_unlocked()
        status = str(_DATA_SYNC_STATE.get("status") or "idle").lower()
        started_at = _DATA_SYNC_STATE.get("started_at")
        if status in {"queued", "running"} and started_at:
            try:
                started = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
                if started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
                elapsed = (datetime.now(timezone.utc) - started.astimezone(timezone.utc)).total_seconds()
                if elapsed > 360:
                    _DATA_SYNC_STATE.update({
                        "status": "failed",
                        "finished_at": datetime.now(timezone.utc).isoformat(),
                        "duration_seconds": round(elapsed, 1),
                        "message": "Tiến trình đồng bộ không phản hồi và đã được tự động kết thúc.",
                        "error": "Quá thời gian theo dõi tiến trình đồng bộ.",
                    })
                    _write_sync_state_unlocked()
            except (TypeError, ValueError):
                pass
        return dict(_DATA_SYNC_STATE)


def _set_sync_state(**updates: Any) -> None:
    with _DATA_SYNC_STATE_LOCK:
        _load_sync_state_unlocked()
        _DATA_SYNC_STATE.update(updates)
        _write_sync_state_unlocked()


def _dashboard_summary() -> dict[str, Any]:
    # Fast path: one PostgreSQL RPC replaces multiple table scans. The SQL
    # migration is included in supabase/schema.sql. Fallback keeps old DBs usable.
    rpc_summary = _rpc_json("admin_dashboard_summary")
    if rpc_summary:
        return rpc_summary

    # The migration exposes the same single-row materialized view even when
    # PostgREST has not reloaded the RPC schema cache yet.
    mv_rows = _rows(
        "mv_admin_dashboard_summary",
        "total_users,active_users,online_24h,premium_users,successful_orders,revenue_vnd,trade_count,trade_volume_vnd,ai_questions,active_alerts,wallet_balance_vnd,refreshed_at",
        limit=1,
    )
    if mv_rows:
        return mv_rows[0]

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


def _recent_activity_rows(
    limit_per_source: int = 30,
    kind: str = "all",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    safe_limit = max(1, min(500, int(limit_per_source)))
    orders = (
        _rows(
            "orders",
            "id,user_id,plan_id,amount_vnd,vnp_txn_ref,status,created_at,paid_at",
            limit=safe_limit,
            order_by="created_at",
        )
        if kind in {"all", "premium"}
        else []
    )
    trades = (
        _rows(
            "demo_trades",
            "id,user_id,side,amount_vnd,amount_usdt,applied_price,created_at",
            limit=safe_limit,
            order_by="created_at",
        )
        if kind in {"all", "trade"}
        else []
    )
    ai_rows = (
        _rows(
            "ai_analysis_history",
            "id,user_id,question,verdict,confidence,created_at",
            limit=safe_limit,
            order_by="created_at",
        )
        if kind in {"all", "ai"}
        else []
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
    *,
    max_items: int | None = 18,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    profile_by_id = {str(row.get("user_id")): row for row in profiles}

    for row in orders:
        profile = profile_by_id.get(str(row.get("user_id")), {})
        items.append({
            "id": row.get("id"),
            "type": "premium",
            "title": "Thanh toán Premium Sandbox",
            "detail": profile.get("email") or "Người dùng",
            "status": row.get("status") or "pending",
            "amount_vnd": row.get("amount_vnd"),
            "created_at": row.get("paid_at") or row.get("created_at"),
        })
    for row in trades:
        profile = profile_by_id.get(str(row.get("user_id")), {})
        items.append({
            "id": row.get("id"),
            "type": "trade",
            "title": f"Lệnh {str(row.get('side') or '').upper()} demo",
            "detail": profile.get("email") or "Người dùng",
            "status": "completed",
            "amount_vnd": row.get("amount_vnd"),
            "created_at": row.get("created_at"),
        })
    for row in ai_rows:
        profile = profile_by_id.get(str(row.get("user_id")), {})
        items.append({
            "id": row.get("id"),
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
    return items if max_items is None else items[:max_items]


def _activity_total(kind: str) -> int:
    if kind == "premium":
        return _count("orders", "id")
    if kind == "trade":
        return _count("demo_trades", "id")
    if kind == "ai":
        return _count("ai_analysis_history", "id")
    return (
        _count("orders", "id")
        + _count("demo_trades", "id")
        + _count("ai_analysis_history", "id")
    )


def _activity_page(page: int, limit: int, kind: str) -> dict[str, Any]:
    # The common first page is served by one UNION ALL RPC and one profile JOIN.
    # Older databases keep the bounded Python merge fallback below.
    if page == 1:
        rpc_data = _rpc_json(
            "admin_activity_cursor",
            {
                "p_limit": limit,
                "p_type": kind,
                "p_cursor_at": None,
                "p_cursor_id": None,
            },
        )
        if rpc_data:
            rows = rpc_data.get("data") if isinstance(rpc_data.get("data"), list) else []
            total = _activity_total(kind)
            return {
                "count": len(rows),
                "total": total,
                "page": 1,
                "page_size": limit,
                "has_next": bool(rpc_data.get("has_next")),
                "next_cursor": rpc_data.get("next_cursor"),
                "type": kind,
                "data": rows,
            }

    # To keep a globally sorted mixed feed, read only the newest window required
    # for the requested page from each source, merge it, then slice one page.
    window = min(500, max(limit, page * limit + limit))
    profiles, orders, trades, ai_rows = _recent_activity_rows(window, kind)
    combined = _recent_activity(profiles, orders, trades, ai_rows, max_items=None)
    offset = (page - 1) * limit
    total = _activity_total(kind)
    rows = combined[offset: offset + limit]
    return {
        "count": len(rows),
        "total": total,
        "page": page,
        "page_size": limit,
        "has_next": page * limit < total,
        "type": kind,
        "data": rows,
    }


def _activity_page_filtered(
    page: int,
    limit: int,
    kind: str,
    *,
    search: str = "",
    status: str = "all",
    date_from: str | None = None,
    date_to: str | None = None,
    sort: str = "desc",
) -> dict[str, Any]:
    """Return one filtered admin activity page without changing activity semantics.

    The optimized UNION RPC remains the fast path for the default feed. Filters
    use a bounded merge of the newest rows from each source, which prevents
    unbounded reads while still supporting search/date/status controls in the
    admin interface.
    """
    normalized_search = str(search or "").strip().lower()
    normalized_status = str(status or "all").strip().lower()
    normalized_sort = "asc" if str(sort or "desc").lower() == "asc" else "desc"

    if (
        not normalized_search
        and normalized_status == "all"
        and not date_from
        and not date_to
        and normalized_sort == "desc"
    ):
        return _activity_page(page, limit, kind)

    def parse_boundary(value: str | None, *, end: bool = False) -> datetime | None:
        if not value:
            return None
        raw = str(value).strip()
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(raw, "%Y-%m-%d")
            except ValueError:
                return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        if end and len(raw) <= 10:
            parsed = parsed.replace(hour=23, minute=59, second=59, microsecond=999999)
        return parsed.astimezone(timezone.utc)

    start_at = parse_boundary(date_from)
    end_at = parse_boundary(date_to, end=True)
    # Bounded by source to avoid loading the complete transaction history.
    source_window = min(500, max(100, page * limit * 4))
    profiles, orders, trades, ai_rows = _recent_activity_rows(source_window, kind)
    rows = _recent_activity(profiles, orders, trades, ai_rows, max_items=None)

    filtered: list[dict[str, Any]] = []
    for row in rows:
        created_at = _parse_time(row.get("created_at"))
        if start_at and (created_at is None or created_at < start_at):
            continue
        if end_at and (created_at is None or created_at > end_at):
            continue
        row_status = str(row.get("status") or "").lower()
        if normalized_status != "all" and row_status != normalized_status:
            continue
        if normalized_search:
            haystack = " ".join(
                str(row.get(key) or "")
                for key in ("title", "detail", "status", "type", "id")
            ).lower()
            if normalized_search not in haystack:
                continue
        filtered.append(row)

    filtered.sort(
        key=lambda item: _parse_time(item.get("created_at"))
        or datetime.min.replace(tzinfo=timezone.utc),
        reverse=normalized_sort == "desc",
    )
    total = len(filtered)
    offset = (page - 1) * limit
    page_rows = filtered[offset: offset + limit]
    return {
        "count": len(page_rows),
        "total": total,
        "page": page,
        "page_size": limit,
        "has_next": offset + limit < total,
        "type": kind,
        "search": normalized_search,
        "status": normalized_status,
        "date_from": date_from,
        "date_to": date_to,
        "sort": normalized_sort,
        "data": page_rows,
        "bounded": True,
    }


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
    # Initial admin paint stays lightweight: only summary, current BTC and
    # notifications/system status. Chart series and activity are lazy endpoints.
    latest = get_latest_ohlcv() or {}
    return {
        "summary": _dashboard_summary(),
        "market": {"latest": latest, "series": []},
        "activity": [],
        "system": _system_payload(data_points=0),
        "deferred": {"market_series": True, "activity": True},
    }


def _admin_market_series(hours: int) -> dict[str, Any]:
    rows = get_ohlcv(hours)
    return {"count": len(rows), "hours": hours, "data": rows}


def _admin_activity_feed(limit: int) -> dict[str, Any]:
    page = _activity_page(1, limit, "all")
    return {
        "count": page.get("count", 0),
        "has_next": page.get("has_next", False),
        "next_cursor": page.get("next_cursor"),
        "data": page.get("data", []),
    }


def _activity_data(page: int, limit: int, kind: str) -> dict[str, Any]:
    activity_page = _activity_page(page, limit, kind)
    return {
        "summary": _dashboard_summary(),
        "market": {"latest": get_latest_ohlcv() or {}, "series": []},
        "activity": activity_page["data"],
        "activity_page": activity_page,
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


def _users_cursor_page(
    limit: int,
    search: str,
    status: str,
    plan: str,
    cursor_created_at: str | None,
    cursor_user_id: str | None,
) -> dict[str, Any] | None:
    rpc_data = _rpc_json(
        "admin_users_cursor",
        {
            "p_limit": limit,
            "p_search": search.strip(),
            "p_status": status,
            "p_plan": plan,
            "p_cursor_created_at": cursor_created_at,
            "p_cursor_user_id": cursor_user_id,
        },
    )
    if not rpc_data:
        return None
    rows = rpc_data.get("data") if isinstance(rpc_data.get("data"), list) else []
    return {
        "count": len(rows),
        "total": 0,
        "page": 1,
        "page_size": limit,
        "has_next": bool(rpc_data.get("has_next")),
        "next_cursor": rpc_data.get("next_cursor"),
        "data": rows,
    }


def _users_data(page: int, limit: int, search: str, status: str, plan: str) -> dict[str, Any]:
    return {
        "summary": {},
        "market": {"latest": get_latest_ohlcv() or {}, "series": []},
        "activity": [],
        "system": _system_payload(data_points=72),
        "users": _users_page(page, limit, search, status, plan),
    }


def _run_manual_sync(requested_by: str | None, job_id: str) -> None:
    started_at = datetime.now(timezone.utc)
    _set_sync_state(
        status="running",
        job_id=job_id,
        started_at=started_at.isoformat(),
        finished_at=None,
        requested_by=requested_by,
        message="Đang lấy dữ liệu mới và cập nhật Supabase...",
        error=None,
        output_tail=None,
        duration_seconds=None,
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
        finished_at = datetime.now(timezone.utc)
        _set_sync_state(
            status="success",
            job_id=job_id,
            finished_at=finished_at.isoformat(),
            duration_seconds=round((finished_at - started_at).total_seconds(), 1),
            message=(
                "Đồng bộ hoàn tất và dữ liệu đã trở lại trạng thái mới."
                if freshness.get("state") == "fresh"
                else "Đồng bộ hoàn tất nhưng dữ liệu vẫn chưa đạt ngưỡng mới; hãy kiểm tra nguồn dữ liệu."
            ),
            error=None,
            output_tail=output_tail,
        )
    except subprocess.TimeoutExpired as exc:
        finished_at = datetime.now(timezone.utc)
        _set_sync_state(
            status="failed",
            job_id=job_id,
            finished_at=finished_at.isoformat(),
            duration_seconds=round((finished_at - started_at).total_seconds(), 1),
            message="Đồng bộ vượt quá 5 phút và đã bị dừng.",
            error=str(exc),
        )
    except Exception as exc:
        finished_at = datetime.now(timezone.utc)
        _set_sync_state(
            status="failed",
            job_id=job_id,
            finished_at=finished_at.isoformat(),
            duration_seconds=round((finished_at - started_at).total_seconds(), 1),
            message="Không đồng bộ được dữ liệu.",
            error=str(exc),
        )


def _degraded_overview(error: Exception) -> dict[str, Any]:
    """Keep the Admin shell available during a temporary Supabase outage."""
    now = datetime.now(timezone.utc).isoformat()
    logger.exception("Admin overview degraded because a dependency failed", exc_info=error)
    return {
        "summary": {},
        "market": {"latest": {}, "series": []},
        "activity": [],
        "system": {
            "api": "operational",
            "database": "degraded",
            "ai_provider": get_settings().ai_provider,
            "environment": get_settings().app_env,
            "data_points": 0,
            "checked_at": now,
            "data_freshness": {
                "state": "missing",
                "needs_sync": True,
                "threshold_hours": DATA_FRESH_THRESHOLD_HOURS,
                "checked_at": now,
                "message": "Supabase tạm thời không phản hồi. Hãy thử làm mới sau vài giây.",
                "degraded": True,
                "ohlcv": _freshness_item(None, datetime.now(timezone.utc)),
                "p2p": _freshness_item(None, datetime.now(timezone.utc)),
            },
            "data_sync": _sync_state_snapshot(),
        },
        "deferred": {"market_series": True, "activity": True},
        "degraded": True,
    }


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
    try:
        payload = dict(_cached("admin:overview", OVERVIEW_CACHE_SECONDS, _overview_data, refresh=refresh))
    except Exception as exc:
        # A transient Supabase/PostgREST socket error must not turn the complete
        # Admin application into a 500 response. Do not cache this degraded
        # response so the next refresh can recover immediately.
        _ADMIN_CACHE.delete("admin:overview")
        response.headers["Cache-Control"] = "no-store"
        payload = _degraded_overview(exc)
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


@router.get("/market-series")
def admin_market_series(
    request: Request,
    response: Response,
    hours: int = Query(72, ge=24, le=720),
    refresh: bool = Query(False),
):
    require_admin(request)
    _private_cache_headers(response, OVERVIEW_CACHE_SECONDS)
    return _cached(
        f"admin:market-series:{hours}",
        OVERVIEW_CACHE_SECONDS,
        lambda: _admin_market_series(hours),
        refresh=refresh,
    )


@router.get("/activity-feed")
def admin_activity_feed(
    request: Request,
    response: Response,
    limit: int = Query(7, ge=1, le=20),
    refresh: bool = Query(False),
):
    require_admin(request)
    _private_cache_headers(response, ACTIVITY_CACHE_SECONDS)
    return _cached(
        f"admin:activity-feed:{limit}",
        ACTIVITY_CACHE_SECONDS,
        lambda: _admin_activity_feed(limit),
        refresh=refresh,
    )


@router.get("/activity")
def admin_activity(
    request: Request,
    response: Response,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=10, le=100),
    type: str = Query("all", pattern="^(all|trade|premium|ai)$"),
    status: str = Query(
        "all",
        pattern="^(all|success|pending|failed|completed|buy|sell|neutral)$",
    ),
    search: str = Query("", max_length=120),
    date_from: str | None = Query(None, max_length=32),
    date_to: str | None = Query(None, max_length=32),
    sort: str = Query("desc", pattern="^(asc|desc)$"),
    refresh: bool = Query(False),
):
    admin = require_admin(request)
    normalized_search = search.strip().lower()
    cache_key = (
        f"admin:activity:{page}:{limit}:{type}:{status}:{sort}:"
        f"{date_from or ''}:{date_to or ''}:{normalized_search}"
    )
    _private_cache_headers(response, ACTIVITY_CACHE_SECONDS)

    def build_activity_payload() -> dict[str, Any]:
        activity_page = _activity_page_filtered(
            page,
            limit,
            type,
            search=normalized_search,
            status=status,
            date_from=date_from,
            date_to=date_to,
            sort=sort,
        )
        return {
            "summary": _dashboard_summary(),
            "market": {"latest": get_latest_ohlcv() or {}, "series": []},
            "activity": activity_page["data"],
            "activity_page": activity_page,
            "system": _system_payload(data_points=72),
        }

    payload = dict(
        _cached(
            cache_key,
            ACTIVITY_CACHE_SECONDS,
            build_activity_payload,
            refresh=refresh,
        )
    )
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
    job_id = uuid.uuid4().hex
    with _DATA_SYNC_STATE_LOCK:
        _load_sync_state_unlocked()
        if _DATA_SYNC_STATE.get("status") in {"queued", "running"}:
            raise HTTPException(status_code=409, detail="Một tiến trình đồng bộ dữ liệu đang chạy")
        _DATA_SYNC_STATE.update({
            "status": "queued",
            "job_id": job_id,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "requested_by": admin.get("email"),
            "message": "Yêu cầu đồng bộ đã được đưa vào hàng đợi.",
            "error": None,
            "output_tail": None,
            "duration_seconds": None,
        })
        _write_sync_state_unlocked()
    _invalidate_admin_cache("admin:system", "admin:freshness")
    background_tasks.add_task(_run_manual_sync, admin.get("email"), job_id)
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
    cursor_mode: bool = Query(False),
    cursor_created_at: str | None = Query(None),
    cursor_user_id: str | None = Query(None),
    refresh: bool = Query(False),
):
    admin = require_admin(request)
    normalized_search = search.strip().lower()
    cursor_key = f"{cursor_created_at or ''}:{cursor_user_id or ''}"
    key = f"admin:users:{page}:{limit}:{status}:{plan}:{normalized_search}:{cursor_mode}:{cursor_key}"
    _private_cache_headers(response, USERS_CACHE_SECONDS)

    def build_payload() -> dict[str, Any]:
        if cursor_mode:
            cursor_page = _users_cursor_page(
                limit,
                normalized_search,
                status,
                plan,
                cursor_created_at,
                cursor_user_id,
            )
            if cursor_page:
                cursor_page["page"] = page
                cursor_page["cursor_mode"] = True
                return {
                    "summary": {},
                    "market": {"latest": get_latest_ohlcv() or {}, "series": []},
                    "activity": [],
                    "system": _system_payload(data_points=72),
                    "users": cursor_page,
                }
        return _users_data(page, limit, normalized_search, status, plan)

    payload = dict(
        _cached(
            key,
            USERS_CACHE_SECONDS,
            build_payload,
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
    # Keep application status and Supabase Auth status in sync. A profile-only
    # lock still lets Supabase issue a session, so suspended users are also
    # banned at the Auth layer. Existing access tokens are blocked immediately
    # by get_current_user(), which checks user_profiles.status on every protected
    # backend request.
    auth_ban_duration = "876000h" if payload.status == "suspended" else "none"
    rollback_ban_duration = "none" if payload.status == "suspended" else "876000h"
    try:
        sb.auth.admin.update_user_by_id(user_id, {"ban_duration": auth_ban_duration})
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Không cập nhật được trạng thái đăng nhập Supabase Auth: {exc}",
        ) from exc

    try:
        res = (
            sb.table("user_profiles")
            .update({"status": payload.status})
            .eq("user_id", user_id)
            .execute()
        )
    except Exception as exc:
        try:
            sb.auth.admin.update_user_by_id(user_id, {"ban_duration": rollback_ban_duration})
        except Exception:
            pass
        raise HTTPException(status_code=503, detail=f"Không cập nhật được trạng thái người dùng: {exc}") from exc
    if not res.data:
        try:
            sb.auth.admin.update_user_by_id(user_id, {"ban_duration": rollback_ban_duration})
        except Exception:
            pass
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")
    invalidate_user_auth_cache(user_id)
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
