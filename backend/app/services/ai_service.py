from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Literal

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

DISCLAIMER = "Thông tin chỉ mang tính tham khảo, không phải lời khuyên đầu tư cá nhân."

Intent = Literal[
    "market_decision",
    "market_status",
    "indicator",
    "p2p",
    "tax",
    "website_help",
    "general",
]

_MARKET_INTENTS: set[str] = {
    "market_decision",
    "market_status",
    "indicator",
    "p2p",
    "tax",
}


def normalize_text(value: str) -> str:
    """Chuẩn hóa tiếng Việt để nhận diện ý định ổn định hơn."""
    normalized = unicodedata.normalize("NFD", (value or "").lower().strip())
    return "".join(char for char in normalized if unicodedata.category(char) != "Mn")


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def detect_intent(question: str) -> Intent:
    """Phân loại câu hỏi theo mục tiêu thực sự, không chỉ dựa vào một từ khóa đơn lẻ."""
    text = normalize_text(question)

    website_feature_keywords = (
        "dashboard",
        "decision hub",
        "san giao dich ao",
        "giao dich demo",
        "vi qr",
        "premium",
        "sandbox",
        "canh bao email",
        "lich su ai",
        "chuc nang website",
    )
    website_action_keywords = (
        "huong dan",
        "su dung",
        "mo trang",
        "tim o dau",
        "o dau",
        "bam vao dau",
        "vao muc nao",
        "cach dung",
        "cach mo",
        "cach dang nhap",
        "cach dang ky",
        "dang nhap",
        "dang ky",
        "doi mat khau",
        "quen mat khau",
    )
    tax_keywords = (
        "thue",
        "phi giao dich",
        "thuc nhan",
        "net settlement",
        "sau thue",
        "nghia vu thue",
        "tinh tien nhan",
    )
    p2p_keywords = (
        "p2p",
        "usdt vnd",
        "usdt/vnd",
        "chenh lech gia",
        "spread",
        "gia mua usdt",
        "gia ban usdt",
        "binance p2p",
    )
    decision_keywords = (
        "nen mua",
        "co nen mua",
        "nen ban",
        "co nen ban",
        "nen giu",
        "muon mua",
        "muon ban",
        "dinh mua",
        "dinh ban",
        "du dinh mua",
        "du dinh ban",
        "ke hoach mua",
        "ke hoach ban",
        "vao lenh",
        "thoat lenh",
        "chot loi",
        "cat lo",
        "mua luc nay",
        "ban luc nay",
        "dau tu luc nay",
        "buy hay sell",
        "buy or sell",
        "quyet dinh giao dich",
        "mua hay ban",
        "phan bo von",
        "chia lenh",
    )
    indicator_keywords = (
        "rsi",
        "macd",
        "ema",
        "bollinger",
        "stochastic",
        "atr",
        "volume",
        "khoi luong",
        "chi bao",
        "qua mua",
        "qua ban",
    )
    market_keywords = (
        "gia btc",
        "gia bitcoin",
        "bitcoin hien tai",
        "btc hien tai",
        "thi truong hien tai",
        "xu huong btc",
        "xu huong bitcoin",
        "thi truong tang",
        "thi truong giam",
        "risk score",
        "diem rui ro",
        "tin hieu tong hop",
        "tinh hinh bitcoin",
        "phan tich bitcoin",
        "phan tich btc",
        "bien dong bitcoin",
        "bien dong btc",
        "vi sao btc",
        "tai sao btc",
        "vi sao bitcoin",
        "tai sao bitcoin",
    )

    has_website_feature = _contains_any(text, website_feature_keywords)
    has_website_action = _contains_any(text, website_action_keywords)
    has_decision = _contains_any(text, decision_keywords)
    has_indicator = _contains_any(text, indicator_keywords)
    has_p2p = _contains_any(text, p2p_keywords)
    has_tax = _contains_any(text, tax_keywords)
    has_market = _contains_any(text, market_keywords)

    # Các tác vụ tài khoản/Premium luôn là hướng dẫn website.
    account_or_plan = _contains_any(
        text,
        (
            "premium",
            "sandbox",
            "dang nhap",
            "dang ky",
            "doi mat khau",
            "quen mat khau",
            "vi qr",
            "canh bao email",
        ),
    )
    if account_or_plan:
        return "website_help"

    # Khi câu hỏi vừa nhắc tên trang vừa hỏi quyết định thị trường, ưu tiên mục tiêu thị trường.
    # Ví dụ: "Trong Decision Hub tôi có nên mua BTC không?" phải là market_decision.
    if has_tax:
        return "tax"
    if has_p2p and not (has_website_action and has_website_feature):
        return "p2p"
    if has_decision:
        return "market_decision"
    if has_indicator:
        return "indicator"
    if has_market:
        return "market_status"
    if has_website_feature and has_website_action:
        return "website_help"
    if has_website_feature:
        return "website_help"

    # Nhận diện các câu tự nhiên như "BTC đang giảm vì sao?" hoặc "phân tích thị trường hôm nay".
    mentions_market_subject = _contains_any(text, ("btc", "bitcoin", "thi truong"))
    asks_current_state = _contains_any(
        text,
        (
            "hien tai",
            "hom nay",
            "luc nay",
            "dang tang",
            "dang giam",
            "tang vi sao",
            "giam vi sao",
            "tai sao tang",
            "tai sao giam",
            "vi sao tang",
            "vi sao giam",
            "xu huong",
            "dien bien",
            "bien dong",
            "phan tich",
            "rui ro",
        ),
    )
    if mentions_market_subject and asks_current_state:
        return "market_status"

    return "general"


