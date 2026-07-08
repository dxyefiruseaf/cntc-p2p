from typing import Any


def signal_from_latest(latest: dict[str, Any]) -> dict[str, Any]:
    price = latest.get("close")
    rsi = latest.get("rsi_14")
    macd_hist = latest.get("macd_hist")
    bb_upper = latest.get("bb_upper")
    bb_lower = latest.get("bb_lower")
    ema_50 = latest.get("ema_50")

    signals: dict[str, dict[str, Any]] = {}

    if rsi is None:
        signals["RSI"] = {"value": None, "signal": "NEUTRAL", "note": "Chưa đủ dữ liệu RSI"}
    elif rsi < 30:
        signals["RSI"] = {"value": rsi, "signal": "BUY", "note": "RSI dưới 30, thị trường có dấu hiệu quá bán"}
    elif rsi > 70:
        signals["RSI"] = {"value": rsi, "signal": "SELL", "note": "RSI trên 70, thị trường có dấu hiệu quá mua"}
    else:
        signals["RSI"] = {"value": rsi, "signal": "NEUTRAL", "note": "RSI ở vùng trung tính"}

    if macd_hist is None:
        signals["MACD"] = {"value": None, "signal": "NEUTRAL", "note": "Chưa đủ dữ liệu MACD"}
    elif macd_hist > 0:
        signals["MACD"] = {"value": macd_hist, "signal": "BUY", "note": "MACD histogram dương, động lượng tăng tốt hơn"}
    elif macd_hist < 0:
        signals["MACD"] = {"value": macd_hist, "signal": "SELL", "note": "MACD histogram âm, động lượng tăng yếu"}
    else:
        signals["MACD"] = {"value": macd_hist, "signal": "NEUTRAL", "note": "MACD chưa cho tín hiệu rõ"}

    if price is None or bb_upper is None or bb_lower is None:
        signals["Bollinger"] = {"value": price, "signal": "NEUTRAL", "note": "Chưa đủ dữ liệu Bollinger Bands"}
    elif price <= bb_lower:
        signals["Bollinger"] = {"value": price, "signal": "BUY", "note": "Giá gần/chạm dải dưới Bollinger, có khả năng quá bán"}
    elif price >= bb_upper:
        signals["Bollinger"] = {"value": price, "signal": "SELL", "note": "Giá gần/chạm dải trên Bollinger, cần thận trọng quá mua"}
    else:
        signals["Bollinger"] = {"value": price, "signal": "NEUTRAL", "note": "Giá đang nằm trong dải Bollinger"}

    if price is None or ema_50 is None:
        signals["EMA_Trend"] = {"value": ema_50, "signal": "NEUTRAL", "note": "Chưa đủ dữ liệu EMA50"}
    elif price > ema_50:
        signals["EMA_Trend"] = {"value": ema_50, "signal": "BUY", "note": "Giá trên EMA50, xu hướng ngắn/trung hạn tích cực"}
    else:
        signals["EMA_Trend"] = {"value": ema_50, "signal": "SELL", "note": "Giá dưới EMA50, xu hướng ngắn/trung hạn yếu"}

    counts = {"BUY": 0, "SELL": 0, "NEUTRAL": 0}
    for item in signals.values():
        counts[item["signal"]] += 1

    if counts["BUY"] > counts["SELL"] and counts["BUY"] >= 2:
        verdict = "BUY"
    elif counts["SELL"] > counts["BUY"] and counts["SELL"] >= 2:
        verdict = "SELL"
    else:
        verdict = "NEUTRAL"

    return {
        "timestamp": latest.get("timestamp"),
        "price": price,
        "signals": signals,
        "overall": {
            "buy": counts["BUY"],
            "sell": counts["SELL"],
            "neutral": counts["NEUTRAL"],
            "verdict": verdict,
        },
    }


def score_market(latest: dict[str, Any], summary: dict[str, Any]) -> dict[str, Any]:
    score = 0
    reasons: list[str] = []

    rsi = latest.get("rsi_14")
    macd_hist = latest.get("macd_hist")
    close = latest.get("close")
    ema_50 = latest.get("ema_50")
    ema_200 = latest.get("ema_200")

    if rsi is not None:
        if rsi < 30:
            score += 2
            reasons.append("RSI dưới 30, thị trường có dấu hiệu quá bán nên có thể xuất hiện nhịp hồi.")
        elif rsi > 70:
            score -= 2
            reasons.append("RSI trên 70, thị trường có dấu hiệu quá mua nên rủi ro điều chỉnh cao hơn.")
        else:
            reasons.append("RSI đang ở vùng trung tính, chưa ủng hộ mua/bán mạnh.")

    if macd_hist is not None:
        if macd_hist > 0:
            score += 1
            reasons.append("MACD histogram dương, động lượng tăng đang tốt hơn.")
        elif macd_hist < 0:
            score -= 1
            reasons.append("MACD histogram âm, động lượng tăng đang yếu.")

    if close is not None and ema_50 is not None:
        if close > ema_50:
            score += 1
            reasons.append("Giá đang nằm trên EMA50, xu hướng ngắn/trung hạn tích cực hơn.")
        else:
            score -= 1
            reasons.append("Giá đang nằm dưới EMA50, xu hướng ngắn/trung hạn yếu hơn.")

    if close is not None and ema_200 is not None:
        if close > ema_200:
            score += 1
            reasons.append("Giá trên EMA200, xu hướng dài hạn vẫn tương đối tích cực.")
        else:
            score -= 1
            reasons.append("Giá dưới EMA200, cần thận trọng với xu hướng dài hạn.")

    summary_verdict = summary.get("overall", {}).get("verdict")
    if summary_verdict == "BUY":
        score += 1
    elif summary_verdict == "SELL":
        score -= 1

    if score >= 3:
        verdict = "BUY"
    elif score <= -3:
        verdict = "SELL"
    else:
        verdict = "NEUTRAL"

    confidence = min(85, max(45, 55 + abs(score) * 8))
    return {"verdict": verdict, "score": score, "confidence": confidence, "reasons": reasons[:5]}
