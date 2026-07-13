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
        signals["RSI"] = {
            "value": None,
            "signal": "NEUTRAL",
            "note": "Chưa đủ dữ liệu RSI",
        }
    elif rsi < 30:
        signals["RSI"] = {
            "value": rsi,
            "signal": "BUY",
            "note": "RSI dưới 30, thị trường có dấu hiệu quá bán",
        }
    elif rsi > 70:
        signals["RSI"] = {
            "value": rsi,
            "signal": "SELL",
            "note": "RSI trên 70, thị trường có dấu hiệu quá mua",
        }
    else:
        signals["RSI"] = {
            "value": rsi,
            "signal": "NEUTRAL",
            "note": "RSI ở vùng trung tính",
        }

    if macd_hist is None:
        signals["MACD"] = {
            "value": None,
            "signal": "NEUTRAL",
            "note": "Chưa đủ dữ liệu MACD",
        }
    elif macd_hist > 0:
        signals["MACD"] = {
            "value": macd_hist,
            "signal": "BUY",
            "note": "MACD histogram dương, động lượng tăng tốt hơn",
        }
    elif macd_hist < 0:
        signals["MACD"] = {
            "value": macd_hist,
            "signal": "SELL",
            "note": "MACD histogram âm, động lượng tăng yếu",
        }
    else:
        signals["MACD"] = {
            "value": macd_hist,
            "signal": "NEUTRAL",
            "note": "MACD chưa cho tín hiệu rõ",
        }

    if price is None or bb_upper is None or bb_lower is None:
        signals["Bollinger"] = {
            "value": price,
            "signal": "NEUTRAL",
            "note": "Chưa đủ dữ liệu Bollinger Bands",
        }
    elif price <= bb_lower:
        signals["Bollinger"] = {
            "value": price,
            "signal": "BUY",
            "note": "Giá gần/chạm dải dưới Bollinger, có khả năng quá bán",
        }
    elif price >= bb_upper:
        signals["Bollinger"] = {
            "value": price,
            "signal": "SELL",
            "note": "Giá gần/chạm dải trên Bollinger, cần thận trọng quá mua",
        }
    else:
        signals["Bollinger"] = {
            "value": price,
            "signal": "NEUTRAL",
            "note": "Giá đang nằm trong dải Bollinger",
        }

    if price is None or ema_50 is None:
        signals["EMA_Trend"] = {
            "value": ema_50,
            "signal": "NEUTRAL",
            "note": "Chưa đủ dữ liệu EMA50",
        }
    elif price > ema_50:
        signals["EMA_Trend"] = {
            "value": ema_50,
            "signal": "BUY",
            "note": "Giá trên EMA50, xu hướng ngắn/trung hạn tích cực",
        }
    else:
        signals["EMA_Trend"] = {
            "value": ema_50,
            "signal": "SELL",
            "note": "Giá dưới EMA50, xu hướng ngắn/trung hạn yếu",
        }

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
            reasons.append(
                "RSI dưới 30, thị trường có dấu hiệu quá bán nên có thể xuất hiện nhịp hồi."
            )
        elif rsi > 70:
            score -= 2
            reasons.append(
                "RSI trên 70, thị trường có dấu hiệu quá mua nên rủi ro điều chỉnh cao hơn."
            )
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
            reasons.append(
                "Giá đang nằm trên EMA50, xu hướng ngắn/trung hạn tích cực hơn."
            )
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
    return {
        "verdict": verdict,
        "score": score,
        "confidence": confidence,
        "reasons": reasons[:5],
    }


# ---------------------------------------------------------------------------
# Feature upgrade: Risk score and rule-based market alerts
# ---------------------------------------------------------------------------


def _as_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        return number if number == number else None
    except (TypeError, ValueError):
        return None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def risk_level_from_score(score: int) -> str:
    if score >= 70:
        return "HIGH"
    if score >= 40:
        return "MEDIUM"
    return "LOW"


