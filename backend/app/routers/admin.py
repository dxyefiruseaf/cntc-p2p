from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.data_loader import load_mock_data
from app.repositories.market_repository import upsert_ohlcv, upsert_p2p
from app.schemas import SeedRequest

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.post("/seed-demo-data")
def seed_demo_data(payload: SeedRequest):
    settings = get_settings()
    if payload.token != settings.admin_seed_token:
        raise HTTPException(status_code=403, detail="Token seed không hợp lệ")

    mock = load_mock_data()
    ohlcv_rows = mock["ohlcv"]["data"][-payload.limit_ohlcv :]
    p2p_rows = mock["p2p"]["data"][: payload.limit_p2p]

    ohlcv_count = upsert_ohlcv(ohlcv_rows)
    p2p_count = upsert_p2p(p2p_rows)
    return {"ok": True, "inserted_or_updated": {"ohlcv": ohlcv_count, "p2p": p2p_count}}
