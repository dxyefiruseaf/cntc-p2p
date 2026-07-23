from typing import Any, Callable, TypeVar
import logging
from threading import RLock
from time import sleep

import httpx

from app.cache import TTLCache
from app.supabase_client import get_supabase, reset_supabase_client

OHLCV_TABLE = "btcusdt_ohlcv_1h"
P2P_TABLE = "p2p_spread_history"
AI_TABLE = "ai_analysis_history"

# Shared cache prevents the ticker, Dashboard, Decision Hub and charts from
# repeating the same Supabase reads within a short window. The cache is per
# backend worker and is invalidated immediately after sync/upsert operations.
_MARKET_CACHE = TTLCache(max_entries=512)
LATEST_CACHE_SECONDS = 15
SERIES_CACHE_SECONDS = 45
P2P_CACHE_SECONDS = 45

logger = logging.getLogger(__name__)
T = TypeVar("T")
_LAST_GOOD_LOCK = RLock()
_LAST_GOOD_MARKET_READS: dict[str, Any] = {}
_TRANSIENT_READ_ERRORS = (
    httpx.ReadError,
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    httpx.RemoteProtocolError,
    OSError,
)


def _remember_last_good(key: str, value: T) -> T:
    with _LAST_GOOD_LOCK:
        _LAST_GOOD_MARKET_READS[key] = value
    return value


def _last_good(key: str, default: T) -> T:
    with _LAST_GOOD_LOCK:
        value = _LAST_GOOD_MARKET_READS.get(key, default)
    return value


def _safe_market_read(
    key: str,
    factory: Callable[[], T],
    default: T,
    *,
    attempts: int = 2,
) -> T:
    """Run a Supabase market read without allowing a transport glitch to 500 APIs.

    A failed first attempt resets the cached Supabase client and retries once.
    If Supabase is still unavailable, the last successful value is returned.
    The function intentionally applies only to idempotent market reads; writes
    still surface errors so financial/demo state cannot be silently corrupted.
    """
    last_error: Exception | None = None
    for attempt in range(max(1, attempts)):
        try:
            value = factory()
            return _remember_last_good(key, value)
        except _TRANSIENT_READ_ERRORS as exc:
            last_error = exc
            logger.warning(
                "Transient Supabase read failure for %s (attempt %s/%s): %s",
                key,
                attempt + 1,
                attempts,
                exc,
            )
            reset_supabase_client()
            if attempt + 1 < attempts:
                sleep(0.12 * (attempt + 1))
        except Exception as exc:
            # PostgREST can wrap httpx transport errors in a generic exception.
            # Market/read endpoints should degrade gracefully instead of making
            # the entire Admin dashboard unavailable.
            last_error = exc
            logger.exception("Supabase market read failed for %s", key)
            reset_supabase_client()
            break

    fallback = _last_good(key, default)
    logger.warning(
        "Serving last-known-good/default market data for %s after error: %s",
        key,
        last_error,
    )
    return fallback


OHLCV_FIELDS = (
    "timestamp,open,high,low,close,volume,trades,rsi_14,macd,macd_signal,macd_hist,"
    "bb_upper,bb_mid,bb_lower,bb_width,ema_20,ema_50,ema_200,atr_14,stoch_k,stoch_d,vol_ma_20"
)

P2P_FIELDS = (
    "timestamp,asset,fiat,trade_type,p2p_price,p2p_price_min,p2p_price_max,samples,market_price,spread_pct"
)


def _client():
    return get_supabase()


def _fetch_latest_ohlcv() -> dict[str, Any] | None:
    def query() -> dict[str, Any] | None:
        sb = _client()
        if sb is None:
            return None
        res = sb.table(OHLCV_TABLE).select(OHLCV_FIELDS).order("timestamp", desc=True).limit(1).execute()
        return res.data[0] if res.data else None

    return _safe_market_read("latest", query, None)


def get_latest_ohlcv() -> dict[str, Any] | None:
    return _MARKET_CACHE.get_or_set("market:latest", LATEST_CACHE_SECONDS, _fetch_latest_ohlcv)


def _fetch_ohlcv(hours: int) -> list[dict[str, Any]]:
    safe_hours = max(1, min(int(hours), 8760))

    def query() -> list[dict[str, Any]]:
        sb = _client()
        if sb is None:
            return []
        res = (
            sb.table(OHLCV_TABLE)
            .select(OHLCV_FIELDS)
            .order("timestamp", desc=True)
            .limit(safe_hours)
            .execute()
        )
        return list(reversed(res.data or []))

    return _safe_market_read(f"ohlcv:{safe_hours}", query, [])


def get_ohlcv(hours: int) -> list[dict[str, Any]]:
    safe_hours = max(1, min(int(hours), 8760))
    return _MARKET_CACHE.get_or_set(
        f"market:ohlcv:{safe_hours}",
        SERIES_CACHE_SECONDS,
        lambda: _fetch_ohlcv(safe_hours),
    )


