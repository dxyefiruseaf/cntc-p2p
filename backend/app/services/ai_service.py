from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings

DISCLAIMER = "Thông tin chỉ mang tính tham khảo, không phải lời khuyên đầu tư cá nhân."


def build_system_prompt() -> str:
    return """
Bạn là trợ lý phân tích Bitcoin cho nhà đầu tư cá nhân tại Việt Nam.

Nhiệm vụ:
- Phân tích BTC/USDT dựa trên dữ liệu backend cung cấp, không tự bịa số liệu.
- Đưa ra kết luận theo một trong ba trạng thái: BUY, SELL hoặc NEUTRAL.
- Giải thích bằng tiếng Việt, dễ hiểu cho người không chuyên.
- Luôn nêu lý do dựa trên RSI, MACD, EMA, Bollinger Bands, biến động giá, P2P spread và thuế nếu câu hỏi có liên quan.
- Không khẳng định chắc chắn thị trường sẽ tăng/giảm.
- Không khuyên all-in, vay tiền, dùng đòn bẩy cao hoặc giao dịch vượt khả năng chịu rủi ro.
- Nếu tín hiệu mâu thuẫn, ưu tiên NEUTRAL.
- Luôn nhắc rằng đây chỉ là thông tin tham khảo, không phải lời khuyên đầu tư cá nhân.

Trả lời gọn theo cấu trúc:
1. Kết luận ngắn.
2. 3-5 lý do chính.
3. Rủi ro cần chú ý.
4. Hành động thận trọng.
""".strip()


def build_market_prompt(
    question: str,
    latest: dict[str, Any],
    summary: dict[str, Any],
    p2p: dict[str, Any],
    rule_result: dict[str, Any],
    risk_profile: str = "moderate",
) -> str:
    payload = {
        "user_question": question,
        "risk_profile": risk_profile,
        "rule_based_result": rule_result,
        "latest_ohlcv": latest,
        "indicator_summary": summary,
        "p2p_spread": {
            "latest": p2p.get("latest"),
            "count": p2p.get("count"),
            "note": p2p.get("note"),
        },
    }
    return (
        "Dữ liệu thị trường dưới đây là nguồn duy nhất được phép sử dụng. "
        "Nếu thiếu dữ liệu, hãy nói rõ là chưa đủ dữ liệu.\n\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, default=str, indent=2)}\n```"
    )


async def call_ai_provider(prompt: str, system_prompt: str) -> str | None:
    settings = get_settings()
    provider = (settings.ai_provider or "mock").lower().strip()
    model = settings.ai_model

    if provider == "gemini" and settings.gemini_api_key:
        return await _call_gemini(prompt, system_prompt, settings.gemini_api_key, model or "gemini-1.5-flash")
    if provider == "groq" and settings.groq_api_key:
        return await _call_openai_compatible(
            prompt,
            system_prompt,
            api_key=settings.groq_api_key,
            base_url="https://api.groq.com/openai/v1/chat/completions",
            model=model or "llama-3.1-8b-instant",
        )
    if provider == "openai" and settings.openai_api_key:
        return await _call_openai_compatible(
            prompt,
            system_prompt,
            api_key=settings.openai_api_key,
            base_url="https://api.openai.com/v1/chat/completions",
            model=model or "gpt-4o-mini",
        )
    return None


async def _call_gemini(prompt: str, system_prompt: str, api_key: str, model: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.25, "maxOutputTokens": 900},
    }
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(url, json=body)
        res.raise_for_status()
        data = res.json()
    return data["candidates"][0]["content"]["parts"][0]["text"]


async def _call_openai_compatible(prompt: str, system_prompt: str, api_key: str, base_url: str, model: str) -> str:
    body = {
        "model": model,
        "temperature": 0.25,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(base_url, json=body, headers=headers)
        res.raise_for_status()
        data = res.json()
    return data["choices"][0]["message"]["content"]


def fallback_answer(question: str, rule_result: dict[str, Any], latest: dict[str, Any], p2p: dict[str, Any]) -> str:
    verdict = rule_result.get("verdict", "NEUTRAL")
    price = latest.get("close")
    reasons = rule_result.get("reasons") or ["Tín hiệu hiện tại chưa đủ mạnh để kết luận một chiều."]
    action = suggested_action(verdict)
    reason_text = "\n".join(f"- {item}" for item in reasons[:5])
    price_text = f" quanh ${price:,.2f}" if isinstance(price, (int, float)) else " hiện tại"
    return (
        f"Kết luận tham khảo: {verdict}.\n\n"
        f"BTC đang giao dịch{price_text}. Các lý do chính:\n{reason_text}\n\n"
        f"Hành động thận trọng: {action}\n\n"
        "Rủi ro: BTC biến động mạnh, tín hiệu kỹ thuật có thể sai khi có tin tức bất ngờ; không nên all-in hoặc dùng đòn bẩy cao.\n"
        f"{DISCLAIMER}"
    )


def suggested_action(verdict: str) -> str:
    if verdict == "BUY":
        return "Có thể cân nhắc chia nhỏ vị thế, chờ điểm vào hợp lý và đặt mức cắt lỗ rõ ràng."
    if verdict == "SELL":
        return "Có thể cân nhắc chốt một phần hoặc đứng ngoài quan sát, đặc biệt nếu đã có lợi nhuận."
    return "Nên quan sát thêm, tránh vào lệnh lớn khi tín hiệu mua/bán còn mâu thuẫn."


def default_risks() -> list[str]:
    return [
        "Bitcoin có biến động mạnh trong ngắn hạn.",
        "Tín hiệu kỹ thuật có thể sai khi thị trường có tin tức bất ngờ.",
        "Không nên all-in, vay tiền hoặc dùng đòn bẩy cao.",
    ]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
