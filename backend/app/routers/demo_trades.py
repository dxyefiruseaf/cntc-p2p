from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.auth import get_current_user
from app.data_loader import load_mock_data
from app.repositories.market_repository import (
    execute_demo_trade,
    get_demo_portfolio,
    get_latest_ohlcv,
    get_ohlcv,
    get_p2p_spread,
    get_trade_terminal_account_snapshot,
    get_wallet_for_user,
    list_demo_trades,
    summarize_demo_trades,
)
from app.services.indicator_service import calculate_risk_score

router = APIRouter(prefix="/api/demo-trades", tags=["demo-trades"])
logger = logging.getLogger(__name__)


class DemoTradeCreate(BaseModel):
    side: str = Field(..., pattern="^(BUY|SELL|buy|sell)$")
    amount_vnd: float = Field(..., gt=0)
    # `amount_usdt` is the legacy database/API field. Both fields represent
    # BTC quantity; accepting `amount_btc` makes the client contract clear.
    amount_btc: float | None = Field(None, gt=0)
    amount_usdt: float | None = Field(None, gt=0)
    price_source: str = Field("p2p", pattern="^(p2p|market)$")
    applied_price: float | None = Field(None, gt=0)


def _private_cache_headers(response: Response, seconds: int = 10) -> None:
    response.headers["Cache-Control"] = f"private, max-age={seconds}, stale-while-revalidate={seconds * 2}"
    response.headers["Vary"] = "Authorization"


def _fallback_market(hours: int) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], str]:
    mock = load_mock_data()
    latest = get_latest_ohlcv()
    rows = get_ohlcv(hours)
    p2p = get_p2p_spread(min(hours, 168))
    source = "supabase"
    if not latest:
        latest = mock.get("latest", {})
        source = "mock"
    if not rows:
        rows = (mock.get("ohlcv") or {}).get("data", [])[-hours:]
        source = "mock"
    if not p2p:
        p2p = (mock.get("p2p") or {}).get("data", [])[: min(hours, 168) * 2]
        source = "mock"
    return latest or {}, rows or [], p2p or [], source


@router.post("")
async def create_trade(payload: DemoTradeCreate, request: Request):
    user = await run_in_threadpool(get_current_user, request)
    amount_asset = float(payload.amount_btc or payload.amount_usdt or 0)
    if amount_asset <= 0:
        raise HTTPException(status_code=400, detail="Khối lượng BTC mô phỏng phải lớn hơn 0")

    try:
        result = await run_in_threadpool(
            execute_demo_trade,
            user["id"],
            payload.side,
            payload.amount_vnd,
            amount_asset,
            payload.price_source,
            payload.applied_price,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Không thể thực hiện giao dịch demo cho user=%s", user.get("id"))
        raise HTTPException(
            status_code=503,
            detail="Không thể ghi giao dịch demo. Vui lòng thử lại hoặc kiểm tra cấu hình Supabase.",
        ) from exc

    if not result:
        raise HTTPException(status_code=503, detail="Không lưu được giao dịch demo")
    return result


@router.get("")
async def get_trades(
    request: Request,
    response: Response,
    limit: int = Query(20, ge=1, le=100),
    before: str | None = Query(None, description="Cursor created_at của trang kế tiếp"),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    side: str | None = Query(None, pattern="^(buy|sell|BUY|SELL)$"),
    search: str = Query("", max_length=50),
    sort_by: str = Query("created_at", pattern="^(created_at|amount_vnd|amount_usdt|applied_price)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
):
    user = await run_in_threadpool(get_current_user, request)
    _private_cache_headers(response, 8)
    rows, portfolio = await asyncio.gather(
        run_in_threadpool(
            list_demo_trades,
            user["id"],
            limit,
            before_created_at=before,
            date_from=date_from,
            date_to=date_to,
            side=side,
            search=search,
            sort_by=sort_by,
            sort_order=sort_order,
        ),
        run_in_threadpool(summarize_demo_trades, user["id"]),
    )
    next_cursor = rows[-1].get("created_at") if len(rows) == limit and sort_by == "created_at" else None
    return {
        "count": len(rows),
        "data": rows,
        "portfolio": portfolio,
        "next_cursor": next_cursor,
        "has_next": bool(next_cursor),
    }


@router.get("/terminal")
async def terminal_snapshot(
    request: Request,
    response: Response,
    hours: int = Query(168, ge=24, le=720),
    limit: int = Query(20, ge=1, le=50),
):
    """One lightweight payload for the virtual trading terminal.

    It replaces six browser requests and performs independent blocking
    Supabase reads concurrently in FastAPI's thread pool.
    """
    user = await run_in_threadpool(get_current_user, request)
    _private_cache_headers(response, 8)

    market_task = run_in_threadpool(_fallback_market, hours)
    account_task = run_in_threadpool(get_trade_terminal_account_snapshot, user["id"], limit)

    (latest, rows, p2p_rows, source), account_snapshot = await asyncio.gather(
        market_task,
        account_task,
    )
    if account_snapshot:
        wallet = account_snapshot.get("wallet") or {}
        trades = account_snapshot.get("trades") or []
        portfolio = account_snapshot.get("portfolio") or {}
    else:
        wallet, trades, portfolio = await asyncio.gather(
            run_in_threadpool(get_wallet_for_user, user["id"]),
            run_in_threadpool(list_demo_trades, user["id"], limit),
            run_in_threadpool(summarize_demo_trades, user["id"]),
        )

    risk = calculate_risk_score(latest)
    latest_buy = next((row for row in p2p_rows if str(row.get("trade_type", "")).upper() == "BUY"), None)
    latest_sell = next((row for row in p2p_rows if str(row.get("trade_type", "")).upper() == "SELL"), None)

    return {
        "latest": latest,
        "ohlcv": {
            "symbol": "BTCUSDT",
            "timeframe": "1h",
            "hours": hours,
            "count": len(rows),
            "data": rows,
        },
        "p2p": {
            "count": len(p2p_rows),
            "latest": p2p_rows[0] if p2p_rows else None,
            "buy": latest_buy,
            "sell": latest_sell,
            "data": p2p_rows,
        },
        "risk": risk,
        "wallet": wallet,
        "portfolio": portfolio,
        "trades": {
            "count": len(trades),
            "data": trades,
            "next_cursor": trades[-1].get("created_at") if len(trades) == limit else None,
        },
        "source": source,
    }