def _fetch_p2p_spread(hours: int) -> list[dict[str, Any]]:
    safe_hours = max(1, min(int(hours), 8760))

    def query() -> list[dict[str, Any]]:
        sb = _client()
        if sb is None:
            return []
        # Mỗi giờ có 2 dòng BUY/SELL, nên lấy hours*2 bản ghi mới nhất.
        res = (
            sb.table(P2P_TABLE)
            .select(P2P_FIELDS)
            .order("timestamp", desc=True)
            .limit(safe_hours * 2)
            .execute()
        )
        return res.data or []

    return _safe_market_read(f"p2p:{safe_hours}", query, [])


def get_p2p_spread(hours: int) -> list[dict[str, Any]]:
    safe_hours = max(1, min(int(hours), 8760))
    return _MARKET_CACHE.get_or_set(
        f"market:p2p:{safe_hours}",
        P2P_CACHE_SECONDS,
        lambda: _fetch_p2p_spread(safe_hours),
    )


def invalidate_market_cache() -> None:
    _MARKET_CACHE.delete_prefix("market:")


def insert_ai_history(row: dict[str, Any]) -> None:
    sb = _client()
    if sb is None:
        return
    sb.table(AI_TABLE).insert(row).execute()


def get_ai_history(
    limit: int = 24,
    *,
    before_created_at: str | None = None,
) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    safe_limit = max(1, min(int(limit), 100))
    query = sb.table(AI_TABLE).select(
        "id,created_at,question,answer,verdict,confidence,reasons,risks,model_name"
    )
    if before_created_at:
        query = query.lt("created_at", before_created_at)
    res = query.order("created_at", desc=True).order("id", desc=True).limit(safe_limit).execute()
    return res.data or []


def upsert_ohlcv(rows: list[dict[str, Any]]) -> int:
    sb = _client()
    if sb is None or not rows:
        return 0
    # Keep each PostgREST request bounded. Large 8,760-row payloads can exceed
    # gateway limits and hold a connection for too long on free hosting.
    chunk_size = 500
    for start in range(0, len(rows), chunk_size):
        sb.table(OHLCV_TABLE).upsert(rows[start:start + chunk_size], on_conflict="timestamp").execute()
    invalidate_market_cache()
    return len(rows)


def upsert_p2p(rows: list[dict[str, Any]]) -> int:
    sb = _client()
    if sb is None or not rows:
        return 0
    chunk_size = 500
    for start in range(0, len(rows), chunk_size):
        sb.table(P2P_TABLE).upsert(rows[start:start + chunk_size], on_conflict="timestamp,trade_type").execute()
    invalidate_market_cache()
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


def get_ai_history_for_user(
    user_id: str,
    limit: int = 24,
    *,
    before_created_at: str | None = None,
) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    try:
        safe_limit = max(1, min(int(limit), 100))
        query = (
            sb.table(AI_TABLE)
            .select("id,created_at,question,answer,verdict,confidence,reasons,risks,model_name,user_id")
            .eq("user_id", user_id)
        )
        if before_created_at:
            query = query.lt("created_at", before_created_at)
        res = query.order("created_at", desc=True).order("id", desc=True).limit(safe_limit).execute()
        return res.data or []
    except Exception:
        return []


def create_demo_trade(row: dict[str, Any]) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(DEMO_TRADES_TABLE).insert(row).execute()
    return res.data[0] if res.data else None


