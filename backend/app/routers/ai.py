from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Query, Request
from starlette.concurrency import run_in_threadpool

from app.auth import get_optional_user
from app.data_loader import load_mock_data
from app.repositories.market_repository import (
    get_ai_history,
    get_ai_history_for_user,
    get_latest_ohlcv,
    get_p2p_spread,
    insert_ai_history_safe,
)
from app.schemas import AskAIRequest, AskAIResponse
from app.services.ai_service import (
    DISCLAIMER,
    build_market_prompt,
    build_system_prompt,
    call_ai_provider,
    data_quality,
    default_risks,
    detect_intent,
    extract_amount_vnd,
    fallback_answer,
    finalize_answer,
    now_iso,
    requires_market_data,
    suggested_action,
)
from app.services.indicator_service import calculate_risk_score, score_market, signal_from_latest
from app.services.public_api_service import fetch_public_api
from app.services.tax_service import calc_tax

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _normalize_p2p(rows: list[dict[str, Any]], *, source: str, hours: int = 168) -> dict[str, Any]:
    buy = next((row for row in rows if str(row.get("trade_type", "")).upper() == "BUY"), None)
    sell = next((row for row in rows if str(row.get("trade_type", "")).upper() == "SELL"), None)
    return {
        "count": len(rows),
        "hours": hours,
        "latest": rows[0] if rows else None,
        "buy": buy,
        "sell": sell,
        "data": rows[:20],
        "source": source,
    }


async def _market_context() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    # Supabase Python calls are synchronous. Run independent reads concurrently
    # in the thread pool so AI requests do not block the FastAPI event loop.
    latest, p2p_rows = await asyncio.gather(
        run_in_threadpool(get_latest_ohlcv),
        run_in_threadpool(get_p2p_spread, 168),
    )
    latest_source = "supabase"
    if not latest:
        latest = await fetch_public_api("/api/latest")
        latest_source = "public_api"
    if not latest:
        latest = load_mock_data().get("latest", {})
        latest_source = "mock"
    latest = dict(latest or {})
    latest["_context_source"] = latest_source

    summary = signal_from_latest(latest)
    if latest_source != "supabase":
        public_summary = await fetch_public_api("/api/indicators/summary")
        if public_summary:
            summary = public_summary

    if p2p_rows:
        p2p = _normalize_p2p(p2p_rows, source="supabase")
    else:
        p2p_public = await fetch_public_api("/api/p2p-spread?hours=168")
        if p2p_public:
            public_rows = p2p_public.get("data") if isinstance(p2p_public, dict) else None
            if isinstance(public_rows, list):
                p2p = _normalize_p2p(public_rows, source="public_api")
                p2p["count"] = p2p_public.get("count", p2p["count"])
                p2p["hours"] = p2p_public.get("hours", 168)
                p2p["note"] = p2p_public.get("note")
            else:
                p2p = dict(p2p_public)
                p2p["source"] = "public_api"
        else:
            mock = load_mock_data().get("p2p", {})
            mock_rows = mock.get("data", []) if isinstance(mock, dict) else []
            p2p = _normalize_p2p(mock_rows, source="mock")
            p2p["count"] = mock.get("count", p2p["count"]) if isinstance(mock, dict) else p2p["count"]

    return latest, summary, p2p


def _empty_rule() -> dict[str, Any]:
    return {"verdict": "NEUTRAL", "score": 0, "confidence": 50, "reasons": []}


def _safe_tax_result(question: str, payload_amount: float | None) -> dict[str, Any] | None:
    amount = payload_amount if payload_amount and payload_amount > 0 else extract_amount_vnd(question)
    if not amount:
        return None
    try:
        return calc_tax(amount, "VN", 0)
    except Exception as exc:
        logger.warning("Không tính được thuế cho AI context: %s", exc)
        return None