def calculate_risk_score(
    latest: dict[str, Any], data_status: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Return a simple, explainable 0-100 BTC risk score for the course MVP.

    This is intentionally rule-based, not a black-box prediction model. It turns
    common technical indicators into an easy-to-explain risk number.
    """
    base = 20.0
    factors: list[dict[str, Any]] = []

    def add(name: str, impact: float, note: str, value: Any = None) -> None:
        factors.append(
            {"name": name, "impact": round(impact, 2), "value": value, "note": note}
        )

    close = _as_float(latest.get("close"))
    rsi = _as_float(latest.get("rsi_14"))
    macd_hist = _as_float(latest.get("macd_hist"))
    bb_width = _as_float(latest.get("bb_width"))
    atr = _as_float(latest.get("atr_14"))
    ema_50 = _as_float(latest.get("ema_50"))
    ema_200 = _as_float(latest.get("ema_200"))
    volume = _as_float(latest.get("volume"))
    vol_ma_20 = _as_float(latest.get("vol_ma_20"))

    if rsi is None:
        add("RSI", 5, "Thiếu RSI nên tăng rủi ro vì tín hiệu chưa đủ dữ liệu.")
    elif rsi >= 75:
        add("RSI", 22, "RSI rất cao, thị trường có dấu hiệu quá mua mạnh.", rsi)
    elif rsi >= 70:
        add("RSI", 16, "RSI trên 70, rủi ro điều chỉnh tăng.", rsi)
    elif rsi <= 25:
        add(
            "RSI", 14, "RSI rất thấp, giá có thể hồi nhưng biến động ngắn hạn cao.", rsi
        )
    elif rsi <= 30:
        add(
            "RSI",
            9,
            "RSI dưới 30, thị trường quá bán nhưng chưa chắc đảo chiều ngay.",
            rsi,
        )
    else:
        add("RSI", 2, "RSI ở vùng trung tính.", rsi)

    if macd_hist is None:
        add("MACD", 4, "Thiếu MACD histogram nên chưa đánh giá được động lượng.")
    elif macd_hist < 0:
        add("MACD", 9, "MACD histogram âm, động lượng tăng đang yếu.", macd_hist)
    else:
        add(
            "MACD",
            2,
            "MACD histogram dương, động lượng chưa phải rủi ro chính.",
            macd_hist,
        )

    if close and ema_50:
        if close < ema_50:
            add("EMA50", 10, "Giá nằm dưới EMA50, xu hướng ngắn/trung hạn yếu.", ema_50)
        else:
            add("EMA50", 1, "Giá đang trên EMA50.", ema_50)
    if close and ema_200:
        if close < ema_200:
            add(
                "EMA200",
                14,
                "Giá nằm dưới EMA200, xu hướng dài hạn cần thận trọng.",
                ema_200,
            )
        else:
            add("EMA200", 1, "Giá đang trên EMA200.", ema_200)

    if bb_width is None:
        add("Bollinger width", 3, "Thiếu độ rộng Bollinger Bands.")
    else:
        # The stored value may be a ratio, e.g. 0.018 = 1.8%.
        bw_pct = bb_width * 100 if bb_width <= 1 else bb_width
        if bw_pct >= 5:
            add(
                "Bollinger width",
                18,
                "Bollinger Bands mở rộng mạnh, biến động đang cao.",
                round(bw_pct, 3),
            )
        elif bw_pct >= 3:
            add(
                "Bollinger width",
                12,
                "Bollinger Bands mở rộng, thị trường biến động đáng chú ý.",
                round(bw_pct, 3),
            )
        elif bw_pct >= 1.8:
            add(
                "Bollinger width",
                6,
                "Biên độ Bollinger ở mức vừa phải.",
                round(bw_pct, 3),
            )
        else:
            add("Bollinger width", 2, "Biên độ Bollinger thấp.", round(bw_pct, 3))

    if close and atr:
        atr_pct = atr / close * 100
        if atr_pct >= 2:
            add(
                "ATR",
                20,
                "ATR cao so với giá, rủi ro biến động lớn.",
                round(atr_pct, 3),
            )
        elif atr_pct >= 1:
            add("ATR", 12, "ATR ở mức đáng chú ý.", round(atr_pct, 3))
        else:
            add("ATR", 4, "ATR thấp/trung bình.", round(atr_pct, 3))

    if volume and vol_ma_20:
        ratio = volume / vol_ma_20 if vol_ma_20 else 0
        if ratio >= 1.8:
            add(
                "Volume",
                9,
                "Khối lượng cao bất thường so với trung bình 20 kỳ.",
                round(ratio, 3),
            )
        elif ratio <= 0.55:
            add(
                "Volume",
                5,
                "Thanh khoản thấp hơn trung bình, tín hiệu có thể kém tin cậy.",
                round(ratio, 3),
            )
        else:
            add("Volume", 2, "Khối lượng gần vùng bình thường.", round(ratio, 3))

    if data_status:
        ohlcv_age = _as_float(data_status.get("ohlcv_age_hours"))
        p2p_age = _as_float(data_status.get("p2p_age_hours"))
        if ohlcv_age is None:
            add("Data freshness", 10, "Chưa xác định được độ mới dữ liệu giá.")
        elif ohlcv_age > 6:
            add("Data freshness", 22, "Dữ liệu giá đã cũ hơn 6 giờ.", ohlcv_age)
        elif ohlcv_age > 2:
            add(
                "Data freshness",
                10,
                "Dữ liệu giá hơi cũ, nên kiểm tra pipeline.",
                ohlcv_age,
            )
        else:
            add("Data freshness", 0, "Dữ liệu giá còn mới.", ohlcv_age)
        if p2p_age is not None and p2p_age > 6:
            add("P2P freshness", 10, "Dữ liệu P2P đã cũ hơn 6 giờ.", p2p_age)

    score = int(round(_clamp(base + sum(f["impact"] for f in factors), 0, 100)))
    level = risk_level_from_score(score)
    label_vi = {
        "LOW": "Rủi ro thấp",
        "MEDIUM": "Rủi ro trung bình",
        "HIGH": "Rủi ro cao",
    }[level]
    recommendation = {
        "LOW": "Có thể quan sát cơ hội nhưng vẫn cần chia nhỏ vị thế và đặt ngưỡng rủi ro.",
        "MEDIUM": "Nên thận trọng, tránh vào lệnh lớn khi tín hiệu chưa đồng thuận.",
        "HIGH": "Ưu tiên bảo toàn vốn, không all-in/đòn bẩy và chờ tín hiệu rõ hơn.",
    }[level]
    top_factors = sorted(factors, key=lambda item: item["impact"], reverse=True)[:6]
    return {
        "score": score,
        "level": level,
        "label_vi": label_vi,
        "recommendation": recommendation,
        "factors": top_factors,
        "method": "Rule-based MVP: RSI + MACD + EMA + Bollinger width + ATR + Volume + Data freshness",
        "disclaimer": "Risk Score là chỉ báo tham khảo cho bài học, không phải khuyến nghị đầu tư cá nhân.",
    }


def generate_market_alerts(
    latest: dict[str, Any],
    summary: dict[str, Any] | None = None,
    p2p_rows: list[dict[str, Any]] | None = None,
    data_status: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []

    def push(
        severity: str, title: str, message: str, metric: str, value: Any = None
    ) -> None:
        alerts.append(
            {
                "severity": severity,
                "title": title,
                "message": message,
                "metric": metric,
                "value": value,
            }
        )

    close = _as_float(latest.get("close"))
    rsi = _as_float(latest.get("rsi_14"))
    macd_hist = _as_float(latest.get("macd_hist"))
    bb_upper = _as_float(latest.get("bb_upper"))
    bb_lower = _as_float(latest.get("bb_lower"))
    atr = _as_float(latest.get("atr_14"))

    if data_status:
        if data_status.get("is_ohlcv_fresh") is False:
            push(
                "danger",
                "Dữ liệu giá có thể đã cũ",
                "Không nên ra quyết định khi pipeline chưa cập nhật dữ liệu giá mới.",
                "ohlcv_age_hours",
                data_status.get("ohlcv_age_hours"),
            )
        if data_status.get("is_p2p_fresh") is False:
            push(
                "warn",
                "Dữ liệu P2P chưa tươi",
                "Kết quả so sánh P2P/thực nhận nên được xem là tham khảo.",
                "p2p_age_hours",
                data_status.get("p2p_age_hours"),
            )

    if rsi is not None:
        if rsi >= 75:
            push(
                "danger",
                "RSI quá mua mạnh",
                "RSI trên 75, rủi ro điều chỉnh ngắn hạn tăng.",
                "rsi_14",
                rsi,
            )
        elif rsi >= 70:
            push(
                "warn",
                "RSI quá mua",
                "RSI trên 70, nên thận trọng với lệnh mua mới.",
                "rsi_14",
                rsi,
            )
        elif rsi <= 25:
            push(
                "warn",
                "RSI quá bán mạnh",
                "Giá có thể hồi nhưng biến động vẫn cao, không nên bắt đáy vội.",
                "rsi_14",
                rsi,
            )

    if macd_hist is not None and macd_hist < 0:
        push(
            "warn",
            "Động lượng MACD yếu",
            "MACD histogram âm, lực tăng chưa rõ ràng.",
            "macd_hist",
            macd_hist,
        )

    if close is not None and bb_upper is not None and close >= bb_upper:
        push(
            "warn",
            "Giá gần dải trên Bollinger",
            "Giá đang ở vùng dễ bị chốt lời ngắn hạn.",
            "bb_upper",
            bb_upper,
        )
    if close is not None and bb_lower is not None and close <= bb_lower:
        push(
            "warn",
            "Giá gần dải dưới Bollinger",
            "Giá ở vùng quá bán, cần xác nhận thêm trước khi mua.",
            "bb_lower",
            bb_lower,
        )

    if close and atr:
        atr_pct = atr / close * 100
        if atr_pct >= 2:
            push(
                "danger",
                "ATR cao",
                "Biến động hiện tại lớn so với giá, nên giảm quy mô giao dịch demo.",
                "atr_pct",
                round(atr_pct, 3),
            )
        elif atr_pct >= 1:
            push(
                "warn",
                "ATR tăng",
                "Biến động đáng chú ý, cần đặt ngưỡng rủi ro rõ ràng.",
                "atr_pct",
                round(atr_pct, 3),
            )

    for row in p2p_rows or []:
        spread = _as_float(row.get("spread_pct"))
        trade_type = row.get("trade_type")
        if spread is None or trade_type not in {"BUY", "SELL"}:
            continue
        if abs(spread) >= 1.5:
            push(
                "warn",
                f"P2P {trade_type} lệch mạnh",
                f"Spread P2P {trade_type} đang lệch {spread:.3f}% so với giá tham chiếu.",
                f"p2p_spread_{trade_type.lower()}",
                spread,
            )
    if not alerts:
        push(
            "info",
            "Chưa có cảnh báo mạnh",
            "Các rule hiện tại chưa phát hiện tín hiệu rủi ro nổi bật.",
            "market",
            None,
        )
    severity_order = {"danger": 0, "warn": 1, "info": 2}
    return sorted(alerts, key=lambda item: severity_order.get(item["severity"], 3))[:8]
