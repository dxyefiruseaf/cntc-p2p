from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.auth import get_current_user
from app.repositories.market_repository import (
    count_active_alerts,
    create_alert_rule,
    delete_alert_rule,
    list_alert_rules,
    update_alert_rule,
)

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


class AlertCreate(BaseModel):
    metric: str = Field(..., pattern="^(price|rsi|p2p_spread_sell|p2p_spread_buy)$")
    operator: str = Field(..., pattern="^(gt|lt)$")
    threshold: float
    active: bool = True


class AlertUpdate(BaseModel):
    metric: str | None = Field(
        None, pattern="^(price|rsi|p2p_spread_sell|p2p_spread_buy)$"
    )
    operator: str | None = Field(None, pattern="^(gt|lt)$")
    threshold: float | None = None
    active: bool | None = None


@router.get("")
async def get_alerts(request: Request):
    user = get_current_user(request)
    rows = list_alert_rules(user["id"])
    return {"count": len(rows), "data": rows}


@router.post("")
async def post_alert(payload: AlertCreate, request: Request):
    user = get_current_user(request)
    if payload.active and count_active_alerts(user["id"]) >= 5:
        raise HTTPException(
            status_code=400, detail="Mỗi tài khoản chỉ được bật tối đa 5 cảnh báo"
        )
    row = payload.model_dump()
    row["user_id"] = user["id"]
    created = create_alert_rule(row)
    if not created:
        raise HTTPException(status_code=503, detail="Không tạo được cảnh báo")
    return created


@router.patch("/{rule_id}")
async def patch_alert(rule_id: str, payload: AlertUpdate, request: Request):
    user = get_current_user(request)
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Không có dữ liệu cập nhật")
    updated = update_alert_rule(rule_id, user["id"], updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo")
    return updated


@router.delete("/{rule_id}")
async def remove_alert(rule_id: str, request: Request):
    user = get_current_user(request)
    ok = delete_alert_rule(rule_id, user["id"])
    if not ok:
        raise HTTPException(status_code=404, detail="Không tìm thấy cảnh báo")
    return {"ok": True}
