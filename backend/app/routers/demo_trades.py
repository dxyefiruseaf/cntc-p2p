from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.data_loader import load_mock_data
from app.repositories.market_repository import (
    execute_demo_trade,
    get_latest_ohlcv,
    get_ohlcv,
    get_p2p_spread,
    get_wallet_for_user,
    list_demo_trades,
    summarize_demo_trades,
)
from app.services.indicator_service import calculate_risk_score

router = APIRouter(prefix="/api/demo-trades", tags=["demo-trades"])


class DemoTradeCreate(BaseModel):
    side: str = Field(..., pattern="^(BUY|SELL|buy|sell)$")
    amount_vnd: float = Field(..., gt=0)
    amount_usdt: float | None = Field(None, gt=0)
    price_source: str = Field("p2p", pattern="^(p2p|market)$")
    applied_price: float | None = Field(None, gt=0)


@router.post("")
async def create_trade(payload: DemoTradeCreate, request: Request):
    user = get_current_user(request)
    amount_asset = float(payload.amount_usdt or 0)
    if amount_asset <= 0:
        raise HTTPException(status_code=400, detail="Khối lượng BTC mô phỏng phải lớn hơn 0")

    try:
        result = execute_demo_trade(
            user_id=user["id"],
            side=payload.side,
            amount_vnd=payload.amount_vnd,
            amount_asset=amount_asset,
            price_source=payload.price_source,
            applied_price=payload.applied_price,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not result:
        raise HTTPException(status_code=503, detail="Không lưu được giao dịch demo")
    return result


def _age_hours(timestamp: object) -> float | None:
    if not timestamp:
        return None
    try:
        value = str(timestamp).replace("Z", "+00:00")
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return round((datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600, 2)
    except Exception:
        return None


@router.get("/terminal")
async def get_terminal_snapshot(
    request: Request,
    hours: int = Query(168, ge=24, le=720),
    limit: int = Query(20, ge=1, le=100),
):
    """One-call payload for the hosted virtual exchange.

    The old frontend opened six HTTP requests at once. On a sleeping Render
    instance that amplified cold-start latency and a single slow request made
    the whole screen fail. This endpoint performs the independent Supabase
    reads in worker threads and returns a compact, consistent snapshot.
    """
    user = get_current_user(request)
    user_id = user["id"]

    latest, ohlcv_rows, p2p_rows, wallet, trade_rows = await asyncio.gather(
        asyncio.to_thread(get_latest_ohlcv),
        asyncio.to_thread(get_ohlcv, hours),
        # Terminal only needs recent BUY/SELL rates; 24 hours is enough even
        # when the chart displays a longer BTC history.
        asyncio.to_thread(get_p2p_spread, min(hours, 24)),
        asyncio.to_thread(get_wallet_for_user, user_id),
        asyncio.to_thread(list_demo_trades, user_id, limit),
    )

    mock = load_mock_data()
    latest_source = "supabase" if latest else "mock"
    ohlcv_source = "supabase" if ohlcv_rows else "mock"
    p2p_source = "supabase" if p2p_rows else "mock"

    latest = latest or mock.get("latest") or {}
    if not ohlcv_rows:
        mock_rows = (mock.get("ohlcv") or {}).get("data") or []
        ohlcv_rows = mock_rows[-hours:]
    if not p2p_rows:
        mock_rows = (mock.get("p2p") or {}).get("data") or []
        p2p_rows = mock_rows[: min(hours, 24) * 2]

    status = {
        "latest_ohlcv_timestamp": latest.get("timestamp"),
        "latest_p2p_timestamp": p2p_rows[0].get("timestamp") if p2p_rows else None,
        "ohlcv_age_hours": _age_hours(latest.get("timestamp")),
        "p2p_age_hours": _age_hours(p2p_rows[0].get("timestamp")) if p2p_rows else None,
    }
    status["is_ohlcv_fresh"] = status["ohlcv_age_hours"] is not None and status["ohlcv_age_hours"] <= 2
    status["is_p2p_fresh"] = status["p2p_age_hours"] is not None and status["p2p_age_hours"] <= 2

    portfolio = summarize_demo_trades(user_id, rows=trade_rows)
    risk = calculate_risk_score(latest, status)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latest": {"data": latest, "source": latest_source},
        "ohlcv": {
            "data": {
                "symbol": "BTCUSDT",
                "timeframe": "1h",
                "hours": hours,
                "count": len(ohlcv_rows),
                "data": ohlcv_rows,
            },
            "source": ohlcv_source,
        },
        "p2p": {
            "data": {
                "count": len(p2p_rows),
                "hours": min(hours, 24),
                "latest": p2p_rows[0] if p2p_rows else None,
                "data": p2p_rows,
            },
            "source": p2p_source,
        },
        "risk": {"data": {
            "timestamp": latest.get("timestamp"),
            "price": latest.get("close"),
            "source": latest_source,
            **risk,
        }},
        "wallet": {"wallet": wallet},
        "trades": {
            "count": len(trade_rows),
            "data": trade_rows,
            "portfolio": portfolio,
        },
        "data_status": status,
    }


@router.get("")
async def get_trades(request: Request, limit: int = Query(50, ge=1, le=500)):
    user = get_current_user(request)
    rows = await asyncio.to_thread(list_demo_trades, user["id"], limit)
    return {
        "count": len(rows),
        "data": rows,
        "portfolio": summarize_demo_trades(user["id"], rows=rows),
    }
