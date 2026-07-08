from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from app.data_loader import load_mock_data
from app.repositories.market_repository import get_latest_ohlcv, get_ohlcv, get_p2p_spread
from app.services.indicator_service import signal_from_latest
from app.services.public_api_service import fetch_public_api

router = APIRouter(prefix="/api", tags=["market"])


@router.get("/latest")
async def latest():
    data = get_latest_ohlcv()
    if data:
        return data

    public = await fetch_public_api("/api/latest")
    if public:
        return public

    mock = load_mock_data()
    return mock["latest"]


@router.get("/ohlcv")
async def ohlcv(hours: int = Query(168, ge=1, le=8760)):
    rows = get_ohlcv(hours)
    if rows:
        return {"symbol": "BTCUSDT", "timeframe": "1h", "hours": hours, "count": len(rows), "data": rows}

    public = await fetch_public_api(f"/api/ohlcv?hours={hours}")
    if public:
        return public

    mock = load_mock_data()["ohlcv"]
    data = mock["data"][-hours:]
    return {"symbol": "BTCUSDT", "timeframe": "1h", "hours": hours, "count": len(data), "data": data}


@router.get("/indicators/summary")
async def indicators_summary():
    data = get_latest_ohlcv()
    if data:
        return signal_from_latest(data)

    public = await fetch_public_api("/api/indicators/summary")
    if public:
        return public

    mock = load_mock_data()
    if mock.get("summary"):
        return mock["summary"]
    if mock.get("latest"):
        return signal_from_latest(mock["latest"])
    raise HTTPException(status_code=404, detail="Chưa có dữ liệu chỉ báo")


@router.get("/data-status")
async def data_status():
    latest_row = get_latest_ohlcv()
    p2p_rows = get_p2p_spread(1)
    now = datetime.now(timezone.utc)

    def age_hours(ts):
        if not ts:
            return None
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

    latest_ts = latest_row.get("timestamp") if latest_row else None
    latest_p2p_ts = p2p_rows[0].get("timestamp") if p2p_rows else None
    ohlcv_age = age_hours(latest_ts)
    p2p_age = age_hours(latest_p2p_ts)
    return {
        "now_utc": now.isoformat(),
        "latest_ohlcv_timestamp": latest_ts,
        "latest_p2p_timestamp": latest_p2p_ts,
        "ohlcv_age_hours": ohlcv_age,
        "p2p_age_hours": p2p_age,
        "is_ohlcv_fresh": ohlcv_age is not None and ohlcv_age <= 2,
        "is_p2p_fresh": p2p_age is not None and p2p_age <= 2,
        "note": "Nếu is_ohlcv_fresh=false, hãy chạy scripts/sync_market_data.py hoặc kiểm tra GitHub Actions scheduler.",
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
        return {"count": 0, "data": [], "latest": None, "note": "Chưa có dữ liệu spread — pipeline có thể chưa chạy đủ 1 chu kỳ"}
    return {"count": len(data), "hours": hours, "latest": data[0], "data": data}