def requires_market_data(intent: Intent) -> bool:
    return intent in _MARKET_INTENTS


def extract_amount_vnd(question: str) -> float | None:
    """Nhận diện các cách nhập phổ biến như 100 triệu, 1,5 tỷ hoặc 5000000 đồng."""
    text = normalize_text(question).replace(".", "")

    scaled = re.search(r"(\d+(?:[\s,]\d+)?)\s*(trieu|ty|nghin|ngan)", text)
    if scaled:
        raw = scaled.group(1).replace(" ", "").replace(",", ".")
        try:
            number = float(raw)
        except ValueError:
            return None
        multiplier = {
            "nghin": 1_000,
            "ngan": 1_000,
            "trieu": 1_000_000,
            "ty": 1_000_000_000,
        }[scaled.group(2)]
        return number * multiplier

    plain = re.search(r"\b(\d{4,})\s*(?:vnd|dong|đ)?\b", text)
    if plain:
        try:
            return float(plain.group(1))
        except ValueError:
            return None
    return None


def build_system_prompt() -> str:
    return """
Bạn là AI Advisor của BTC BigData Platform dành cho người dùng Việt Nam.

Mục tiêu của bạn là trả lời đúng trọng tâm câu hỏi bằng dữ liệu backend được cung cấp.

QUY TẮC BẮT BUỘC:
1. Đọc nguyên văn trường user_question, xác định đối tượng chính và điều người dùng thực sự muốn biết trước khi trả lời.
2. Câu đầu tiên phải trả lời trực tiếp câu hỏi đó. Không đổi câu hỏi thành một chủ đề khác, không mở đầu dài dòng.
3. Việc câu hỏi được gửi từ Decision Hub không có nghĩa người dùng luôn muốn khuyến nghị giao dịch. Không biến mọi câu hỏi thành BUY/SELL.
4. Mọi số liệu hiện tại về giá BTC, RSI, MACD, EMA, Bollinger, ATR, Risk Score, P2P hoặc thuế phải lấy từ JSON backend. Tuyệt đối không bịa số liệu.
5. Nếu dữ liệu cần thiết bị thiếu, null hoặc quá cũ, phải nói rõ. Không thay bằng số liệu từ kiến thức huấn luyện.
6. Chỉ phân tích các trường liên quan trực tiếp đến câu hỏi. Không liệt kê toàn bộ dữ liệu nếu người dùng chỉ hỏi một chỉ báo.
7. Có thể dùng kiến thức chung để giải thích khái niệm, nhưng không dùng kiến thức chung để tạo số liệu thị trường hiện tại.
8. Với câu hỏi về chức năng website, chỉ hướng dẫn thao tác trong BTC BigData Platform; không phân tích thị trường nếu người dùng không yêu cầu.
9. Không khẳng định chắc chắn giá sẽ tăng/giảm, không hứa lợi nhuận, không khuyên all-in, vay tiền hoặc dùng đòn bẩy cao.
10. Khi tín hiệu mâu thuẫn, ưu tiên NEUTRAL hoặc QUAN SÁT.
11. Không trả lời thêm câu hỏi mà người dùng chưa hỏi. Trả lời bằng tiếng Việt, đoạn ngắn, rõ ràng và không lặp ý.

CHỈ khi người dùng hỏi nên mua/bán/giữ, dùng cấu trúc:
- Kết luận tham khảo: BUY, SELL, NEUTRAL hoặc QUAN SÁT.
- Dữ liệu chính: 3-5 số liệu thực sự có trong JSON.
- Giải thích ngắn về sự đồng thuận hoặc mâu thuẫn của tín hiệu.
- Kế hoạch thận trọng và giới hạn dữ liệu.
- Tuyên bố miễn trừ trách nhiệm.
""".strip()


