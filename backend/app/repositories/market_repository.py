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

# ---------------------------------------------------------------------------
# User-owned feature repositories
# ---------------------------------------------------------------------------

DEMO_TRADES_TABLE = "demo_trades"
ALERT_RULES_TABLE = "alert_rules"
NOTIFICATION_LOG_TABLE = "notification_log"
ORDERS_TABLE = "orders"
SUBSCRIPTIONS_TABLE = "subscriptions"


def insert_ai_history_safe(row: dict[str, Any]) -> None:
    """Insert AI history; if DB not migrated with user_id yet, retry without it."""
    sb = _client()
    if sb is None:
        return
    try:
        sb.table(AI_TABLE).insert(row).execute()
    except Exception:
        row = dict(row)
        row.pop("user_id", None)
        sb.table(AI_TABLE).insert(row).execute()


def get_ai_history_for_user(user_id: str, limit: int = 24) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    try:
        res = (
            sb.table(AI_TABLE)
            .select("id,created_at,question,answer,verdict,confidence,reasons,risks,model_name,user_id")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


def create_demo_trade(row: dict[str, Any]) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(DEMO_TRADES_TABLE).insert(row).execute()
    return res.data[0] if res.data else None


def list_demo_trades(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    res = (
        sb.table(DEMO_TRADES_TABLE)
        .select("id,user_id,side,amount_vnd,amount_usdt,price_source,applied_price,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def list_alert_rules(user_id: str) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    res = (
        sb.table(ALERT_RULES_TABLE)
        .select("id,user_id,metric,operator,threshold,active,last_triggered_at,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def create_alert_rule(row: dict[str, Any]) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(ALERT_RULES_TABLE).insert(row).execute()
    return res.data[0] if res.data else None


def update_alert_rule(rule_id: str, user_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = (
        sb.table(ALERT_RULES_TABLE)
        .update(updates)
        .eq("id", rule_id)
        .eq("user_id", user_id)
        .execute()
    )
    return res.data[0] if res.data else None


def delete_alert_rule(rule_id: str, user_id: str) -> bool:
    sb = _client()
    if sb is None:
        return False
    res = sb.table(ALERT_RULES_TABLE).delete().eq("id", rule_id).eq("user_id", user_id).execute()
    return bool(res.data)


def count_active_alerts(user_id: str) -> int:
    return len([r for r in list_alert_rules(user_id) if r.get("active") is not False])


def create_order(row: dict[str, Any]) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(ORDERS_TABLE).insert(row).execute()
    return res.data[0] if res.data else None


def get_order_by_txn_ref(txn_ref: str) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(ORDERS_TABLE).select("*").eq("vnp_txn_ref", txn_ref).limit(1).execute()
    return res.data[0] if res.data else None


def update_order_status(txn_ref: str, status: str, paid_at: str | None = None) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    payload: dict[str, Any] = {"status": status}
    if paid_at:
        payload["paid_at"] = paid_at
    res = sb.table(ORDERS_TABLE).update(payload).eq("vnp_txn_ref", txn_ref).execute()
    return res.data[0] if res.data else None


def upsert_subscription(row: dict[str, Any]) -> None:
    sb = _client()
    if sb is None:
        return
    sb.table(SUBSCRIPTIONS_TABLE).upsert(row, on_conflict="user_id,plan_id").execute()
