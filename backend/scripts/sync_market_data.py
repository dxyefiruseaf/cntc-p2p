"""Đồng bộ dữ liệu thị trường mới vào Supabase.

Mục tiêu:
- Không dùng mock_data.json cho dữ liệu live.
- Mỗi lần chạy sẽ lấy dữ liệu mới từ PUBLIC_DATA_API_URL hoặc Binance,
  sau đó upsert vào Supabase.
- Có thể chạy thủ công hoặc chạy định kỳ bằng GitHub Actions/cron.

Cách chạy local:
  cd backend
  python scripts/sync_market_data.py

Biến môi trường quan trọng trong backend/.env:
  SUPABASE_URL=https://xxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY=...
  SYNC_SOURCE=public_api   # public_api | binance
  SYNC_HOURS=720
  PUBLIC_DATA_API_URL=https://btc-bigdata-is55a.onrender.com
"""
from __future__ import annotations

import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

OHLCV_TABLE = "btcusdt_ohlcv_1h"
P2P_TABLE = "p2p_spread_history"


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def get_supabase_client():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong backend/.env", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def chunks(items: list[dict[str, Any]], size: int = 500):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def clean_number(value: Any) -> float | int | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number


def iso_from_ms(ms: int | float) -> str:
    return datetime.fromtimestamp(float(ms) / 1000, tz=timezone.utc).isoformat()


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# ---------------------------------------------------------------------------
# Source 1: public API cũ trên Render
# ---------------------------------------------------------------------------


def fetch_json(url: str, method: str = "GET", json_body: dict[str, Any] | None = None, timeout: float = 30.0) -> Any:
    with httpx.Client(timeout=timeout, headers={"User-Agent": "btc-bigdata-sync/1.0"}) as client:
        if method.upper() == "POST":
            res = client.post(url, json=json_body)
        else:
            res = client.get(url)
        res.raise_for_status()
        return res.json()


