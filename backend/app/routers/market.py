from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.data_loader import load_mock_data
from app.repositories.market_repository import (
    get_latest_ohlcv,
    get_ohlcv,
    get_p2p_spread,
)
from app.services.indicator_service import (
    calculate_risk_score,
    generate_market_alerts,
    signal_from_latest,
)
from app.services.public_api_service import fetch_public_api

router = APIRouter(prefix="/api", tags=["market"])


def _age_hours(ts):
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


def _local_data_status() -> dict:
    latest_row = get_latest_ohlcv()
    p2p_rows = get_p2p_spread(1)
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


async def _latest_with_fallback() -> tuple[dict, str]:
    data = get_latest_ohlcv()
    if data:
        return data, "supabase"

    public = await fetch_public_api("/api/latest")
    if public:
        return public, "public_api"

    return load_mock_data()["latest"], "mock"


async def _summary_with_fallback(latest: dict | None = None) -> tuple[dict, str]:
    current = latest or get_latest_ohlcv()
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


async def _p2p_with_fallback(hours: int = 168) -> tuple[list[dict], str, dict | None]:
    rows = get_p2p_spread(hours)
    if rows:
        return rows, "supabase", rows[0]

    public = await fetch_public_api(f"/api/p2p-spread?hours={hours}")
    if public and public.get("data"):
        return public.get("data") or [], "public_api", public.get("latest")

    mock = load_mock_data()["p2p"]
    data = mock.get("data", [])[: hours * 2]
    return data, "mock", data[0] if data else None


@router.get("/latest")
async def latest():
    data, _source = await _latest_with_fallback()
    return data


@router.get("/ohlcv")
async def ohlcv(hours: int = Query(168, ge=1, le=8760)):
    rows = get_ohlcv(hours)
    if rows:
        return {
            "symbol": "BTCUSDT",
            "timeframe": "1h",
            "hours": hours,
            "count": len(rows),
            "data": rows,
        }

    public = await fetch_public_api(f"/api/ohlcv?hours={hours}")
    if public:
        return public

    mock = load_mock_data()["ohlcv"]
    data = mock["data"][-hours:]
    return {
        "symbol": "BTCUSDT",
        "timeframe": "1h",
        "hours": hours,
        "count": len(data),
        "data": data,
    }


@router.get("/indicators/summary")
async def indicators_summary():
    latest_data = get_latest_ohlcv()
    summary, _source = await _summary_with_fallback(latest_data)
    return summary


@router.get("/data-status")
async def data_status():
    return _local_data_status()


@router.get("/data-reliability")
async def data_reliability():
    status = _local_data_status()
    latest, latest_source = await _latest_with_fallback()
    p2p_rows, p2p_source, _ = await _p2p_with_fallback(24)

    checks = [
        {
            "name": "OHLCV BTC/USDT",
            "source": latest_source,
            "latest_timestamp": status.get("latest_ohlcv_timestamp")
            or latest.get("timestamp"),
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
    stale_count = len([c for c in checks if c["fresh"] is False])
    if stale_count == 0 and all(c["fresh"] is True for c in checks):
        level = "GOOD"
        message = "Dữ liệu đủ mới cho mục tiêu demo học thuật."
    elif stale_count <= 1:
        level = "WARNING"
        message = "Một nguồn dữ liệu đang cũ hoặc chưa xác định, nên thận trọng khi diễn giải."
    else:
        level = "STALE"
        message = (
            "Nhiều nguồn dữ liệu chưa fresh, cần kiểm tra pipeline/GitHub Actions."
        )

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


@router.get("/risk-score")
async def risk_score():
    latest, source = await _latest_with_fallback()
    status = _local_data_status()
    risk = calculate_risk_score(latest, status)
    return {
        "timestamp": latest.get("timestamp"),
        "price": latest.get("close"),
        "source": source,
        **risk,
    }


@router.get("/market-alerts")
async def market_alerts():
    latest, latest_source = await _latest_with_fallback()
    summary, summary_source = await _summary_with_fallback(latest)
    p2p_rows, p2p_source, _ = await _p2p_with_fallback(24)
    status = _local_data_status()
    risk = calculate_risk_score(latest, status)
    alerts = generate_market_alerts(latest, summary, p2p_rows[:2], status)
    return {
        "count": len(alerts),
        "data": alerts,
        "risk": risk,
        "sources": {
            "latest": latest_source,
            "summary": summary_source,
            "p2p": p2p_source,
        },
        "disclaimer": "Cảnh báo rule-based phục vụ học tập và tham khảo, không phải lệnh giao dịch.",
    }


@router.get("/p2p-spread")
async def p2p_spread(hours: int = Query(168, ge=1, le=8760)):
    rows = get_p2p_spread(hours)
    if rows:
        return {"count": len(rows), "hours": hours, "latest": rows[0], "data": rows}

    public = await fetch_public_api(f"/api/p2p-spread?hours={hours}")
    if public:
        return public

    mock = load_mock_data()["p2p"]
    data = mock["data"][: hours * 2]
    if not data:
        return {
            "count": 0,
            "data": [],
            "latest": None,
            "note": "Chưa có dữ liệu spread — pipeline có thể chưa chạy đủ 1 chu kỳ",
        }
    return {"count": len(data), "hours": hours, "latest": data[0], "data": data}


@router.get("/p2p-comparison")
async def p2p_comparison():
    rows, source, _ = await _p2p_with_fallback(24)
    latest_sell = next((row for row in rows if row.get("trade_type") == "SELL"), None)
    latest_buy = next((row for row in rows if row.get("trade_type") == "BUY"), None)

    def compare(row: dict | None, user_side: str) -> dict | None:
        if not row:
            return None
        p2p_price = row.get("p2p_price")
        market_price = row.get("market_price")
        if (
            not isinstance(p2p_price, (int, float))
            or not isinstance(market_price, (int, float))
            or not market_price
        ):
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
                else (
                    "P2P thấp hơn giá tham chiếu nên người mua trả ít VNĐ hơn."
                    if user_side == "buy" and favorable
                    else "Nguồn giá đang kém lợi hơn giá tham chiếu cho chiều giao dịch này."
                )
            ),
        }

    sell_cmp = compare(latest_sell, "sell")
    buy_cmp = compare(latest_buy, "buy")
    return {
        "source": source,
        "sell": sell_cmp,
        "buy": buy_cmp,
        "summary": "So sánh giá P2P với giá thị trường quy đổi VNĐ để ước lượng chi phí ẩn khi mua/bán USDT.",
        "disclaimer": "Chênh lệch P2P thay đổi nhanh theo thời điểm, ngân hàng, hạn mức và merchant.",
    }