def _first_value(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = data.get(key)
        if value is not None:
            return value
    return None


def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return None
    return None


def _parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value).strip().replace(" ", "T")
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _compact(value: Any, depth: int = 0, max_depth: int = 4, max_items: int = 30) -> Any:
    """Giới hạn kích thước prompt nhưng giữ nguyên các dữ liệu quan trọng."""
    if depth >= max_depth:
        return "[Dữ liệu đã được rút gọn]" if isinstance(value, (dict, list, tuple)) else value
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= max_items:
                result["_truncated"] = True
                break
            if item is not None:
                result[str(key)] = _compact(item, depth + 1, max_depth, max_items)
        return result
    if isinstance(value, (list, tuple)):
        result = [_compact(item, depth + 1, max_depth, max_items) for item in value[:max_items]]
        if len(value) > max_items:
            result.append("[Danh sách đã được rút gọn]")
        return result
    if isinstance(value, str) and len(value) > 1200:
        return value[:1200] + "..."
    return value


def market_snapshot(latest: dict[str, Any]) -> dict[str, Any]:
    """Chuẩn hóa đúng tên trường hiện có trong bảng btcusdt_ohlcv_1h."""
    return {
        "timestamp": _first_value(latest, "timestamp", "time", "datetime", "open_time"),
        "open": latest.get("open"),
        "high": latest.get("high"),
        "low": latest.get("low"),
        "close": _first_value(latest, "close", "price", "current_price"),
        "volume": latest.get("volume"),
        "trades": latest.get("trades"),
        "rsi_14": _first_value(latest, "rsi_14", "rsi14", "rsi"),
        "macd": latest.get("macd"),
        "macd_signal": _first_value(latest, "macd_signal", "signal_line"),
        "macd_hist": _first_value(latest, "macd_hist", "macd_histogram"),
        "bb_upper": _first_value(latest, "bb_upper", "bollinger_upper"),
        "bb_mid": _first_value(latest, "bb_mid", "bb_middle", "bollinger_middle"),
        "bb_lower": _first_value(latest, "bb_lower", "bollinger_lower"),
        "bb_width": latest.get("bb_width"),
        "ema_20": _first_value(latest, "ema_20", "ema20"),
        "ema_50": _first_value(latest, "ema_50", "ema50"),
        "ema_200": _first_value(latest, "ema_200", "ema200"),
        "atr_14": _first_value(latest, "atr_14", "atr14", "atr"),
        "stoch_k": _first_value(latest, "stoch_k", "stochk"),
        "stoch_d": _first_value(latest, "stoch_d", "stochd"),
        "vol_ma_20": _first_value(latest, "vol_ma_20", "volume_ma20"),
    }