def fetch_from_public_api(hours: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    base = os.getenv("PUBLIC_DATA_API_URL", "https://btc-bigdata-is55a.onrender.com").rstrip("/")
    ohlcv_payload = fetch_json(f"{base}/api/ohlcv?hours={hours}")
    p2p_payload = fetch_json(f"{base}/api/p2p-spread?hours={hours}")

    ohlcv_rows = normalize_ohlcv_rows(ohlcv_payload.get("data", []))
    p2p_rows = normalize_p2p_rows(p2p_payload.get("data", []))
    return ohlcv_rows, p2p_rows


# ---------------------------------------------------------------------------
# Source 2: Binance trực tiếp + tính indicator tại backend script
# ---------------------------------------------------------------------------


def fetch_binance_klines(hours: int) -> list[list[Any]]:
    limit = min(max(hours, 1), 1000)  # Binance spot klines limit tối đa thường là 1000.
    base = os.getenv("BINANCE_API_BASE", "https://api.binance.com").rstrip("/")
    url = f"{base}/api/v3/klines?symbol=BTCUSDT&interval=1h&limit={limit}"
    return fetch_json(url)


def klines_to_ohlcv_rows(klines: list[list[Any]]) -> list[dict[str, Any]]:
    base_rows: list[dict[str, Any]] = []
    for item in klines:
        base_rows.append(
            {
                "timestamp": iso_from_ms(item[0]),
                "open": float(item[1]),
                "high": float(item[2]),
                "low": float(item[3]),
                "close": float(item[4]),
                "volume": float(item[5]),
                "trades": int(item[8]),
            }
        )
    return add_indicators(base_rows)


def sma(values: list[float | None], period: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(values)):
        if i + 1 < period:
            out.append(None)
            continue
        window = [v for v in values[i + 1 - period : i + 1] if v is not None]
        out.append(sum(window) / period if len(window) == period else None)
    return out


def ema(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) < period:
        return out
    alpha = 2 / (period + 1)
    prev = sum(values[:period]) / period
    out[period - 1] = prev
    for i in range(period, len(values)):
        prev = values[i] * alpha + prev * (1 - alpha)
        out[i] = prev
    return out


def rolling_std(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(values)):
        if i + 1 < period:
            out.append(None)
            continue
        window = values[i + 1 - period : i + 1]
        mean = sum(window) / period
        variance = sum((x - mean) ** 2 for x in window) / period
        out.append(math.sqrt(variance))
    return out


def rsi(values: list[float], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return out
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(values)):
        diff = values[i] - values[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    rs = avg_gain / avg_loss if avg_loss != 0 else float("inf")
    out[period] = 100 - (100 / (1 + rs))
    for i in range(period + 1, len(values)):
        gain = gains[i - 1]
        loss = losses[i - 1]
        avg_gain = ((avg_gain * (period - 1)) + gain) / period
        avg_loss = ((avg_loss * (period - 1)) + loss) / period
        rs = avg_gain / avg_loss if avg_loss != 0 else float("inf")
        out[i] = 100 - (100 / (1 + rs))
    return out


def add_indicators(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    closes = [float(r["close"]) for r in rows]
    highs = [float(r["high"]) for r in rows]
    lows = [float(r["low"]) for r in rows]
    volumes = [float(r["volume"]) for r in rows]

    ema_12 = ema(closes, 12)
    ema_20 = ema(closes, 20)
    ema_26 = ema(closes, 26)
    ema_50 = ema(closes, 50)
    ema_200 = ema(closes, 200)
    macd_values: list[float | None] = []
    for a, b in zip(ema_12, ema_26):
        macd_values.append(a - b if a is not None and b is not None else None)

    # EMA signal chỉ tính từ đoạn MACD hợp lệ.
    macd_signal: list[float | None] = [None] * len(rows)
    valid_start = next((i for i, v in enumerate(macd_values) if v is not None), None)
    if valid_start is not None:
        valid_macd = [v for v in macd_values[valid_start:] if v is not None]
        valid_signal = ema(valid_macd, 9)
        for j, value in enumerate(valid_signal):
            macd_signal[valid_start + j] = value

    macd_hist = [
        (m - s if m is not None and s is not None else None)
        for m, s in zip(macd_values, macd_signal)
    ]

    bb_mid = sma([float(x) for x in closes], 20)
    bb_std = rolling_std(closes, 20)
    bb_upper = [m + 2 * sd if m is not None and sd is not None else None for m, sd in zip(bb_mid, bb_std)]
    bb_lower = [m - 2 * sd if m is not None and sd is not None else None for m, sd in zip(bb_mid, bb_std)]
    bb_width = [
        ((u - l) / m if m and u is not None and l is not None else None)
        for u, l, m in zip(bb_upper, bb_lower, bb_mid)
    ]

    rsi_14 = rsi(closes, 14)

    true_ranges: list[float] = []
    for i in range(len(rows)):
        if i == 0:
            true_ranges.append(highs[i] - lows[i])
        else:
            true_ranges.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1])))
    atr_14 = sma(true_ranges, 14)

    stoch_k: list[float | None] = []
    for i in range(len(rows)):
        if i + 1 < 14 or rsi_14[i] is None:
            stoch_k.append(None)
            continue
        window = [v for v in rsi_14[i + 1 - 14 : i + 1] if v is not None]
        if len(window) < 14 or max(window) == min(window):
            stoch_k.append(None)
        else:
            stoch_k.append((rsi_14[i] - min(window)) / (max(window) - min(window)) * 100)
    stoch_d = sma(stoch_k, 3)
    vol_ma_20 = sma(volumes, 20)

    for i, row in enumerate(rows):
        row.update(
            {
                "rsi_14": round_or_none(rsi_14[i], 2),
                "macd": round_or_none(macd_values[i], 2),
                "macd_signal": round_or_none(macd_signal[i], 2),
                "macd_hist": round_or_none(macd_hist[i], 2),
                "bb_upper": round_or_none(bb_upper[i], 2),
                "bb_mid": round_or_none(bb_mid[i], 2),
                "bb_lower": round_or_none(bb_lower[i], 2),
                "bb_width": round_or_none(bb_width[i], 6),
                "ema_20": round_or_none(ema_20[i], 2),
                "ema_50": round_or_none(ema_50[i], 2),
                "ema_200": round_or_none(ema_200[i], 2),
                "atr_14": round_or_none(atr_14[i], 2),
                "stoch_k": round_or_none(stoch_k[i], 2),
                "stoch_d": round_or_none(stoch_d[i], 2),
                "vol_ma_20": round_or_none(vol_ma_20[i], 4),
            }
        )
    return rows


def round_or_none(value: float | None, digits: int = 2) -> float | None:
    if value is None or math.isnan(value) or math.isinf(value):
        return None
    return round(float(value), digits)


def fetch_usd_vnd_rate() -> float:
    # Có thể thay bằng nguồn tỷ giá khác khi triển khai production.
    try:
        data = fetch_json("https://open.er-api.com/v6/latest/USD", timeout=15)
        rate = data.get("rates", {}).get("VND")
        if rate:
            return float(rate)
    except Exception:
        pass
    return float(os.getenv("FALLBACK_USD_VND_RATE", "26000"))


