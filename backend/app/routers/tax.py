from fastapi import APIRouter, Query

from app.services.tax_service import calc_tax

router = APIRouter(prefix="/api", tags=["tax"])


@router.get("/tax-estimate")
async def tax_estimate(
    amount: float = Query(..., gt=0),
    country: str = Query("VN"),
    holding_days: int = Query(0, ge=0),
):
    return calc_tax(amount, country, holding_days)