def data_quality(latest: dict[str, Any]) -> dict[str, Any]:
    snapshot = market_snapshot(latest)
    parsed = _parse_datetime(snapshot.get("timestamp"))
    age_minutes: float | None = None
    status = "unknown"
    if parsed:
        age_minutes = max(0.0, (datetime.now(timezone.utc) - parsed).total_seconds() / 60)
        if age_minutes <= 90:
            status = "fresh"
        elif age_minutes <= 360:
            status = "delayed"
        else:
            status = "stale"
    missing = [
        key
        for key in ("close", "rsi_14", "macd_hist", "ema_50")
        if snapshot.get(key) is None
    ]
    return {
        "snapshot_timestamp": snapshot.get("timestamp"),
        "age_minutes": round(age_minutes, 1) if age_minutes is not None else None,
        "status": status,
        "missing_important_fields": missing,
        "checked_at": now_iso(),
    }


def _indicator_focus(question: str, snapshot: dict[str, Any]) -> dict[str, Any]:
    text = normalize_text(question)
    focused: dict[str, Any] = {
        "timestamp": snapshot.get("timestamp"),
        "close": snapshot.get("close"),
    }
    groups = {
        "rsi": ("rsi_14",),
        "macd": ("macd", "macd_signal", "macd_hist"),
        "ema": ("ema_20", "ema_50", "ema_200"),
        "bollinger": ("bb_upper", "bb_mid", "bb_lower", "bb_width"),
        "atr": ("atr_14",),
        "stochastic": ("stoch_k", "stoch_d"),
        "volume": ("volume", "vol_ma_20"),
        "khoi luong": ("volume", "vol_ma_20"),
    }
    found = False
    for keyword, keys in groups.items():
        if keyword in text:
            found = True
            for key in keys:
                focused[key] = snapshot.get(key)
    return focused if found else snapshot


def _p2p_context(p2p: dict[str, Any]) -> dict[str, Any]:
    data = p2p.get("data") if isinstance(p2p.get("data"), list) else []
    buy = p2p.get("buy")
    sell = p2p.get("sell")
    if not buy:
        buy = next((row for row in data if str(row.get("trade_type", "")).upper() == "BUY"), None)
    if not sell:
        sell = next((row for row in data if str(row.get("trade_type", "")).upper() == "SELL"), None)
    latest = p2p.get("latest")
    return _compact(
        {
            "buy": buy,
            "sell": sell,
            "latest": latest,
            "count": p2p.get("count"),
            "hours": p2p.get("hours"),
            "note": p2p.get("note"),
            "source": p2p.get("source"),
        }
    )


def _task_instruction(intent: Intent) -> str:
    instructions: dict[Intent, str] = {
        "market_decision": (
            "Đánh giá đúng câu hỏi mua, bán hoặc giữ. Dùng tối đa 5 dữ liệu quan trọng nhất. "
            "Nếu tín hiệu không đồng thuận, kết luận NEUTRAL hoặc QUAN SÁT."
        ),
        "market_status": (
            "Tóm tắt trạng thái thị trường hiện tại; chỉ nêu giá, xu hướng, tín hiệu và mức rủi ro nếu có dữ liệu."
        ),
        "indicator": (
            "Chỉ trả lời về chỉ báo người dùng hỏi: giá trị hiện tại, ý nghĩa và giới hạn. "
            "Không phân tích các chỉ báo không liên quan."
        ),
        "p2p": (
            "Tập trung vào đúng chiều BUY/SELL được hỏi, giá P2P, giá tham chiếu, spread, số mẫu và thời gian cập nhật."
        ),
        "tax": (
            "Tập trung vào số tiền đầu vào, công thức và kết quả thuế/thực nhận backend cung cấp. "
            "Không tự tạo mức thuế hoặc kết quả còn thiếu."
        ),
        "website_help": (
            "Hướng dẫn thao tác trên BTC BigData Platform theo từng bước ngắn gọn. Không phân tích thị trường."
        ),
        "general": (
            "Trả lời ngắn gọn và đúng trọng tâm. Không ép câu trả lời thành BUY/SELL."
        ),
    }
    return instructions[intent]


