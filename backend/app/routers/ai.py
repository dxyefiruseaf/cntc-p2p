from fastapi import APIRouter, Query, Request

from app.data_loader import load_mock_data
from app.auth import get_optional_user
from app.repositories.market_repository import get_ai_history, get_ai_history_for_user, get_latest_ohlcv, get_p2p_spread, insert_ai_history_safe
from app.schemas import AskAIRequest, AskAIResponse
from app.services.ai_service import (
    DISCLAIMER,
    build_market_prompt,
    build_system_prompt,
    call_ai_provider,
    default_risks,
    fallback_answer,
    now_iso,
    suggested_action,
)
from app.services.indicator_service import score_market, signal_from_latest
from app.services.public_api_service import fetch_public_api

router = APIRouter(prefix="/api/ai", tags=["ai"])


async def _market_context():
    latest = get_latest_ohlcv()
    if not latest:
        latest = await fetch_public_api("/api/latest")
    if not latest:
        latest = load_mock_data()["latest"]

    summary = signal_from_latest(latest)
    public_summary = await fetch_public_api("/api/indicators/summary")
    if public_summary and not get_latest_ohlcv():
        summary = public_summary

    p2p_rows = get_p2p_spread(168)
    if p2p_rows:
        p2p = {"count": len(p2p_rows), "hours": 168, "latest": p2p_rows[0], "data": p2p_rows[:20]}
    else:
        p2p_public = await fetch_public_api("/api/p2p-spread?hours=168")
        if p2p_public:
            p2p = p2p_public
        else:
            mock = load_mock_data()["p2p"]
            p2p = {"count": mock.get("count", len(mock["data"])), "hours": 168, "latest": mock["data"][0], "data": mock["data"][:20]}

    return latest, summary, p2p


@router.post("/ask", response_model=AskAIResponse)
async def ask_ai(payload: AskAIRequest, request: Request):
    latest, summary, p2p = await _market_context()
    rule = score_market(latest, summary)

    system_prompt = build_system_prompt()
    prompt = build_market_prompt(payload.question, latest, summary, p2p, rule, payload.risk_profile)
    try:
        answer = await call_ai_provider(prompt, system_prompt)
    except Exception as exc:
        answer = None
        print(f"AI provider lỗi, fallback rule-based: {exc}")
    if not answer:
        answer = fallback_answer(payload.question, rule, latest, p2p)

    created_at = now_iso()
    reasons = rule.get("reasons") or []
    risks = default_risks()
    response = {
        "verdict": rule["verdict"],
        "confidence": rule["confidence"],
        "answer": answer,
        "reasons": reasons,
        "risks": risks,
        "suggested_action": suggested_action(rule["verdict"]),
        "disclaimer": DISCLAIMER,
        "created_at": created_at,
    }

    user = get_optional_user(request)
    insert_ai_history_safe(
        {
            "question": payload.question,
            "answer": answer,
            "verdict": rule["verdict"],
            "confidence": rule["confidence"],
            "reasons": reasons,
            "risks": risks,
            "market_snapshot": {"latest": latest, "summary": summary, "p2p_latest": p2p.get("latest")},
            "model_name": "backend-ai-advisor",
            "user_id": user["id"] if user else None,
            "created_at": created_at,
        }
    )
    return response


@router.get("/history")
async def ai_history(request: Request, limit: int = Query(24, ge=1, le=200)):
    user = get_optional_user(request)
    rows = get_ai_history_for_user(user["id"], limit) if user else get_ai_history(limit)
    if rows:
        return {"count": len(rows), "data": rows, "scope": "user" if user else "public"}

    public = await fetch_public_api(f"/api/ai/history?limit={limit}")
    if public:
        return public

    mock = load_mock_data().get("aiHistory", {"count": 0, "data": []})
    data = mock.get("data", [])[:limit]
    return {"count": len(data), "data": data}
