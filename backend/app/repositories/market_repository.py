from typing import Any
from copy import deepcopy
from threading import RLock
from time import monotonic

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


# Bộ nhớ đệm ngắn hạn ở backend giúp các trang dùng chung dữ liệu thị trường
# không lặp lại nhiều truy vấn Supabase trong cùng một phút. Cache chỉ chứa
# dữ liệu công khai, không chứa token hoặc dữ liệu tài khoản người dùng.
_MARKET_CACHE: dict[str, tuple[float, Any]] = {}
_MARKET_CACHE_LOCK = RLock()


def _cache_get(key: str, ttl_seconds: float) -> Any | None:
    with _MARKET_CACHE_LOCK:
        cached = _MARKET_CACHE.get(key)
        if not cached:
            return None
        created_at, value = cached
        if monotonic() - created_at > ttl_seconds:
            _MARKET_CACHE.pop(key, None)
            return None
        return deepcopy(value)


def _cache_set(key: str, value: Any) -> Any:
    with _MARKET_CACHE_LOCK:
        _MARKET_CACHE[key] = (monotonic(), deepcopy(value))
    return value


def clear_market_cache() -> None:
    with _MARKET_CACHE_LOCK:
        _MARKET_CACHE.clear()


def _client():
    return get_supabase()


def get_latest_ohlcv() -> dict[str, Any] | None:
    cached = _cache_get("ohlcv:latest", 25)
    if cached is not None:
        return cached
    sb = _client()
    if sb is None:
        return None
    res = sb.table(OHLCV_TABLE).select(OHLCV_FIELDS).order("timestamp", desc=True).limit(1).execute()
    value = res.data[0] if res.data else None
    return _cache_set("ohlcv:latest", value) if value else None


def get_ohlcv(hours: int) -> list[dict[str, Any]]:
    hours = max(1, min(int(hours), 8760))
    cache_key = f"ohlcv:{hours}"
    cached = _cache_get(cache_key, 75)
    if cached is not None:
        return cached
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
    rows = list(reversed(res.data or []))
    if rows:
        _cache_set(cache_key, rows)
        _cache_set("ohlcv:latest", rows[-1])
    return rows


def get_p2p_spread(hours: int) -> list[dict[str, Any]]:
    hours = max(1, min(int(hours), 8760))
    cache_key = f"p2p:{hours}"
    cached = _cache_get(cache_key, 75)
    if cached is not None:
        return cached
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
    rows = res.data or []
    if rows:
        _cache_set(cache_key, rows)
    return rows


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


def get_active_subscription(user_id: str) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = (
        sb.table(SUBSCRIPTIONS_TABLE)
        .select("user_id,plan_id,active,expires_at")
        .eq("user_id", user_id)
        .eq("active", True)
        .execute()
    )
    return res.data[0] if res.data else None


def cancel_user_subscriptions(user_id: str) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    res = (
        sb.table(SUBSCRIPTIONS_TABLE)
        .update({"active": False})
        .eq("user_id", user_id)
        .execute()
    )
    return res.data or []

# ---------------------------------------------------------------------------
# Wallet demo repositories: QR top-up + e-wallet balance for course sandbox
# ---------------------------------------------------------------------------

WALLETS_TABLE = "wallets"
WALLET_TOPUPS_TABLE = "wallet_topups"
WALLET_TRANSACTIONS_TABLE = "wallet_transactions"


def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def get_wallet_for_user(user_id: str) -> dict[str, Any]:
    sb = _client()
    if sb is None:
        return {"user_id": user_id, "balance_vnd": 0, "balance_usdt_demo": 0}
    res = sb.table(WALLETS_TABLE).select("*").eq("user_id", user_id).limit(1).execute()
    if res.data:
        return res.data[0]
    created = sb.table(WALLETS_TABLE).insert({"user_id": user_id, "balance_vnd": 0, "balance_usdt_demo": 0}).execute()
    return created.data[0] if created.data else {"user_id": user_id, "balance_vnd": 0, "balance_usdt_demo": 0}