def build_market_prompt(
    question: str,
    latest: dict[str, Any],
    summary: dict[str, Any],
    p2p: dict[str, Any],
    rule_result: dict[str, Any],
    risk_profile: str = "moderate",
    *,
    risk_result: dict[str, Any] | None = None,
    amount_vnd: float | None = None,
    tax_result: dict[str, Any] | None = None,
) -> str:
    intent = detect_intent(question)
    snapshot = market_snapshot(latest)
    context: dict[str, Any] = {
        "intent": intent,
        "risk_profile": risk_profile,
        "data_quality": data_quality(latest) if latest else {"status": "not_required"},
    }

    if intent == "indicator":
        context["requested_indicator_data"] = _compact(_indicator_focus(question, snapshot))
        context["indicator_summary"] = _compact(summary)
    elif intent in {"market_decision", "market_status"}:
        context["market_snapshot"] = _compact(snapshot)
        context["indicator_summary"] = _compact(summary)
        context["rule_based_result"] = _compact(rule_result)
        context["risk_score"] = _compact(risk_result or {})
        if intent == "market_decision":
            context["p2p_spread"] = _p2p_context(p2p)
    elif intent == "p2p":
        context["btc_close_usdt"] = snapshot.get("close")
        context["p2p_spread"] = _p2p_context(p2p)
    elif intent == "tax":
        context["amount_vnd"] = amount_vnd
        context["tax_result"] = _compact(tax_result or {})
        context["p2p_spread"] = _p2p_context(p2p)
    else:
        context["market_data_required"] = False

    payload = {
        "user_question": question.strip(),
        "detected_intent": intent,
        "task_instruction": _task_instruction(intent),
        "response_contract": {
            "answer_exact_question_first": True,
            "do_not_reframe_question": True,
            "do_not_append_unasked_sections": True,
            "use_only_backend_numbers_for_current_data": True,
        },
        "context": context,
    }
    return (
        "Hãy trả lời chính xác trường user_question.\n\n"
        "Quy định:\n"
        "- Mọi số liệu hiện tại chỉ được lấy từ JSON dưới đây.\n"
        "- Chỉ dùng các trường liên quan trực tiếp đến câu hỏi.\n"
        "- Nếu data_quality.status là delayed hoặc stale, phải cảnh báo rõ.\n"
        "- Nếu trường cần thiết bị thiếu, nói rõ chưa đủ dữ liệu.\n"
        "- Câu đầu tiên phải trả lời trực tiếp user_question.\n"
        "- Không tự đổi mục tiêu câu hỏi và không thêm mục người dùng không yêu cầu.\n\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, default=str, indent=2)}\n```"
    )


async def call_ai_provider(prompt: str, system_prompt: str) -> str | None:
    settings = get_settings()
    provider = (settings.ai_provider or "mock").lower().strip()
    model = settings.ai_model

    try:
        if provider == "gemini" and settings.gemini_api_key:
            return await _call_gemini(
                prompt,
                system_prompt,
                settings.gemini_api_key,
                model or "gemini-2.5-flash-lite",
            )
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
        logger.warning("AI provider chưa được cấu hình hoặc thiếu API key: %s", provider)
        return None
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        logger.exception("Không gọi được AI provider %s: %s", provider, exc)
        return None


async def _post_with_retry(
    url: str,
    *,
    body: dict[str, Any],
    headers: dict[str, str] | None = None,
    attempts: int = 2,
) -> dict[str, Any]:
    timeout = httpx.Timeout(30.0, connect=10.0)
    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(attempts):
            try:
                response = await client.post(url, json=body, headers=headers)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as exc:
                last_error = exc
                retryable = exc.response.status_code == 429 or exc.response.status_code >= 500
                if not retryable or attempt + 1 >= attempts:
                    break
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if attempt + 1 >= attempts:
                    break
            await asyncio.sleep(0.8 * (attempt + 1))
    if last_error:
        raise last_error
    raise RuntimeError("Không nhận được phản hồi từ AI provider.")


