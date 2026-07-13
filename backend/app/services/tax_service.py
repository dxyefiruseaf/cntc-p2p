from __future__ import annotations

from typing import Any

from fastapi import HTTPException

DISCLAIMER = (
    "Chỉ mang tính ước tính tham khảo, không thay thế tư vấn thuế chuyên nghiệp."
)


def calc_tax(
    amount: float, country: str = "VN", holding_days: int = 0
) -> dict[str, Any]:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount phải lớn hơn 0")

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
            "disclaimer": DISCLAIMER,
        }

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
        "disclaimer": DISCLAIMER,
    }
