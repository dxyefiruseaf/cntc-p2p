from __future__ import annotations

import asyncio
import os
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Any

import httpx
from fastapi import APIRouter, Query

router = APIRouter(prefix="/api", tags=["news"])

_CACHE: dict[str, Any] = {"expires_at": 0.0, "items": [], "sources": []}

DEFAULT_RSS_URLS = [
    "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml",
]

MOCK_NEWS = [
    {
        "title": "Bitcoin giữ vai trò tài sản rủi ro cao, cần kết hợp phân tích kỹ thuật và quản trị vốn",
        "link": "#",
        "source": "Demo fallback",
        "published_at": datetime.now(timezone.utc).isoformat(),
        "summary": "Tin demo dùng khi nguồn RSS không phản hồi. Nội dung phục vụ minh họa UI ticker/news trong phạm vi môn học.",
        "tags": ["BTC", "risk"],
    },
    {
        "title": "Dữ liệu P2P và độ mới dữ liệu là yếu tố quan trọng trước khi diễn giải tín hiệu mua/bán",
        "link": "#",
        "source": "Demo fallback",
        "published_at": datetime.now(timezone.utc).isoformat(),
        "summary": "Hệ thống ưu tiên kiểm tra nguồn dữ liệu trước khi đưa ra cảnh báo hoặc AI Advisor.",
        "tags": ["P2P", "data"],
    },
    {
        "title": "AI Advisor nên giải thích rủi ro thay vì khuyến khích giao dịch theo cảm xúc",
        "link": "#",
        "source": "Demo fallback",
        "published_at": datetime.now(timezone.utc).isoformat(),
        "summary": "Tin demo nhấn mạnh nguyên tắc: AI trong đề tài chỉ hỗ trợ học tập và tham khảo.",
        "tags": ["AI", "education"],
    },
]


def _rss_urls() -> list[str]:
    raw = os.getenv("NEWS_RSS_URLS", "").strip()
    if not raw:
        return DEFAULT_RSS_URLS
    return [item.strip() for item in raw.split(",") if item.strip()]


def _cache_ttl() -> int:
    try:
        return max(60, int(os.getenv("NEWS_CACHE_TTL_SECONDS", "600")))
    except ValueError:
        return 600


def _text(node: ET.Element | None, default: str = "") -> str:
    if node is None or node.text is None:
        return default
    return unescape(" ".join(node.text.split()))


def _safe_dt(value: str) -> str:
    if not value:
        return datetime.now(timezone.utc).isoformat()
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except Exception:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat()
        except Exception:
            return datetime.now(timezone.utc).isoformat()


def _matches_btc(item: dict[str, Any]) -> bool:
    haystack = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    keywords = ["bitcoin", "btc", "crypto", "cryptocurrency", "binance", "etf", "blockchain"]
    return any(keyword in haystack for keyword in keywords)


def _parse_rss(xml_text: str, source_hint: str) -> list[dict[str, Any]]:
    root = ET.fromstring(xml_text)
    channel_title = _text(root.find("./channel/title"), source_hint)
    items: list[dict[str, Any]] = []
    for item in root.findall(".//item")[:40]:
        title = _text(item.find("title"))
        link = _text(item.find("link"), "#")
        pub = _text(item.find("pubDate")) or _text(item.find("published"))
        summary = _text(item.find("description"))
        if not title:
            continue
        row = {
            "title": title,
            "link": link,
            "source": channel_title or source_hint,
            "published_at": _safe_dt(pub),
            "summary": summary[:320],
            "tags": [tag for tag in ["BTC" if "bitcoin" in title.lower() or "btc" in title.lower() else None, "news"] if tag],
        }
        if _matches_btc(row):
            items.append(row)
    return items


async def _fetch_source(client: httpx.AsyncClient, url: str) -> list[dict[str, Any]]:
    response = await client.get(url, timeout=8.0, follow_redirects=True)
    response.raise_for_status()
    return _parse_rss(response.text, url)


async def _fetch_news() -> tuple[list[dict[str, Any]], list[str]]:
    urls = _rss_urls()
    async with httpx.AsyncClient(headers={"User-Agent": "BTC-BigData-AI-Advisor/1.0"}) as client:
        tasks = [_fetch_source(client, url) for url in urls]
        results = await asyncio.gather(*tasks, return_exceptions=True)
    items: list[dict[str, Any]] = []
    ok_sources: list[str] = []
    for url, result in zip(urls, results):
        if isinstance(result, Exception):
            continue
        if result:
            ok_sources.append(url)
            items.extend(result)
    # Deduplicate by title and sort newest first.
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in sorted(items, key=lambda x: x.get("published_at", ""), reverse=True):
        key = item["title"].strip().lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique, ok_sources


@router.get("/news/latest")
async def latest_news(limit: int = Query(12, ge=1, le=30), force_refresh: bool = False):
    now = time.time()
    if not force_refresh and _CACHE["items"] and now < float(_CACHE["expires_at"]):
        data = _CACHE["items"][:limit]
        return {
            "count": len(data),
            "data": data,
            "source": "rss_cache",
            "sources": _CACHE.get("sources", []),
            "disclaimer": "Tin tức chỉ dùng để bổ sung ngữ cảnh học tập, không phải tín hiệu giao dịch độc lập.",
        }

    try:
        items, sources = await _fetch_news()
    except Exception:
        items, sources = [], []

    if items:
        _CACHE["items"] = items
        _CACHE["sources"] = sources
        _CACHE["expires_at"] = now + _cache_ttl()
        data = items[:limit]
        return {
            "count": len(data),
            "data": data,
            "source": "rss",
            "sources": sources,
            "disclaimer": "Tin tức chỉ dùng để bổ sung ngữ cảnh học tập, không phải tín hiệu giao dịch độc lập.",
        }

    data = MOCK_NEWS[:limit]
    return {
        "count": len(data),
        "data": data,
        "source": "mock",
        "sources": [],
        "disclaimer": "Đang dùng tin demo vì nguồn RSS chưa phản hồi hoặc không có tin phù hợp.",
    }
