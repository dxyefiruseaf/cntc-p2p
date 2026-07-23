from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.repositories.market_repository import get_p2p_spread
from app.services.tax_service import calc_tax, zero_tax_metadata

router = APIRouter(prefix="/api", tags=["settlement"])


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _age_minutes(value: Any) -> float | None:
    dt = _parse_dt(value)
    if not dt:
        return None
    return round((datetime.now(timezone.utc) - dt).total_seconds() / 60, 1)


def _latest_by_type(rows: list[dict[str, Any]], trade_type: str) -> dict[str, Any] | None:
    return next((r for r in rows if r.get("trade_type") == trade_type), None)


def _gross_from_amount(amount: float, unit: str, price: float) -> tuple[float, float]:
    if unit == "usdt":
        return amount * price, amount
    # unit=vnd: amount is gross VND value, derive the approximate USDT quantity.
    return amount, amount / price if price else 0


@router.get("/net-settlement")
def net_settlement(
    amount: float = Query(..., gt=0),
    unit: str = Query("vnd", pattern="^(vnd|usdt)$"),
    side: str = Query("sell", pattern="^(sell|buy)$"),
    price_source: str = Query("p2p", pattern="^(p2p|market)$"),
    country: str = Query("VN"),
    holding_days: int = Query(0, ge=0),
):
    rows = get_p2p_spread(1)
    if not rows:
        raise HTTPException(status_code=404, detail="Chưa có dữ liệu P2P, hãy chạy pipeline đồng bộ dữ liệu và thử lại sau")

    # Với side=sell: người dùng bán USDT lấy VNĐ nên dùng dòng SELL. Với side=buy: dùng dòng BUY.
    trade_type = "SELL" if side == "sell" else "BUY"
    p2p_row = _latest_by_type(rows, trade_type)
    if not p2p_row:
        raise HTTPException(status_code=404, detail=f"Chưa có dữ liệu P2P chiều {trade_type}")

    p2p_price = float(p2p_row["p2p_price"])
    market_price = float(p2p_row["market_price"])
    applied_price = p2p_price if price_source == "p2p" else market_price
    alt_source = "market" if price_source == "p2p" else "p2p"
    alt_price = market_price if price_source == "p2p" else p2p_price

    gross_vnd, amount_usdt = _gross_from_amount(amount, unit, applied_price)
    alt_gross_vnd, _ = _gross_from_amount(amount_usdt if unit == "usdt" else amount, unit, alt_price)

    # VN tax is on sale value. For buy side we still calculate a transparent estimated cost with tax=0 for VN.
    taxable_vnd = gross_vnd if side == "sell" else 0
    alt_taxable_vnd = alt_gross_vnd if side == "sell" else 0
    if country.upper() == "US":
        # US branch uses `amount` as capital gain in original tax API; here we use the gross amount for demo consistency.
        taxable_vnd = gross_vnd
        alt_taxable_vnd = alt_gross_vnd

    tax = calc_tax(max(taxable_vnd, 0.000001), country, holding_days) if taxable_vnd > 0 else zero_tax_metadata(country, gross_vnd)
    alt_tax = calc_tax(max(alt_taxable_vnd, 0.000001), country, holding_days) if alt_taxable_vnd > 0 else {"tax_amount": 0}

    net_vnd = gross_vnd - float(tax.get("tax_amount", 0))
    alt_net_vnd = alt_gross_vnd - float(alt_tax.get("tax_amount", 0))
    difference = alt_net_vnd - net_vnd
    age = _age_minutes(p2p_row.get("timestamp"))
    warnings = []
    if age is not None and age > 120:
        warnings.append("Giá P2P đã cũ hơn 2 giờ, có thể không còn chính xác")

    return {
        "side": side,
        "unit": unit,
        "amount_input": amount,
        "amount_usdt": amount_usdt,
        "price_source": price_source,
        "applied_price": applied_price,
        "applied_price_age_minutes": age,
        "gross_amount_vnd": gross_vnd,
        "tax": {
            "country": tax.get("country"),
            "tax_rate_pct": tax.get("tax_rate_pct", 0),
            "tax_amount": tax.get("tax_amount", 0),
            "formula": tax.get("formula"),
            "legal_basis": tax.get("legal_basis", []),
            "methodology_note": tax.get("methodology_note"),
            "note": tax.get("note"),
            "disclaimer": tax.get("disclaimer"),
        },
        "net_amount_vnd": net_vnd,
        "comparison": {
            "alt_price_source": alt_source,
            "alt_applied_price": alt_price,
            "difference_vnd": difference,
            "verdict": "alt_better" if difference > 0 else ("selected_better" if difference < 0 else "equal"),
        },
        "warnings": warnings,
        "source": {
            "p2p_timestamp": p2p_row.get("timestamp"),
            "trade_type": trade_type,
            "p2p_price": p2p_price,
            "market_price": market_price,
        },
    }