@router.post("/ask", response_model=AskAIResponse)
async def ask_ai(payload: AskAIRequest, request: Request):
    question = payload.question.strip()
    intent = detect_intent(question)

    latest: dict[str, Any] = {}
    summary: dict[str, Any] = {}
    p2p: dict[str, Any] = {}
    rule = _empty_rule()
    risk: dict[str, Any] = {}

    # Không gọi Supabase/API thị trường cho câu hỏi cách dùng website hoặc kiến thức chung.
    if requires_market_data(intent):
        latest, summary, p2p = await _market_context()
        rule = score_market(latest, summary)
        risk = calculate_risk_score(latest)

    tax_result = _safe_tax_result(question, payload.amount_vnd) if intent == "tax" else None

    prompt = build_market_prompt(
        question,
        latest,
        summary,
        p2p,
        rule,
        payload.risk_profile,
        risk_result=risk,
        amount_vnd=(tax_result or {}).get("gross_amount") if tax_result else payload.amount_vnd,
        tax_result=tax_result,
    )

    answer = await call_ai_provider(prompt, build_system_prompt())
    if answer:
        answer = finalize_answer(answer, question)
    else:
        answer = fallback_answer(question, rule, latest, p2p, tax_result=tax_result)

    is_decision = intent == "market_decision"
    is_market_explanation = intent in {"market_decision", "market_status", "indicator"}
    created_at = now_iso()
    reasons = list(rule.get("reasons") or []) if is_market_explanation else []
    risks = default_risks() if is_decision else []
    quality = data_quality(latest) if latest else {"status": "not_required"}

    response = {
        "intent": intent,
        "uses_market_data": requires_market_data(intent),
        "data_quality": quality,
        "verdict": rule.get("verdict", "NEUTRAL"),
        "confidence": int(rule.get("confidence", 50)),
        "answer": answer,
        "reasons": reasons,
        "risks": risks,
        "suggested_action": suggested_action(rule.get("verdict", "NEUTRAL")) if is_decision else "",
        "disclaimer": DISCLAIMER if intent in {"market_decision", "p2p", "tax"} else "",
        "created_at": created_at,
        "risk_score": risk.get("score") if risk else None,
        "risk_level": risk.get("level") if risk else None,
        "risk_factors": risk.get("factors", []) if is_market_explanation else [],
    }

    user = await run_in_threadpool(get_optional_user, request)
    history_row = {
            "question": question,
            "answer": answer,
            "verdict": response["verdict"],
            "confidence": response["confidence"],
            "reasons": reasons,
            "risks": risks,
            "market_snapshot": {
                "intent": intent,
                "latest": latest if requires_market_data(intent) else None,
                "summary": summary if is_market_explanation else None,
                "p2p_latest": p2p.get("latest") if intent in {"market_decision", "p2p", "tax"} else None,
                "risk": risk if is_market_explanation else None,
                "tax": tax_result,
                "data_quality": quality,
            },
            "model_name": "backend-ai-advisor",
            "user_id": user["id"] if user else None,
            "created_at": created_at,
        }
    await run_in_threadpool(insert_ai_history_safe, history_row)
    return response


@router.get("/history")
async def ai_history(
    request: Request,
    limit: int = Query(20, ge=1, le=100),
    before: str | None = Query(None),
):
    user = await run_in_threadpool(get_optional_user, request)
    if user:
        rows = await run_in_threadpool(
            get_ai_history_for_user,
            user["id"],
            limit,
            before_created_at=before,
        )
    else:
        rows = await run_in_threadpool(get_ai_history, limit, before_created_at=before)
    if rows:
        next_cursor = rows[-1].get("created_at") if len(rows) == limit else None
        return {
            "count": len(rows),
            "data": rows,
            "scope": "user" if user else "public",
            "next_cursor": next_cursor,
            "has_next": bool(next_cursor),
        }

    public = await fetch_public_api(f"/api/ai/history?limit={limit}")
    if public:
        return public

    mock = load_mock_data().get("aiHistory", {"count": 0, "data": []})
    data = mock.get("data", [])[:limit]
    return {"count": len(data), "data": data}
