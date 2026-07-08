from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.repositories.market_repository import create_demo_trade, list_demo_trades

router = APIRouter(prefix="/api/demo-trades", tags=["demo-trades"])


class DemoTradeCreate(BaseModel):
    side: str = Field(..., pattern="^(BUY|SELL|buy|sell)$")
    amount_vnd: float = Field(..., gt=0)
    amount_usdt: float | None = Field(None, ge=0)
    price_source: str = Field("p2p", pattern="^(p2p|market)$")
    applied_price: float | None = Field(None, ge=0)


@router.post("")
async def create_trade(payload: DemoTradeCreate, request: Request):
    user = get_current_user(request)
    row = {
        "user_id": user["id"],
        "side": payload.side.lower(),
        "amount_vnd": payload.amount_vnd,
        "amount_usdt": payload.amount_usdt,
        "price_source": payload.price_source,
        "applied_price": payload.applied_price,
    }
    created = create_demo_trade(row)
    if not created:
        raise HTTPException(status_code=503, detail="Không lưu được giao dịch demo")
    return created


@router.get("")
async def get_trades(request: Request, limit: int = Query(50, ge=1, le=200)):
    user = get_current_user(request)
    rows = list_demo_trades(user["id"], limit)
    return {"count": len(rows), "data": rows}