async def _call_gemini(prompt: str, system_prompt: str, api_key: str, model: str) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body = {
        "system_instruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.12,
            "topP": 0.85,
            "maxOutputTokens": 800,
        },
    }
    data = await _post_with_retry(url, body=body)
    candidates = data.get("candidates") or []
    if not candidates:
        raise ValueError("Gemini không trả về candidate.")
    parts = ((candidates[0].get("content") or {}).get("parts") or [])
    text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise ValueError("Gemini trả về nội dung rỗng.")
    return text


async def _call_openai_compatible(
    prompt: str,
    system_prompt: str,
    api_key: str,
    base_url: str,
    model: str,
) -> str:
    body = {
        "model": model,
        "temperature": 0.12,
        "top_p": 0.85,
        "max_tokens": 800,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
    }
    data = await _post_with_retry(
        base_url,
        body=body,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    choices = data.get("choices") or []
    if not choices:
        raise ValueError("AI provider không trả về choices.")
    content = (choices[0].get("message") or {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("AI provider trả về nội dung rỗng.")
    return content.strip()


def finalize_answer(answer: str, question: str) -> str:
    result = (answer or "").strip()
    if result.startswith("```") and result.endswith("```"):
        result = result[3:-3].strip()
    if detect_intent(question) in {"market_decision", "p2p", "tax"}:
        if DISCLAIMER.lower() not in result.lower():
            result = f"{result}\n\n{DISCLAIMER}"
    return result


def fallback_answer(
    question: str,
    rule_result: dict[str, Any],
    latest: dict[str, Any],
    p2p: dict[str, Any],
    *,
    tax_result: dict[str, Any] | None = None,
) -> str:
    intent = detect_intent(question)
    if intent == "website_help":
        return _website_help_fallback(question)
    if intent == "indicator":
        return _indicator_fallback(question, latest)
    if intent == "p2p":
        return _p2p_fallback(question, p2p)
    if intent == "tax":
        return _tax_fallback(tax_result)
    if intent in {"market_decision", "market_status"}:
        return _market_fallback(rule_result, latest, decision=intent == "market_decision")
    return (
        "AI Advisor đang tạm thời không kết nối được với nhà cung cấp AI. "
        "Bạn có thể hỏi về Bitcoin, chỉ báo kỹ thuật, P2P, thuế hoặc cách sử dụng BTC BigData Platform."
    )


def _market_fallback(rule_result: dict[str, Any], latest: dict[str, Any], *, decision: bool) -> str:
    verdict = str(rule_result.get("verdict") or "NEUTRAL").upper()
    price = _to_float(_first_value(latest, "close", "price", "current_price"))
    reasons = rule_result.get("reasons")
    if not isinstance(reasons, list) or not reasons:
        reasons = ["Các tín hiệu hiện tại chưa đủ đồng thuận để kết luận một chiều."]
    reason_text = "\n".join(f"- {item}" for item in reasons[:5])
    price_text = f" khoảng ${price:,.2f}" if price is not None else ""
    quality = data_quality(latest) if latest else {"status": "unknown"}
    stale_note = ""
    if quality.get("status") in {"delayed", "stale"}:
        stale_note = f"\n\nLưu ý: dữ liệu đang ở trạng thái {quality['status']} ({quality.get('age_minutes')} phút)."
    if not decision:
        return (
            f"BTC hiện giao dịch{price_text}. Tín hiệu tổng hợp là **{verdict}**.\n\n"
            f"Dữ liệu chính:\n{reason_text}{stale_note}"
        )
    return (
        f"Kết luận tham khảo: **{verdict}**.\n\n"
        f"BTC hiện giao dịch{price_text}. Dữ liệu chính:\n{reason_text}\n\n"
        f"Kế hoạch thận trọng: {suggested_action(verdict)}"
        f"{stale_note}\n\n{DISCLAIMER}"
    )


def _indicator_fallback(question: str, latest: dict[str, Any]) -> str:
    text = normalize_text(question)
    if "rsi" in text or "qua mua" in text or "qua ban" in text:
        value = _to_float(_first_value(latest, "rsi_14", "rsi14", "rsi"))
        current = f"RSI(14) hiện tại là **{value:.2f}**. " if value is not None else "Backend chưa có giá trị RSI hiện tại. "
        return current + "RSI trên 70 thường là vùng quá mua, dưới 30 thường là vùng quá bán; không nên dùng RSI riêng lẻ để quyết định giao dịch."
    if "macd" in text:
        macd = _to_float(latest.get("macd"))
        signal = _to_float(latest.get("macd_signal"))
        hist = _to_float(_first_value(latest, "macd_hist", "macd_histogram"))
        values = []
        if macd is not None:
            values.append(f"MACD {macd:.2f}")
        if signal is not None:
            values.append(f"Signal {signal:.2f}")
        if hist is not None:
            values.append(f"Histogram {hist:.2f}")
        current = ", ".join(values) if values else "Backend chưa có đủ dữ liệu MACD"
        return f"{current}. MACD trên Signal thường cho thấy động lượng tích cực hơn; MACD dưới Signal cho thấy động lượng suy yếu."
    if "ema" in text:
        values = []
        for key, label in (("ema_20", "EMA20"), ("ema_50", "EMA50"), ("ema_200", "EMA200")):
            value = _to_float(latest.get(key))
            if value is not None:
                values.append(f"{label} ${value:,.2f}")
        current = ", ".join(values) if values else "Backend chưa có dữ liệu EMA"
        return f"{current}. EMA ngắn hạn nằm trên EMA dài hạn thường hỗ trợ xu hướng tăng, nhưng cần kết hợp thêm động lượng và rủi ro."
    if "bollinger" in text:
        values = []
        for key, label in (("bb_upper", "dải trên"), ("bb_mid", "dải giữa"), ("bb_lower", "dải dưới")):
            value = _to_float(latest.get(key))
            if value is not None:
                values.append(f"{label} ${value:,.2f}")
        current = ", ".join(values) if values else "Backend chưa có đủ Bollinger Bands"
        return f"{current}. Dải mở rộng cho thấy biến động tăng; dải thu hẹp cho thấy thị trường đang tích lũy."
    if "atr" in text:
        value = _to_float(_first_value(latest, "atr_14", "atr"))
        current = f"ATR(14) hiện tại là **{value:,.2f}**. " if value is not None else "Backend chưa có ATR hiện tại. "
        return current + "ATR đo độ lớn biến động, không xác định trực tiếp xu hướng tăng hay giảm."
    if "stochastic" in text:
        k = _to_float(latest.get("stoch_k"))
        d = _to_float(latest.get("stoch_d"))
        current = f"Stochastic K={k:.2f}, D={d:.2f}. " if k is not None and d is not None else "Backend chưa có đủ Stochastic K/D. "
        return current + "Giá trị cao có thể phản ánh vùng quá mua, giá trị thấp có thể phản ánh vùng quá bán; cần xác nhận thêm bằng xu hướng."
    return "Bạn có thể hỏi riêng về RSI, MACD, EMA, Bollinger Bands, ATR, Stochastic hoặc khối lượng để hệ thống giải thích từ dữ liệu mới nhất."


def _p2p_fallback(question: str, p2p: dict[str, Any]) -> str:
    context = _p2p_context(p2p)
    text = normalize_text(question)
    wanted = "buy" if any(item in text for item in ("mua", "buy")) else "sell" if any(item in text for item in ("ban", "sell")) else None
    rows: list[tuple[str, Any]] = []
    if wanted:
        rows.append((wanted.upper(), context.get(wanted)))
    else:
        rows.extend((("BUY", context.get("buy")), ("SELL", context.get("sell"))))
    details = []
    for label, row in rows:
        if not isinstance(row, dict):
            continue
        price = _to_float(row.get("p2p_price"))
        market = _to_float(row.get("market_price"))
        spread = _to_float(row.get("spread_pct"))
        samples = row.get("samples")
        details.append(
            f"- {label}: giá P2P {price:,.2f} VND/USDT" if price is not None else f"- {label}: chưa có giá P2P"
        )
        if market is not None:
            details.append(f"  Giá tham chiếu: {market:,.2f} VND/USDT")
        if spread is not None:
            details.append(f"  Spread: {spread:.3f}%")
        if samples is not None:
            details.append(f"  Số mẫu: {samples}")
    if not details:
        return "Backend hiện chưa có đủ dữ liệu P2P cho chiều giao dịch được hỏi."
    return "Dữ liệu P2P mới nhất:\n" + "\n".join(details) + f"\n\n{DISCLAIMER}"


def _tax_fallback(tax_result: dict[str, Any] | None) -> str:
    if not tax_result:
        return (
            "Chưa đủ dữ liệu để tính thuế chính xác. Hãy cung cấp số tiền giao dịch hoặc mở trang **Tính thực nhận** để hệ thống tính từ backend.\n\n"
            f"{DISCLAIMER}"
        )
    gross = _to_float(tax_result.get("gross_amount"))
    tax = _to_float(tax_result.get("tax_amount"))
    net = _to_float(tax_result.get("net_amount"))
    rate = _to_float(tax_result.get("tax_rate_pct"))
    return (
        f"Với giá trị giao dịch **{gross:,.0f} VND**, thuế suất mô phỏng là **{rate:.3f}%**, "
        f"thuế ước tính **{tax:,.0f} VND** và còn lại khoảng **{net:,.0f} VND**.\n\n"
        f"{tax_result.get('note', '')}\n\n{DISCLAIMER}"
    )


def _website_help_fallback(question: str) -> str:
    text = normalize_text(question)
    if "dashboard" in text:
        return "Mở **Dashboard** để xem giá BTC, tín hiệu kỹ thuật, Risk Score, trạng thái dữ liệu và tin tức mới."
    if "decision hub" in text:
        return "Mở **Decision Hub** để xem kết luận tổng hợp, mức rủi ro, tính thực nhận và hỏi AI trong cùng một luồng."
    if "p2p" in text:
        return "Mở **P2P Spread**, sau đó chọn chiều BUY hoặc SELL để xem giá P2P, giá tham chiếu và mức chênh lệch."
    if "thuc nhan" in text or "thue" in text:
        return "Mở **Tính thực nhận**, nhập số tiền, chọn mua/bán và nguồn giá; hệ thống sẽ tính kết quả từ backend."
    if "canh bao" in text:
        return "Mở **Cảnh báo Email**, nhập điều kiện và ngưỡng cần theo dõi, sau đó bật cảnh báo."
    if "vi qr" in text:
        return "Mở **Ví QR demo**, nhập số tiền thử nghiệm và tạo mã QR. Đây là mô phỏng, không phải giao dịch tiền thật."
    if "premium" in text or "sandbox" in text:
        return "Mở phần **Premium**, chọn nâng cấp và hoàn tất luồng thanh toán Sandbox; sau khi xác nhận, hệ thống cập nhật quyền Premium."
    if "dang nhap" in text or "dang ky" in text:
        return "Mở mục **Đăng nhập/Đăng ký**, nhập email và làm theo bước xác minh; sau khi thành công bạn sẽ được chuyển về Dashboard."
    return "Bạn có thể sử dụng Dashboard, Decision Hub, Sàn giao dịch ảo, P2P Spread, Tính thực nhận, Cảnh báo Email, Ví QR demo và Premium Sandbox."


def suggested_action(verdict: str) -> str:
    verdict = str(verdict or "NEUTRAL").upper()
    if verdict == "BUY":
        return "Có thể cân nhắc chia nhỏ vị thế, chờ điểm vào hợp lý và xác định mức cắt lỗ trước khi giao dịch."
    if verdict == "SELL":
        return "Có thể cân nhắc chốt một phần hoặc đứng ngoài quan sát, đặc biệt nếu vị thế đã có lợi nhuận."
    return "Nên quan sát thêm và tránh vào lệnh lớn khi tín hiệu mua/bán còn mâu thuẫn."


def default_risks() -> list[str]:
    return [
        "Bitcoin có biến động mạnh trong ngắn hạn.",
        "Tín hiệu kỹ thuật có thể sai khi thị trường có tin tức bất ngờ.",
        "Không nên all-in, vay tiền hoặc dùng đòn bẩy cao.",
    ]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
