from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from fastapi import APIRouter, HTTPException, Query, Response
from starlette.concurrency import run_in_threadpool

from app.cache import TTLCache
from app.data_loader import load_mock_data
from app.repositories.market_repository import get_latest_ohlcv, get_ohlcv, get_p2p_spread
from app.services.indicator_service import (
    calculate_risk_score,
    generate_market_alerts,
    signal_from_latest,
)
from app.services.public_api_service import fetch_public_api

router = APIRouter(prefix="/api", tags=["market"])

# Public market responses are shared by all users. Short TTLs keep data fresh
# while collapsing concurrent Dashboard/ticker/Decision requests into one load.
_RESPONSE_CACHE = TTLCache(max_entries=256)
_RESPONSE_LOCKS: dict[str, asyncio.Lock] = {}
_RESPONSE_LOCKS_GUARD = asyncio.Lock()
LATEST_TTL = 15
SUMMARY_TTL = 20
SERIES_TTL = 45
P2P_TTL = 45
OVERVIEW_TTL = 15
STATUS_TTL = 20


def _public_cache_headers(response: Response, seconds: int) -> None:
    response.headers["Cache-Control"] = (
        f"public, max-age={seconds}, stale-while-revalidate={seconds * 4}"
    )


async def _cache_lock(key: str) -> asyncio.Lock:
    async with _RESPONSE_LOCKS_GUARD:
        return _RESPONSE_LOCKS.setdefault(key, asyncio.Lock())


