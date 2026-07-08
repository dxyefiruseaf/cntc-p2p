from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api", tags=["tax"])


@router.get("/tax-estimate")
async def tax_estimate(
    amount: float = Query(..., gt=0),
    country: str = Query("VN"),
    holding_days: int = Query(0, ge=0),
):
    country = country.upper().strip()
    if country not in {"VN", "US"}:
        raise HTTPException(status_code=400, detail="country chỉ hỗ trợ VN hoặc US")

    if country == "VN":
        tax_rate_pct = 0.1
        tax_amount = amount * tax_rate_pct / 100
        return {
            "country": "VN",
            "gross_amount": amount,
            "taxable_base": "sale_value",
            "tax_rate_pct": tax_rate_pct,
            "tax_amount": tax_amount,
            "net_amount": amount - tax_amount,
            "note": "Thuế TNCN 0.10% trên GIÁ TRỊ BÁN, theo mô hình tham khảo trong dự án BTC BigData.",
            "disclaimer": "Chỉ mang tính ước tính tham khảo, không thay thế tư vấn thuế chuyên nghiệp.",
        }

    # Mô phỏng đơn giản cho bài demo: long-term bracket mềm hơn, short-term cao hơn.
    if holding_days >= 365:
        if amount <= 44625:
            tax_rate_pct = 0.0
        elif amount <= 492300:
            tax_rate_pct = 15.0
        else:
            tax_rate_pct = 20.0
        note = f"Long-term capital gains (giữ {holding_days} ngày >= 365) — mô phỏng bracket 0%/15%/20%."
    else:
        tax_rate_pct = 22.0
        note = f"Short-term capital gains (giữ {holding_days} ngày < 365) — mô phỏng thuế suất phổ thông 22%."

    tax_amount = amount * tax_rate_pct / 100
    return {
        "country": "US",
        "gross_amount": amount,
        "taxable_base": "capital_gain",
        "tax_rate_pct": tax_rate_pct,
        "tax_amount": tax_amount,
        "net_amount": amount - tax_amount,
        "note": note,
        "disclaimer": "Chỉ mang tính ước tính tham khảo, không thay thế tư vấn thuế chuyên nghiệp.",
    }
