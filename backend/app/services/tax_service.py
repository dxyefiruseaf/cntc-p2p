from __future__ import annotations

from typing import Any

from fastapi import HTTPException

DISCLAIMER = (
    "Kết quả chỉ là mô phỏng phục vụ học tập, không phải tờ khai và không thay thế "
    "ý kiến của cơ quan thuế, luật sư hoặc chuyên gia thuế."
)

VN_LEGAL_BASIS = [
    {
        "title": "Nghị quyết 05/2025/NQ-CP về thí điểm thị trường tài sản mã hóa",
        "provision": "Khoản 9 Điều 4: trong thời gian chưa có chính sách riêng, chính sách thuế đối với giao dịch tài sản mã hóa được áp dụng như đối với chứng khoán.",
        "url": "https://vanban.chinhphu.vn/?docid=215249&pageid=27160",
    },
    {
        "title": "Luật Thuế thu nhập cá nhân số 109/2025/QH15",
        "provision": "Thuế TNCN đối với chuyển nhượng chứng khoán được xác định bằng giá chuyển nhượng từng lần nhân 0,1%.",
        "url": "https://xaydungchinhsach.chinhphu.vn/quy-dinh-thue-thu-nhap-ca-nhan-doi-voi-thu-nhap-tu-chuyen-nhuong-von-119260327092024617.htm",
    },
]

US_LEGAL_BASIS = [
    {
        "title": "IRS Topic No. 409 — Capital Gains and Losses",
        "provision": "Lãi vốn dài hạn thường được áp dụng thuế suất 0%, 15% hoặc 20%; lãi ngắn hạn chịu thuế theo thu nhập thông thường.",
        "url": "https://www.irs.gov/taxtopics/tc409",
    },
    {
        "title": "IRS Revenue Procedure 2025-32",
        "provision": "Ngưỡng thu nhập chịu thuế cho các mức lãi vốn dài hạn năm 2026; tài liệu được hiển thị để người dùng đối chiếu, không được suy ra chỉ từ số lãi vốn nhập vào.",
        "url": "https://www.irs.gov/pub/irs-drop/rp-25-32.pdf",
    },
]


def legal_basis_for(country: str) -> list[dict[str, str]]:
    return VN_LEGAL_BASIS if country.upper().strip() == "VN" else US_LEGAL_BASIS


def zero_tax_metadata(country: str, gross_amount: float) -> dict[str, Any]:
    country_code = country.upper().strip()
    return {
        "country": country_code,
        "gross_amount": gross_amount,
        "taxable_base": "none_on_buy_side",
        "tax_rate_pct": 0.0,
        "tax_amount": 0.0,
        "net_amount": gross_amount,
        "formula": {
            "tax": "Thuế bán = 0 (giao dịch đang ở chiều mua trong mô hình)",
            "net": "Chi phí ròng = Giá trị quy đổi",
            "substitution": f"{gross_amount:,.0f} − 0 = {gross_amount:,.0f}",
        },
        "legal_basis": legal_basis_for(country_code),
        "methodology_note": "Mô hình chỉ ước tính thuế tại thời điểm bán; chiều mua không ghi nhận thuế bán.",
        "note": "Chiều mua không phát sinh thuế bán trong mô phỏng này.",
        "disclaimer": DISCLAIMER,
    }


def calc_tax(amount: float, country: str = "VN", holding_days: int = 0) -> dict[str, Any]:
    if amount <= 0:
        raise HTTPException(status_code=400, detail="amount phải lớn hơn 0")

    country = country.upper().strip()
    if country not in {"VN", "US"}:
        raise HTTPException(status_code=400, detail="country chỉ hỗ trợ VN hoặc US")

    if country == "VN":
        tax_rate_pct = 0.1
        tax_amount = amount * tax_rate_pct / 100
        net_amount = amount - tax_amount
        return {
            "country": "VN",
            "gross_amount": amount,
            "taxable_base": "sale_value",
            "tax_rate_pct": tax_rate_pct,
            "tax_amount": tax_amount,
            "net_amount": net_amount,
            "formula": {
                "tax": "Thuế TNCN ước tính = Giá trị bán × 0,1%",
                "net": "Thực nhận = Giá trị bán − Thuế TNCN ước tính",
                "substitution": f"{amount:,.0f} × 0,1% = {tax_amount:,.0f}; {amount:,.0f} − {tax_amount:,.0f} = {net_amount:,.0f}",
            },
            "legal_basis": VN_LEGAL_BASIS,
            "methodology_note": (
                "Áp dụng cho mô phỏng giao dịch tài sản mã hóa trong khuôn khổ thí điểm tại Việt Nam: "
                "tạm áp dụng chính sách thuế như chứng khoán cho đến khi có chính sách riêng."
            ),
            "note": "Thuế TNCN 0,10% trên giá trị bán trong mô hình Việt Nam.",
            "disclaimer": DISCLAIMER,
        }

    # For the US demo, `amount` is interpreted as taxable capital gain, not sale proceeds.
    # The API does not collect total taxable income or filing status, so it must not infer a legal bracket from `amount`.
    if holding_days >= 365:
        tax_rate_pct = 15.0
        note = f"Lãi vốn dài hạn (giữ {holding_days} ngày) — mô hình minh họa dùng mức mặc định 15%; mức thực tế có thể là 0%, 15% hoặc 20% tùy thu nhập chịu thuế và tình trạng khai thuế."
    else:
        tax_rate_pct = 22.0
        note = f"Lãi vốn ngắn hạn (giữ {holding_days} ngày) — mô hình minh họa dùng mức thuế thu nhập thông thường 22%; mức thực tế phụ thuộc khung thuế của người nộp thuế."

    tax_amount = amount * tax_rate_pct / 100
    net_amount = amount - tax_amount
    return {
        "country": "US",
        "gross_amount": amount,
        "taxable_base": "capital_gain_assumption",
        "tax_rate_pct": tax_rate_pct,
        "tax_amount": tax_amount,
        "net_amount": net_amount,
        "formula": {
            "tax": "Thuế ước tính = Lãi vốn chịu thuế × Thuế suất minh họa",
            "net": "Lãi sau thuế = Lãi vốn chịu thuế − Thuế ước tính",
            "substitution": f"{amount:,.2f} × {tax_rate_pct:.2f}% = {tax_amount:,.2f}; {amount:,.2f} − {tax_amount:,.2f} = {net_amount:,.2f}",
        },
        "legal_basis": US_LEGAL_BASIS,
        "methodology_note": (
            "Mô hình giả định số tiền nhập là lãi vốn chịu thuế và dùng thuế suất minh họa vì chưa có tổng thu nhập chịu thuế hoặc tình trạng khai thuế. "
            "Thực tế phải xác định lãi/lỗ từ giá bán trừ giá vốn và áp dụng đúng khung thuế cá nhân."
        ),
        "note": note,
        "disclaimer": DISCLAIMER,
    }
