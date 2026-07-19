from __future__ import annotations

import json
import unittest

from app.services.ai_service import (
    build_market_prompt,
    detect_intent,
    extract_amount_vnd,
    fallback_answer,
)


LATEST = {
    "timestamp": "2026-07-19T05:00:00+00:00",
    "open": 64000,
    "high": 65000,
    "low": 63500,
    "close": 64500,
    "volume": 125,
    "rsi_14": 62.4,
    "macd": 120,
    "macd_signal": 100,
    "macd_hist": 20,
    "bb_upper": 66000,
    "bb_mid": 64000,
    "bb_lower": 62000,
    "ema_20": 64200,
    "ema_50": 63000,
    "ema_200": 60000,
    "atr_14": 850,
    "stoch_k": 70,
    "stoch_d": 66,
    "vol_ma_20": 110,
}
SUMMARY = {
    "overall": {"buy": 3, "sell": 0, "neutral": 1, "verdict": "BUY"},
    "signals": {"RSI": {"value": 62.4, "signal": "NEUTRAL"}},
}
P2P = {
    "count": 2,
    "buy": {"trade_type": "BUY", "p2p_price": 26200, "market_price": 26180, "spread_pct": 0.08, "samples": 10},
    "sell": {"trade_type": "SELL", "p2p_price": 26160, "market_price": 26180, "spread_pct": -0.08, "samples": 10},
    "data": [],
}
RULE = {"verdict": "BUY", "confidence": 71, "reasons": ["Giá trên EMA50"]}


class IntentTests(unittest.TestCase):
    def test_detects_focused_intents(self):
        self.assertEqual(detect_intent("RSI hiện tại là bao nhiêu?"), "indicator")
        self.assertEqual(detect_intent("Giờ có nên mua BTC không?"), "market_decision")
        self.assertEqual(detect_intent("Giá bán P2P hiện tại thế nào?"), "p2p")
        self.assertEqual(detect_intent("Bán 100 triệu thì thuế bao nhiêu?"), "tax")
        self.assertEqual(detect_intent("Mở Dashboard ở đâu?"), "website_help")
        self.assertEqual(detect_intent("Trong Decision Hub tôi có nên mua BTC không?"), "market_decision")
        self.assertEqual(detect_intent("Tôi muốn mua BTC bằng 5 triệu hôm nay"), "market_decision")
        self.assertEqual(detect_intent("Vì sao BTC đang giảm hôm nay?"), "market_status")
        self.assertEqual(detect_intent("Hướng dẫn sử dụng Decision Hub"), "website_help")

    def test_extracts_vnd_amount(self):
        self.assertEqual(extract_amount_vnd("Bán 100 triệu thì thuế bao nhiêu?"), 100_000_000)
        self.assertEqual(extract_amount_vnd("Tính cho 1,5 tỷ đồng"), 1_500_000_000)


class PromptTests(unittest.TestCase):
    def test_indicator_prompt_only_contains_requested_indicator(self):
        prompt = build_market_prompt("RSI hiện tại thế nào?", LATEST, SUMMARY, P2P, RULE)
        self.assertIn('"rsi_14": 62.4', prompt)
        self.assertNotIn('"ema_200": 60000', prompt)
        self.assertNotIn('"p2p_spread"', prompt)

    def test_website_prompt_does_not_include_market_snapshot(self):
        prompt = build_market_prompt("Mở Dashboard ở đâu?", {}, {}, {}, RULE)
        self.assertIn('"market_data_required": false', prompt)
        self.assertNotIn('"market_snapshot"', prompt)
        self.assertNotIn('"p2p_spread"', prompt)

    def test_fallback_rsi_is_focused(self):
        answer = fallback_answer("RSI hiện tại thế nào?", RULE, LATEST, P2P)
        self.assertIn("RSI(14)", answer)
        self.assertNotIn("P2P", answer)
        self.assertNotIn("EMA50", answer)


if __name__ == "__main__":
    unittest.main()