def fetch_binance_p2p_rows() -> list[dict[str, Any]]:
    if not env_bool("SYNC_P2P_FROM_BINANCE", True):
        return []

    url = os.getenv(
        "BINANCE_P2P_API_URL",
        "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
    )
    market_price = fetch_usd_vnd_rate()
    timestamp = now_utc_iso()
    rows: list[dict[str, Any]] = []

    for trade_type in ["BUY", "SELL"]:
        body = {
            "asset": "USDT",
            "fiat": "VND",
            "tradeType": trade_type,
            "page": 1,
            "rows": 10,
            "payTypes": [],
            "publisherType": None,
        }
        try:
            data = fetch_json(url, method="POST", json_body=body, timeout=20)
            prices = []
            for item in data.get("data", []):
                price = item.get("adv", {}).get("price")
                if price is not None:
                    prices.append(float(price))
            if not prices:
                continue
            p2p_price = sum(prices) / len(prices)
            spread_pct = (market_price - p2p_price) / market_price * 100
            rows.append(
                {
                    "timestamp": timestamp,
                    "asset": "USDT",
                    "fiat": "VND",
                    "trade_type": trade_type,
                    "p2p_price": round(p2p_price, 2),
                    "p2p_price_min": round(min(prices), 2),
                    "p2p_price_max": round(max(prices), 2),
                    "samples": len(prices),
                    "market_price": round(market_price, 2),
                    "spread_pct": round(spread_pct, 4),
                }
            )
        except Exception as exc:
            print(f"Không lấy được P2P {trade_type} từ Binance: {exc}")
    return rows


def fetch_from_binance(hours: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    klines = fetch_binance_klines(hours)
    ohlcv_rows = klines_to_ohlcv_rows(klines)
    p2p_rows = fetch_binance_p2p_rows()
    return ohlcv_rows, p2p_rows


# ---------------------------------------------------------------------------
# Normalize + upsert
# ---------------------------------------------------------------------------


def normalize_ohlcv_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = {
        "timestamp",
        "open",
        "high",
        "low",
        "close",
        "volume",
        "trades",
        "rsi_14",
        "macd",
        "macd_signal",
        "macd_hist",
        "bb_upper",
        "bb_mid",
        "bb_lower",
        "bb_width",
        "ema_20",
        "ema_50",
        "ema_200",
        "atr_14",
        "stoch_k",
        "stoch_d",
        "vol_ma_20",
    }
    normalized: list[dict[str, Any]] = []
    for row in rows:
        item = {key: row.get(key) for key in allowed if key in row}
        for key, value in list(item.items()):
            if key != "timestamp":
                item[key] = clean_number(value)
        if item.get("timestamp"):
            normalized.append(item)
    normalized.sort(key=lambda x: str(x["timestamp"]))
    return normalized


def normalize_p2p_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    allowed = {
        "timestamp",
        "asset",
        "fiat",
        "trade_type",
        "p2p_price",
        "p2p_price_min",
        "p2p_price_max",
        "samples",
        "market_price",
        "spread_pct",
    }
    normalized: list[dict[str, Any]] = []
    for row in rows:
        item = {key: row.get(key) for key in allowed if key in row}
        if item.get("trade_type") not in {"BUY", "SELL"}:
            continue
        for key, value in list(item.items()):
            if key not in {"timestamp", "asset", "fiat", "trade_type"}:
                item[key] = clean_number(value)
        item.setdefault("asset", "USDT")
        item.setdefault("fiat", "VND")
        if item.get("timestamp"):
            normalized.append(item)
    normalized.sort(key=lambda x: str(x["timestamp"]), reverse=True)
    return normalized


def upsert_rows(table: str, rows: list[dict[str, Any]], on_conflict: str) -> int:
    if not rows:
        return 0
    sb = get_supabase_client()
    total = 0
    for batch in chunks(rows):
        sb.table(table).upsert(batch, on_conflict=on_conflict).execute()
        total += len(batch)
    return total


def main():
    hours = env_int("SYNC_HOURS", 720)
    source = os.getenv("SYNC_SOURCE", "public_api").strip().lower()

    print(f"Sync source: {source}")
    print(f"Sync hours : {hours}")

    if source == "binance":
        ohlcv_rows, p2p_rows = fetch_from_binance(hours)
        # Nếu P2P Binance lỗi, thử lấy P2P từ public API để demo vẫn có số liệu.
        if not p2p_rows and env_bool("SYNC_P2P_PUBLIC_FALLBACK", True):
            try:
                _, p2p_rows = fetch_from_public_api(min(hours, 168))
            except Exception as exc:
                print(f"P2P public fallback lỗi: {exc}")
    elif source in {"public_api", "render"}:
        ohlcv_rows, p2p_rows = fetch_from_public_api(hours)
    else:
        print("SYNC_SOURCE chỉ hỗ trợ: public_api hoặc binance", file=sys.stderr)
        sys.exit(1)

    print(f"Fetched OHLCV rows: {len(ohlcv_rows)}")
    print(f"Fetched P2P rows  : {len(p2p_rows)}")

    ohlcv_count = upsert_rows(OHLCV_TABLE, ohlcv_rows, "timestamp")
    p2p_count = upsert_rows(P2P_TABLE, p2p_rows, "timestamp,trade_type")

    latest_ts = ohlcv_rows[-1].get("timestamp") if ohlcv_rows else None
    print(f"Upserted OHLCV rows: {ohlcv_count}")
    print(f"Upserted P2P rows  : {p2p_count}")
    print(f"Latest OHLCV timestamp: {latest_ts}")
    print("Done.")


if __name__ == "__main__":
    main()