def delete_demo_trade(trade_id: str, user_id: str) -> bool:
    """Best-effort rollback helper when wallet settlement fails."""
    sb = _client()
    if sb is None:
        return False
    try:
        res = (
            sb.table(DEMO_TRADES_TABLE)
            .delete()
            .eq("id", trade_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def list_demo_trades(
    user_id: str,
    limit: int = 20,
    *,
    before_created_at: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    side: str | None = None,
    search: str | None = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    safe_limit = max(1, min(int(limit), 100))
    allowed_sort = {"created_at", "amount_vnd", "amount_usdt", "applied_price"}
    order_field = sort_by if sort_by in allowed_sort else "created_at"
    descending = str(sort_order).lower() != "asc"
    query = (
        sb.table(DEMO_TRADES_TABLE)
        .select("id,user_id,side,amount_vnd,amount_usdt,price_source,applied_price,created_at")
        .eq("user_id", user_id)
    )
    if before_created_at and order_field == "created_at":
        query = query.lt("created_at", before_created_at) if descending else query.gt("created_at", before_created_at)
    if date_from:
        query = query.gte("created_at", date_from)
    if date_to:
        query = query.lte("created_at", date_to)
    normalized_side = str(side or "").lower()
    if normalized_side in {"buy", "sell"}:
        query = query.eq("side", normalized_side)
    needle = str(search or "").strip().lower().replace(",", " ")
    if needle:
        query = query.or_(f"side.ilike.%{needle}%,price_source.ilike.%{needle}%")
    res = (
        query.order(order_field, desc=descending)
        .order("id", desc=descending)
        .limit(safe_limit)
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
    sb = _client()
    if sb is None:
        return 0
    res = (
        sb.table(ALERT_RULES_TABLE)
        .select("id", count="exact")
        .eq("user_id", user_id)
        .eq("active", True)
        .limit(1)
        .execute()
    )
    return int(res.count or 0)


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
    res = sb.table(ORDERS_TABLE).select("id,user_id,plan_id,amount_vnd,vnp_txn_ref,status,created_at,paid_at").eq("vnp_txn_ref", txn_ref).limit(1).execute()
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
        .limit(1)
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
    res = sb.table(WALLETS_TABLE).select("user_id,balance_vnd,balance_usdt_demo,created_at,updated_at").eq("user_id", user_id).limit(1).execute()
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
    res = sb.table(WALLET_TOPUPS_TABLE).select("id,user_id,amount_vnd,vnp_txn_ref,status,payment_url,created_at,paid_at").eq("vnp_txn_ref", txn_ref).limit(1).execute()
    return res.data[0] if res.data else None


def get_wallet_snapshot(
    user_id: str,
    limit: int = 20,
    *,
    before_created_at: str | None = None,
) -> dict[str, Any]:
    sb = _client()
    if sb is not None:
        try:
            data = sb.rpc("wallet_snapshot", {
                "p_user_id": user_id,
                "p_limit": max(1, min(int(limit), 100)),
                "p_before": before_created_at,
            }).execute().data
            if isinstance(data, dict):
                return data
            if isinstance(data, list) and data and isinstance(data[0], dict):
                return data[0]
        except Exception:
            pass
    wallet = get_wallet_for_user(user_id)
    transactions = list_wallet_transactions(
        user_id,
        limit,
        before_created_at=before_created_at,
    )
    return {"wallet": wallet, "transactions": transactions}


def get_trade_terminal_account_snapshot(user_id: str, limit: int = 20) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    try:
        data = sb.rpc("trade_terminal_account_snapshot", {
            "p_user_id": user_id,
            "p_limit": max(1, min(int(limit), 50)),
        }).execute().data
        if isinstance(data, dict):
            return data
        if isinstance(data, list) and data and isinstance(data[0], dict):
            return data[0]
    except Exception:
        return None
    return None


def list_wallet_transactions(
    user_id: str,
    limit: int = 20,
    *,
    before_created_at: str | None = None,
) -> list[dict[str, Any]]:
    sb = _client()
    if sb is None:
        return []
    safe_limit = max(1, min(int(limit), 100))
    query = (
        sb.table(WALLET_TRANSACTIONS_TABLE)
        .select("id,user_id,type,amount_vnd,balance_after_vnd,description,ref_id,created_at")
        .eq("user_id", user_id)
    )
    if before_created_at:
        query = query.lt("created_at", before_created_at)
    res = query.order("created_at", desc=True).order("id", desc=True).limit(safe_limit).execute()
    return res.data or []


def _insert_wallet_transaction(row: dict[str, Any]) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    res = sb.table(WALLET_TRANSACTIONS_TABLE).insert(row).execute()
    return res.data[0] if res.data else None


def mark_wallet_topup_success(txn_ref: str) -> dict[str, Any] | None:
    """Idempotently mark a top-up successful and credit the demo wallet.

    New databases use one PostgreSQL transaction through RPC. The existing
    multi-request implementation remains as a backward-compatible fallback.
    """
    sb = _client()
    if sb is None:
        return None
    try:
        rpc_data = sb.rpc("credit_wallet_topup_atomic", {"p_txn_ref": txn_ref}).execute().data
        if isinstance(rpc_data, dict):
            return rpc_data
        if isinstance(rpc_data, list) and rpc_data:
            return rpc_data[0]
    except Exception:
        pass
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
    tx = None
    try:
        tx = _insert_wallet_transaction({
            "user_id": user_id,
            "type": "payment",
            "amount_vnd": -amount,
            "balance_after_vnd": new_balance,
            "description": description,
            "ref_id": ref_id,
        })
    except Exception:
        # The wallet balance is the source of truth for this demo flow. A log
        # insert must not turn an otherwise successful trade into HTTP 500.
        tx = None
    wallet_after = {**wallet, "balance_vnd": new_balance, "updated_at": updated_at}
    return {"wallet": wallet_after, "transaction": tx}


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
    tx = None
    try:
        tx = _insert_wallet_transaction({
            "user_id": user_id,
            # Existing databases only allow topup/payment/refund/adjustment.
            # Use adjustment for SELL proceeds and keep the exact meaning in
            # description instead of violating the CHECK constraint.
            "type": "adjustment",
            "amount_vnd": amount,
            "balance_after_vnd": new_balance,
            "description": description,
            "ref_id": ref_id,
        })
    except Exception:
        tx = None
    wallet_after = {**wallet, "balance_vnd": new_balance, "updated_at": updated_at}
    return {"wallet": wallet_after, "transaction": tx}


def get_demo_portfolio(user_id: str) -> dict[str, Any] | None:
    sb = _client()
    if sb is None:
        return None
    try:
        res = (
            sb.table("demo_portfolios")
            .select("position_btc,avg_entry_vnd,cost_basis_vnd,realized_pnl_vnd,total_buy_vnd,total_sell_vnd,buys,sells,trades_count,updated_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception:
        return None


def summarize_demo_trade_rows(rows: list[dict[str, Any]]) -> dict[str, Any]:
    position_btc = 0.0
    cost_basis_vnd = 0.0
    realized_pnl_vnd = 0.0
    total_buy_vnd = 0.0
    total_sell_vnd = 0.0
    buys = 0
    sells = 0
    ordered_rows = list(reversed(rows))
    for row in ordered_rows:
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
        elif side == "SELL":
            sells += 1
            total_sell_vnd += gross_vnd
            if position_btc > 0:
                used_qty = min(qty, position_btc)
                avg_cost = cost_basis_vnd / position_btc
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
        "trades_count": len(ordered_rows),
    }


def summarize_demo_trades(user_id: str, limit: int = 500) -> dict[str, Any]:
    """Return an O(1) portfolio snapshot when the performance migration exists."""
    snapshot = get_demo_portfolio(user_id)
    if snapshot:
        return {key: snapshot.get(key, 0) for key in (
            "position_btc", "avg_entry_vnd", "cost_basis_vnd", "realized_pnl_vnd",
            "total_buy_vnd", "total_sell_vnd", "buys", "sells", "trades_count"
        )}
    rows = list_demo_trades(user_id, min(max(1, int(limit)), 500))
    return summarize_demo_trade_rows(rows)


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

    sb = _client()
    if sb is not None:
        try:
            rpc_data = sb.rpc("execute_demo_trade_atomic", {
                "p_user_id": user_id,
                "p_side": side_norm.lower(),
                "p_amount_vnd": gross_vnd,
                "p_amount_btc": amount_btc,
                "p_price_source": price_source,
                "p_applied_price": _num(applied_price) if applied_price is not None else None,
            }).execute().data
            if isinstance(rpc_data, dict):
                return rpc_data
            if isinstance(rpc_data, list) and rpc_data:
                return rpc_data[0]
        except Exception as exc:
            # Raise business validation errors from the database; only fall back
            # when the migration/RPC is not installed yet.
            message = str(exc)
            business_errors = ("Số dư ví demo không đủ", "Số dư BTC demo không đủ", "Chiều giao dịch", "Giá trị giao dịch")
            if any(item in message for item in business_errors):
                raise ValueError(message) from exc

    portfolio_before = summarize_demo_trades(user_id)
    wallet_before = get_wallet_for_user(user_id)

    if side_norm == "BUY" and _num(wallet_before.get("balance_vnd")) + 1e-9 < gross_vnd:
        raise ValueError("Số dư ví demo không đủ")
    if side_norm == "SELL" and _num(portfolio_before.get("position_btc")) + 1e-12 < amount_btc:
        raise ValueError("Số dư BTC demo không đủ để thực hiện lệnh bán")

    created = create_demo_trade({
        "user_id": user_id,
        "side": side_norm.lower(),
        "amount_vnd": gross_vnd,
        # Legacy column name; the value stored here is BTC quantity.
        "amount_usdt": amount_btc,
        "price_source": price_source,
        "applied_price": _num(applied_price),
    })
    if not created:
        return None

    trade_id = str(created.get("id") or "")
    try:
        if side_norm == "BUY":
            settlement = debit_wallet_for_payment(
                user_id, gross_vnd, f"Mua BTC demo · {amount_btc:.8f} BTC", trade_id or None
            )
        else:
            settlement = credit_wallet_balance(
                user_id, gross_vnd, f"Bán BTC demo · {amount_btc:.8f} BTC", trade_id or None
            )
    except Exception:
        if trade_id:
            delete_demo_trade(trade_id, user_id)
        raise

    try:
        portfolio_after = summarize_demo_trades(user_id)
    except Exception:
        # The trade and wallet settlement already succeeded. Do not return an
        # error only because the optional summary refresh is temporarily down.
        portfolio_after = {}

    return {
        **created,
        "amount_btc": amount_btc,
        "wallet": settlement.get("wallet") or {},
        "portfolio": portfolio_after,
    }
