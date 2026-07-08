from typing import Any

from app.supabase_client import get_supabase

OHLCV_TABLE = "btcusdt_ohlcv_1h"
P2P_TABLE = "p2p_spread_history"
AI_TABLE = "ai_analysis_history"


OHLCV_FIELDS = (
    "timestamp,open,high,low,close,volume,trades,rsi_14,macd,macd_signal,macd_hist,"
    "bb_upper,bb_mid,bb_lower,bb_width,ema_20,ema_50,ema_200,atr_14,stoch_k,stoch_d,vol_ma_20"
)

P2P_FIELDS = (
    "timestamp,asset,fiat,trade_type,p2p_price,p2p_price_min,p2p_price_max,samples,market_price,spread_pct"
)


def _client():
    return get_supabase()


def get_latest_ohlcv() -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(OHLCV_TABLE).select(OHLCV_FIELDS).order("timestamp", desc=True).limit(1).execute()
    return res.data[0] if res.data else None


def get_ohlcv(hours: int) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    res = (
        sb.table(OHLCV_TABLE)
        .select(OHLCV_FIELDS)
        .order("timestamp", desc=True)
        .limit(hours)
        .execute()
    )
    return list(reversed(res.data or []))


def get_p2p_spread(hours: int) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    # Mỗi giờ có 2 dòng BUY/SELL, nên lấy hours*2 bản ghi mới nhất.
    res = (
        sb.table(P2P_TABLE)
        .select(P2P_FIELDS)
        .order("timestamp", desc=True)
        .limit(hours * 2)
        .execute()
    )
    return res.data or []


def insert_ai_history(row: dict[str, Any]) -> None:
    sb = _client()
    if sb is None:
        return
    sb.table(AI_TABLE).insert(row).execute()


def get_ai_history(limit: int = 24) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    res = (
        sb.table(AI_TABLE)
        .select("id,created_at,question,answer,verdict,confidence,reasons,risks,model_name")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def upsert_ohlcv(rows: list[dict[str, Any]]) -> int:
    sb = _client()
    if sb is None or not rows:
        return 0
    sb.table(OHLCV_TABLE).upsert(rows, on_conflict="timestamp").execute()
    return len(rows)


def upsert_p2p(rows: list[dict[str, Any]]) -> int:
    sb = _client()
    if sb is None or not rows:
        return 0
    sb.table(P2P_TABLE).upsert(rows, on_conflict="timestamp,trade_type").execute()
    return len(rows)
