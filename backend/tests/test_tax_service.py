import pytest
from fastapi import HTTPException
from app.services.tax_service import calc_tax

def test_calc_tax_invalid_amount():
    with pytest.raises(HTTPException) as exc_info:
        calc_tax(amount=-100)
    assert exc_info.value.status_code == 400
    assert "amount phải lớn hơn 0" in exc_info.value.detail

def test_calc_tax_invalid_country():
    with pytest.raises(HTTPException) as exc_info:
        calc_tax(amount=1000, country="UK")
    assert exc_info.value.status_code == 400
    assert "country chỉ hỗ trợ VN hoặc US" in exc_info.value.detail

def test_calc_tax_vn():
    result = calc_tax(amount=100_000_000, country="vn")
    assert result["country"] == "VN"
    assert result["tax_rate_pct"] == 0.1
    assert result["tax_amount"] == 100_000
    assert result["net_amount"] == 99_900_000
    assert result["taxable_base"] == "sale_value"

def test_calc_tax_us_short_term():
    result = calc_tax(amount=10_000, country="US", holding_days=100)
    assert result["country"] == "US"
    assert result["tax_rate_pct"] == 22.0
    assert result["tax_amount"] == 2200
    assert result["net_amount"] == 7800

def test_calc_tax_us_long_term_0_percent():
    result = calc_tax(amount=40_000, country="US", holding_days=365)
    assert result["country"] == "US"
    assert result["tax_rate_pct"] == 0.0
    assert result["tax_amount"] == 0

def test_calc_tax_us_long_term_15_percent():
    result = calc_tax(amount=100_000, country="US", holding_days=400)
    assert result["country"] == "US"
    assert result["tax_rate_pct"] == 15.0
    assert result["tax_amount"] == 15000

def test_calc_tax_us_long_term_20_percent():
    result = calc_tax(amount=500_000, country="US", holding_days=1000)
    assert result["country"] == "US"
    assert result["tax_rate_pct"] == 20.0
    assert result["tax_amount"] == 100000
