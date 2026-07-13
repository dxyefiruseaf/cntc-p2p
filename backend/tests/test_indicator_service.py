from app.services.indicator_service import (
    signal_from_latest,
    score_market,
    calculate_risk_score,
    generate_market_alerts
)

def test_signal_from_latest_buy():
    latest = {
        "close": 50000,
        "rsi_14": 25,  # BUY
        "macd_hist": 1.5, # BUY
        "bb_upper": 60000,
        "bb_lower": 51000, # close < lower -> BUY
        "ema_50": 49000 # close > ema -> BUY
    }
    result = signal_from_latest(latest)
    assert result["overall"]["verdict"] == "BUY"
    assert result["overall"]["buy"] == 4

def test_signal_from_latest_sell():
    latest = {
        "close": 60000,
        "rsi_14": 75,  # SELL
        "macd_hist": -1.5, # SELL
        "bb_upper": 59000, # close > upper -> SELL
        "bb_lower": 51000, 
        "ema_50": 61000 # close < ema -> SELL
    }
    result = signal_from_latest(latest)
    assert result["overall"]["verdict"] == "SELL"
    assert result["overall"]["sell"] == 4

def test_score_market():
    latest = {
        "close": 60000,
        "rsi_14": 80,  # score -2
        "macd_hist": -1.0, # score -1
        "ema_50": 61000, # score -1
        "ema_200": 62000 # score -1
    }
    summary = {"overall": {"verdict": "SELL"}} # score -1
    result = score_market(latest, summary)
    
    assert result["score"] == -6
    assert result["verdict"] == "SELL"

def test_calculate_risk_score():
    latest = {
        "close": 60000,
        "rsi_14": 80, # +22
        "macd_hist": -1.0, # +9
        "bb_width": 0.06, # +18
        "atr_14": 1500, # 1500/60000 = 2.5% -> +20
        "ema_50": 61000, # +10
        "ema_200": 62000, # +14
        "volume": 2000,
        "vol_ma_20": 1000 # ratio 2.0 -> +9
    }
    data_status = {
        "ohlcv_age_hours": 7, # +22
        "p2p_age_hours": 7 # +10
    }
    # Base is 20. Total expected: 20 + 22 + 9 + 18 + 20 + 10 + 14 + 9 + 22 + 10 = 154 -> clamped to 100
    result = calculate_risk_score(latest, data_status)
    assert result["score"] == 100
    assert result["level"] == "HIGH"

def test_generate_market_alerts():
    latest = {
        "close": 60000,
        "rsi_14": 80,
        "macd_hist": -1.0,
        "bb_upper": 59000,
        "bb_lower": 50000,
        "atr_14": 1500
    }
    data_status = {
        "is_ohlcv_fresh": False,
        "ohlcv_age_hours": 10,
        "is_p2p_fresh": False,
        "p2p_age_hours": 10
    }
    p2p_rows = [
        {"trade_type": "BUY", "spread_pct": 2.0}
    ]
    
    alerts = generate_market_alerts(latest, None, p2p_rows, data_status)
    
    assert len(alerts) > 0
    # The alerts should be sorted by severity: danger first
    assert alerts[0]["severity"] == "danger"
