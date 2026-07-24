from __future__ import annotations

from typing import Any

from app.repositories.market_repository import (
    get_latest_ohlcv,
    get_p2p_spread,
    get_wallet_for_user,
    summarize_demo_trades,
)


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
        return number if number == number else default
    except (TypeError, ValueError):
        return default


def build_demo_asset_snapshot(
    user_id: str,
    *,
    wallet: dict[str, Any] | None = None,
    portfolio: dict[str, Any] | None = None,
    latest: dict[str, Any] | None = None,
    p2p_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return one consistent demo-asset snapshot for all asset-related pages.

    The wallet balance is cash in VND. ``position_btc`` is the amount of demo
    Bitcoin currently held after BUY/SELL trades. Market value and unrealized
    P/L are estimates based on the latest BTC/USDT close and the newest
    USDT/VND P2P reference rate.
    """
    wallet_data = wallet if wallet is not None else (get_wallet_for_user(user_id) or {})
    portfolio_data = portfolio if portfolio is not None else (summarize_demo_trades(user_id) or {})
    latest_data = latest if latest is not None else (get_latest_ohlcv() or {})
    p2p_data = p2p_rows if p2p_rows is not None else (get_p2p_spread(24) or [])

    latest_buy = next(
        (row for row in p2p_data if str(row.get("trade_type", "")).upper() == "BUY"),
        None,
    )
    latest_sell = next(
        (row for row in p2p_data if str(row.get("trade_type", "")).upper() == "SELL"),
        None,
    )
    latest_p2p = latest_buy or latest_sell or (p2p_data[0] if p2p_data else {})

    btc_usd = _num(latest_data.get("close"))
    usdt_vnd = _num(latest_p2p.get("p2p_price")) or _num(latest_p2p.get("market_price"))
    btc_price_vnd = btc_usd * usdt_vnd if btc_usd > 0 and usdt_vnd > 0 else 0.0

    cash_vnd = _num(wallet_data.get("balance_vnd"))
    position_btc = max(0.0, _num(portfolio_data.get("position_btc")))
    cost_basis_vnd = max(0.0, _num(portfolio_data.get("cost_basis_vnd")))
    avg_entry_vnd = max(0.0, _num(portfolio_data.get("avg_entry_vnd")))
    btc_market_value_vnd = position_btc * btc_price_vnd
    total_equity_vnd = cash_vnd + btc_market_value_vnd
    unrealized_pnl_vnd = btc_market_value_vnd - cost_basis_vnd
    unrealized_pnl_pct = (
        unrealized_pnl_vnd / cost_basis_vnd * 100
        if cost_basis_vnd > 0
        else 0.0
    )
    btc_allocation_pct = (
        btc_market_value_vnd / total_equity_vnd * 100
        if total_equity_vnd > 0
        else 0.0
    )

    return {
        "wallet": wallet_data,
        "portfolio": portfolio_data,
        "valuation": {
            "cash_vnd": round(cash_vnd, 2),
            "position_btc": round(position_btc, 8),
            "btc_usd": round(btc_usd, 8),
            "usdt_vnd": round(usdt_vnd, 2),
            "btc_price_vnd": round(btc_price_vnd, 2),
            "btc_market_value_vnd": round(btc_market_value_vnd, 2),
            "total_equity_vnd": round(total_equity_vnd, 2),
            "cost_basis_vnd": round(cost_basis_vnd, 2),
            "avg_entry_vnd": round(avg_entry_vnd, 2),
            "unrealized_pnl_vnd": round(unrealized_pnl_vnd, 2),
            "unrealized_pnl_pct": round(unrealized_pnl_pct, 4),
            "realized_pnl_vnd": round(_num(portfolio_data.get("realized_pnl_vnd")), 2),
            "btc_allocation_pct": round(btc_allocation_pct, 4),
            "price_source": "p2p_usdt_vnd" if btc_price_vnd > 0 else "unavailable",
            "market_timestamp": latest_data.get("timestamp"),
            "p2p_timestamp": latest_p2p.get("timestamp") if latest_p2p else None,
        },
    }