async def _cached_async(
    key: str,
    ttl_seconds: int,
    factory: Callable[[], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    cached = _RESPONSE_CACHE.get(key)
    if cached is not None:
        return cached
    lock = await _cache_lock(key)
    async with lock:
        cached = _RESPONSE_CACHE.get(key)
        if cached is not None:
            return cached
        value = await factory()
        return _RESPONSE_CACHE.set(key, value, ttl_seconds)


def _age_hours(ts: Any) -> float | None:
    if not ts:
        return None
    now = datetime.now(timezone.utc)
    value = str(ts).replace(" ", "T")
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return round((now - dt.astimezone(timezone.utc)).total_seconds() / 3600, 2)
    except Exception:
        return None


def _status_from(latest_row: dict[str, Any] | None, p2p_rows: list[dict[str, Any]]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    latest_ts = latest_row.get("timestamp") if latest_row else None
    latest_p2p_ts = p2p_rows[0].get("timestamp") if p2p_rows else None
    ohlcv_age = _age_hours(latest_ts)
    p2p_age = _age_hours(latest_p2p_ts)
    return {
        "now_utc": now.isoformat(),
        "latest_ohlcv_timestamp": latest_ts,
        "latest_p2p_timestamp": latest_p2p_ts,
        "ohlcv_age_hours": ohlcv_age,
        "p2p_age_hours": p2p_age,
        "is_ohlcv_fresh": ohlcv_age is not None and ohlcv_age <= 2,
        "is_p2p_fresh": p2p_age is not None and p2p_age <= 2,
        "note": "Nếu dữ liệu không fresh, hãy kiểm tra GitHub Actions scheduler hoặc chạy backend/scripts/sync_market_data.py.",
    }


async def _local_data_status() -> dict[str, Any]:
    latest_row, p2p_rows = await asyncio.gather(
        run_in_threadpool(get_latest_ohlcv),
        run_in_threadpool(get_p2p_spread, 1),
    )
    return _status_from(latest_row, p2p_rows)


async def _latest_with_fallback() -> tuple[dict[str, Any], str]:
    data = await run_in_threadpool(get_latest_ohlcv)
    if data:
        return data, "supabase"

    public = await fetch_public_api("/api/latest")
    if public:
        return public, "public_api"

    return load_mock_data()["latest"], "mock"


async def _ohlcv_with_fallback(hours: int) -> tuple[list[dict[str, Any]], str]:
    rows = await run_in_threadpool(get_ohlcv, hours)
    if rows:
        return rows, "supabase"

    public = await fetch_public_api(f"/api/ohlcv?hours={hours}")
    if public and isinstance(public.get("data"), list):
        return public.get("data") or [], "public_api"

    mock = load_mock_data()["ohlcv"]
    return mock["data"][-hours:], "mock"


async def _summary_with_fallback(latest: dict[str, Any] | None = None) -> tuple[dict[str, Any], str]:
    current = latest or await run_in_threadpool(get_latest_ohlcv)
    if current:
        return signal_from_latest(current), "local_rule"

    public = await fetch_public_api("/api/indicators/summary")
    if public:
        return public, "public_api"

    mock = load_mock_data()
    if mock.get("summary"):
        return mock["summary"], "mock"
    if mock.get("latest"):
        return signal_from_latest(mock["latest"]), "mock_rule"
    raise HTTPException(status_code=404, detail="Chưa có dữ liệu chỉ báo")


async def _p2p_with_fallback(hours: int = 168) -> tuple[list[dict[str, Any]], str, dict[str, Any] | None]:
    rows = await run_in_threadpool(get_p2p_spread, hours)
    if rows:
        return rows, "supabase", rows[0]

    public = await fetch_public_api(f"/api/p2p-spread?hours={hours}")
    if public and public.get("data"):
        return public.get("data") or [], "public_api", public.get("latest")

    mock = load_mock_data()["p2p"]
    data = mock.get("data", [])[: hours * 2]
    return data, "mock", data[0] if data else None


def _compare_p2p(rows: list[dict[str, Any]], source: str) -> dict[str, Any]:
    latest_sell = next((row for row in rows if row.get("trade_type") == "SELL"), None)
    latest_buy = next((row for row in rows if row.get("trade_type") == "BUY"), None)

    def compare(row: dict[str, Any] | None, user_side: str) -> dict[str, Any] | None:
        if not row:
            return None
        try:
            p2p_price = float(row.get("p2p_price"))
            market_price = float(row.get("market_price"))
        except (TypeError, ValueError):
            return {"row": row, "note": "Thiếu giá P2P hoặc giá thị trường để so sánh."}
        if not market_price:
            return {"row": row, "note": "Thiếu giá P2P hoặc giá thị trường để so sánh."}
        diff = p2p_price - market_price
        diff_pct = diff / market_price * 100
        favorable = diff > 0 if user_side == "sell" else diff < 0
        return {
            "trade_type": row.get("trade_type"),
            "user_side": user_side,
            "p2p_price": p2p_price,
            "market_price": market_price,
            "difference_vnd": round(diff, 0),
            "difference_pct": round(diff_pct, 4),
            "favorable": favorable,
            "samples": row.get("samples"),
            "timestamp": row.get("timestamp"),
            "explain": (
                "P2P cao hơn giá tham chiếu nên người bán nhận nhiều VNĐ hơn."
                if user_side == "sell" and favorable
                else "P2P thấp hơn giá tham chiếu nên người mua trả ít VNĐ hơn."
                if user_side == "buy" and favorable
                else "Nguồn giá đang kém lợi hơn giá tham chiếu cho chiều giao dịch này."
            ),
        }

    return {
        "source": source,
        "sell": compare(latest_sell, "sell"),
        "buy": compare(latest_buy, "buy"),
        "summary": "So sánh giá P2P với giá thị trường quy đổi VNĐ để ước lượng chi phí ẩn khi mua/bán USDT.",
        "disclaimer": "Chênh lệch P2P thay đổi nhanh theo thời điểm, ngân hàng, hạn mức và merchant.",
    }


async def _build_overview(hours: int) -> dict[str, Any]:
    # One summary endpoint replaces 5–6 browser requests. Independent reads run
    # concurrently and repository-level caches prevent duplicate Supabase calls.
    (latest, latest_source), (series, series_source), (p2p_rows, p2p_source, p2p_latest) = await asyncio.gather(
        _latest_with_fallback(),
        _ohlcv_with_fallback(hours),
        _p2p_with_fallback(min(hours, 168)),
    )
    summary, summary_source = await _summary_with_fallback(latest)
    status = _status_from(latest, p2p_rows)
    risk = calculate_risk_score(latest, status)
    alerts = generate_market_alerts(latest, summary, p2p_rows[:2], status)
    return {
        "latest": latest,
        "summary": summary,
        "ohlcv": {
            "symbol": "BTCUSDT",
            "timeframe": "1h",
            "hours": hours,
            "count": len(series),
            "data": series,
        },
        "risk": {"timestamp": latest.get("timestamp"), "price": latest.get("close"), "source": latest_source, **risk},
        "alerts": {
            "count": len(alerts),
            "data": alerts,
            "risk": risk,
            "disclaimer": "Cảnh báo rule-based phục vụ học tập và tham khảo, không phải lệnh giao dịch.",
        },
        "p2p": {
            "count": len(p2p_rows),
            "hours": min(hours, 168),
            "latest": p2p_latest,
            "data": p2p_rows,
        },
        "p2p_comparison": _compare_p2p(p2p_rows, p2p_source),
        "status": status,
        "sources": {
            "latest": latest_source,
            "summary": summary_source,
            "ohlcv": series_source,
            "p2p": p2p_source,
        },
    }


@router.get("/overview")
@router.get("/dashboard/summary")
async def overview(
    response: Response,
    hours: int = Query(72, ge=24, le=720),
):
    _public_cache_headers(response, OVERVIEW_TTL)
    return await _cached_async(
        f"overview:{hours}",
        OVERVIEW_TTL,
        lambda: _build_overview(hours),
    )


@router.get("/latest")
async def latest(response: Response):
    _public_cache_headers(response, LATEST_TTL)

    async def build() -> dict[str, Any]:
        data, _source = await _latest_with_fallback()
        return data

    return await _cached_async("latest", LATEST_TTL, build)


@router.get("/ohlcv")
async def ohlcv(response: Response, hours: int = Query(168, ge=1, le=8760)):
    _public_cache_headers(response, SERIES_TTL)

    async def build() -> dict[str, Any]:
        rows, _source = await _ohlcv_with_fallback(hours)
        return {"symbol": "BTCUSDT", "timeframe": "1h", "hours": hours, "count": len(rows), "data": rows}

    return await _cached_async(f"ohlcv:{hours}", SERIES_TTL, build)


@router.get("/indicators/summary")
async def indicators_summary(response: Response):
    _public_cache_headers(response, SUMMARY_TTL)

    async def build() -> dict[str, Any]:
        latest_data, _ = await _latest_with_fallback()
        summary, _source = await _summary_with_fallback(latest_data)
        return summary

    return await _cached_async("summary", SUMMARY_TTL, build)


@router.get("/data-status")
async def data_status(response: Response):
    _public_cache_headers(response, STATUS_TTL)
    return await _cached_async("data-status", STATUS_TTL, _local_data_status)


@router.get("/data-reliability")
async def data_reliability(response: Response):
    _public_cache_headers(response, STATUS_TTL)

    async def build() -> dict[str, Any]:
        (latest, latest_source), (p2p_rows, p2p_source, _) = await asyncio.gather(
            _latest_with_fallback(),
            _p2p_with_fallback(24),
        )
        status = _status_from(latest, p2p_rows)
        checks = [
            {
                "name": "OHLCV BTC/USDT",
                "source": latest_source,
                "latest_timestamp": status.get("latest_ohlcv_timestamp") or latest.get("timestamp"),
                "age_hours": status.get("ohlcv_age_hours"),
                "fresh": status.get("is_ohlcv_fresh"),
                "threshold_hours": 2,
                "description": "Dữ liệu giá 1 giờ dùng cho dashboard, chỉ báo kỹ thuật và AI Advisor.",
            },
            {
                "name": "P2P USDT/VNĐ",
                "source": p2p_source,
                "latest_timestamp": status.get("latest_p2p_timestamp"),
                "age_hours": status.get("p2p_age_hours"),
                "fresh": status.get("is_p2p_fresh"),
                "threshold_hours": 2,
                "description": "Dữ liệu P2P dùng để so sánh giá sàn, spread và số tiền thực nhận.",
            },
        ]
        stale_count = len([item for item in checks if item["fresh"] is False])
        if stale_count == 0 and all(item["fresh"] is True for item in checks):
            level, message = "GOOD", "Dữ liệu đủ mới cho mục tiêu demo học thuật."
        elif stale_count <= 1:
            level, message = "WARNING", "Một nguồn dữ liệu đang cũ hoặc chưa xác định, nên thận trọng khi diễn giải."
        else:
            level, message = "STALE", "Nhiều nguồn dữ liệu chưa fresh, cần kiểm tra pipeline/GitHub Actions."
        return {
            "level": level,
            "message": message,
            "status": status,
            "checks": checks,
            "sources": {
                "ohlcv": "Binance/Data API → sync_market_data.py → Supabase",
                "p2p": "Binance P2P API, có fallback public API khi cần",
                "ai": "Groq/Gemini/OpenAI tuỳ backend .env; key không nằm ở frontend",
            },
            "automation": "GitHub Actions chạy định kỳ mỗi giờ để đồng bộ dữ liệu vào Supabase.",
            "sample_count": {"p2p_last_24h": len(p2p_rows)},
        }

    return await _cached_async("data-reliability", STATUS_TTL, build)


@router.get("/risk-score")
async def risk_score(response: Response):
    _public_cache_headers(response, SUMMARY_TTL)

    async def build() -> dict[str, Any]:
        latest_data, source = await _latest_with_fallback()
        p2p_rows = await run_in_threadpool(get_p2p_spread, 1)
        status = _status_from(latest_data, p2p_rows)
        risk = calculate_risk_score(latest_data, status)
        return {"timestamp": latest_data.get("timestamp"), "price": latest_data.get("close"), "source": source, **risk}

    return await _cached_async("risk-score", SUMMARY_TTL, build)


@router.get("/market-alerts")
async def market_alerts(response: Response):
    _public_cache_headers(response, SUMMARY_TTL)

    async def build() -> dict[str, Any]:
        (latest_data, latest_source), (p2p_rows, p2p_source, _) = await asyncio.gather(
            _latest_with_fallback(),
            _p2p_with_fallback(24),
        )
        summary, summary_source = await _summary_with_fallback(latest_data)
        status = _status_from(latest_data, p2p_rows)
        risk = calculate_risk_score(latest_data, status)
        alerts = generate_market_alerts(latest_data, summary, p2p_rows[:2], status)
        return {
            "count": len(alerts),
            "data": alerts,
            "risk": risk,
            "sources": {"latest": latest_source, "summary": summary_source, "p2p": p2p_source},
            "disclaimer": "Cảnh báo rule-based phục vụ học tập và tham khảo, không phải lệnh giao dịch.",
        }

    return await _cached_async("market-alerts", SUMMARY_TTL, build)


@router.get("/p2p-spread")
async def p2p_spread(response: Response, hours: int = Query(168, ge=1, le=8760)):
    _public_cache_headers(response, P2P_TTL)

    async def build() -> dict[str, Any]:
        rows, _source, latest_row = await _p2p_with_fallback(hours)
        if not rows:
            return {"count": 0, "data": [], "latest": None, "note": "Chưa có dữ liệu spread — pipeline có thể chưa chạy đủ 1 chu kỳ"}
        return {"count": len(rows), "hours": hours, "latest": latest_row or rows[0], "data": rows}

    return await _cached_async(f"p2p:{hours}", P2P_TTL, build)


@router.get("/p2p-comparison")
async def p2p_comparison(response: Response):
    _public_cache_headers(response, P2P_TTL)

    async def build() -> dict[str, Any]:
        rows, source, _ = await _p2p_with_fallback(24)
        return _compare_p2p(rows, source)

    return await _cached_async("p2p-comparison", P2P_TTL, build)