def create_wallet_topup(row: dict[str, Any], upsert: bool = False) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    if upsert:
        res = sb.table(WALLET_TOPUPS_TABLE).upsert(row, on_conflict="vnp_txn_ref").execute()
    else:
        res = sb.table(WALLET_TOPUPS_TABLE).insert(row).execute()
    return res.data[0] if res.data else None


def get_wallet_topup_by_txn_ref(txn_ref: str) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(WALLET_TOPUPS_TABLE).select("*").eq("vnp_txn_ref", txn_ref).limit(1).execute()
    return res.data[0] if res.data else None


def list_wallet_transactions(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    res = (
        sb.table(WALLET_TRANSACTIONS_TABLE)
        .select("id,user_id,type,amount_vnd,balance_after_vnd,description,ref_id,created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


def _insert_wallet_transaction(row: dict[str, Any]) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(WALLET_TRANSACTIONS_TABLE).insert(row).execute()
    return res.data[0] if res.data else None


def mark_wallet_topup_success(txn_ref: str) -> dict[str, Any] | None:
    """Idempotently mark a top-up successful and credit the demo wallet."""
    sb = _client()
    if sb is None:
        return None
    topup = get_wallet_topup_by_txn_ref(txn_ref)
    if not topup:
        return None
    if topup.get("status") == "success":
        return topup

    user_id = str(topup["user_id"])
    amount = _num(topup.get("amount_vnd"))
    wallet = get_wallet_for_user(user_id)
    new_balance = _num(wallet.get("balance_vnd")) + amount

    paid_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    sb.table(WALLETS_TABLE).update({"balance_vnd": new_balance, "updated_at": paid_at}).eq("user_id", user_id).execute()
    updated = sb.table(WALLET_TOPUPS_TABLE).update({"status": "success", "paid_at": paid_at}).eq("vnp_txn_ref", txn_ref).execute()
    _insert_wallet_transaction({
        "user_id": user_id,
        "type": "topup",
        "amount_vnd": amount,
        "balance_after_vnd": new_balance,
        "description": "Nạp ví demo qua VNPay Sandbox QR",
        "ref_id": txn_ref,
    })
    return updated.data[0] if updated.data else topup


def mark_wallet_topup_failed(txn_ref: str) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(WALLET_TOPUPS_TABLE).update({"status": "failed"}).eq("vnp_txn_ref", txn_ref).execute()
    return res.data[0] if res.data else None


def debit_wallet_for_payment(user_id: str, amount_vnd: int | float, description: str, ref_id: str | None = None) -> dict[str, Any]:
    """Demo-only debit helper. Raises ValueError if balance is insufficient."""
    sb = _client()
    if sb is None:
        raise ValueError("Supabase chưa được cấu hình")
    wallet = get_wallet_for_user(user_id)
    current = _num(wallet.get("balance_vnd"))
    amount = _num(amount_vnd)
    if current < amount:
        raise ValueError("Số dư ví demo không đủ")
    new_balance = current - amount
    updated_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    sb.table(WALLETS_TABLE).update({"balance_vnd": new_balance, "updated_at": updated_at}).eq("user_id", user_id).execute()
    tx = _insert_wallet_transaction({
        "user_id": user_id,
        "type": "payment",
        "amount_vnd": -amount,
        "balance_after_vnd": new_balance,
        "description": description,
        "ref_id": ref_id,
    })
    return {"wallet": get_wallet_for_user(user_id), "transaction": tx}


def credit_wallet_balance(user_id: str, amount_vnd: int | float, description: str, ref_id: str | None = None) -> dict[str, Any]:
    """Credit VND back to the demo wallet, for example after a SELL trade."""
    sb = _client()
    if sb is None:
        raise ValueError("Supabase chưa được cấu hình")
    wallet = get_wallet_for_user(user_id)
    current = _num(wallet.get("balance_vnd"))
    amount = _num(amount_vnd)
    new_balance = current + amount
    updated_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    sb.table(WALLETS_TABLE).update({"balance_vnd": new_balance, "updated_at": updated_at}).eq("user_id", user_id).execute()
    tx = _insert_wallet_transaction({
        "user_id": user_id,
        "type": "trade_credit",
        "amount_vnd": amount,
        "balance_after_vnd": new_balance,
        "description": description,
        "ref_id": ref_id,
    })
    return {"wallet": get_wallet_for_user(user_id), "transaction": tx}


def summarize_demo_trades(user_id: str, limit: int = 500, rows: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Summarise the virtual BTC portfolio from recorded demo trades.

    The legacy `amount_usdt` field is reused as the simulated BTC quantity in the
    trading-terminal UI. This keeps the database schema unchanged while still
    allowing a realistic wallet + portfolio flow for classroom demos.
    """
    source_rows = rows if rows is not None else list_demo_trades(user_id, limit)
    rows = list(reversed(source_rows))
    position_btc = 0.0
    cost_basis_vnd = 0.0
    realized_pnl_vnd = 0.0
    total_buy_vnd = 0.0
    total_sell_vnd = 0.0
    buys = 0
    sells = 0

    for row in rows:
        side = str(row.get("side") or "").upper()
        qty = _num(row.get("amount_usdt"))
        gross_vnd = _num(row.get("amount_vnd"))
        if qty <= 0 or gross_vnd <= 0:
            continue

        if side == "BUY":
            position_btc += qty
            cost_basis_vnd += gross_vnd
            total_buy_vnd += gross_vnd
            buys += 1
            continue

        if side == "SELL":
            sells += 1
            total_sell_vnd += gross_vnd
            if position_btc > 0:
                used_qty = min(qty, position_btc)
                avg_cost = cost_basis_vnd / position_btc if position_btc > 0 else 0.0
                released_cost = avg_cost * used_qty
                realized_pnl_vnd += gross_vnd - released_cost
                position_btc -= used_qty
                cost_basis_vnd = max(0.0, cost_basis_vnd - released_cost)

    avg_entry_vnd = cost_basis_vnd / position_btc if position_btc > 0 else 0.0
    return {
        "position_btc": round(position_btc, 8),
        "avg_entry_vnd": round(avg_entry_vnd, 2),
        "cost_basis_vnd": round(cost_basis_vnd, 2),
        "realized_pnl_vnd": round(realized_pnl_vnd, 2),
        "total_buy_vnd": round(total_buy_vnd, 2),
        "total_sell_vnd": round(total_sell_vnd, 2),
        "buys": buys,
        "sells": sells,
        "trades_count": len(rows),
    }


def execute_demo_trade(
    user_id: str,
    side: str,
    amount_vnd: int | float,
    amount_asset: int | float,
    price_source: str,
    applied_price: int | float | None = None,
) -> dict[str, Any] | None:
    side_norm = str(side or "").upper().strip()
    if side_norm not in {"BUY", "SELL"}:
        raise ValueError("Chiều giao dịch phải là BUY hoặc SELL")

    gross_vnd = _num(amount_vnd)
    amount_btc = _num(amount_asset)
    if gross_vnd <= 0 or amount_btc <= 0:
        raise ValueError("Giá trị giao dịch mô phỏng không hợp lệ")

    portfolio_before = summarize_demo_trades(user_id)

    if side_norm == "BUY":
        debit_wallet_for_payment(user_id, gross_vnd, f"Mua BTC demo · {amount_btc:.8f} BTC", None)
    else:
        if _num(portfolio_before.get("position_btc")) + 1e-12 < amount_btc:
            raise ValueError("Số dư BTC demo không đủ để thực hiện lệnh bán")
        credit_wallet_balance(user_id, gross_vnd, f"Bán BTC demo · {amount_btc:.8f} BTC", None)

    created = create_demo_trade({
        "user_id": user_id,
        "side": side_norm.lower(),
        "amount_vnd": gross_vnd,
        "amount_usdt": amount_btc,
        "price_source": price_source,
        "applied_price": _num(applied_price),
    })
    if not created:
        return None

    return {
        **created,
        "wallet": get_wallet_for_user(user_id),
        "portfolio": summarize_demo_trades(user_id),
    }
