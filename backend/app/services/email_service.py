from __future__ import annotations

import asyncio

import httpx

from app.config import get_settings

_EMAIL_CLIENT: httpx.AsyncClient | None = None
_EMAIL_CLIENT_LOCK = asyncio.Lock()


async def _email_client() -> httpx.AsyncClient:
    global _EMAIL_CLIENT
    if _EMAIL_CLIENT is not None and not _EMAIL_CLIENT.is_closed:
        return _EMAIL_CLIENT
    async with _EMAIL_CLIENT_LOCK:
        if _EMAIL_CLIENT is None or _EMAIL_CLIENT.is_closed:
            _EMAIL_CLIENT = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=8.0),
                limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
                headers={"Content-Type": "application/json"},
            )
    return _EMAIL_CLIENT


async def send_alert_email(to_email: str, subject: str, html_body: str) -> dict:
    settings = get_settings()
    if not settings.resend_api_key:
        return {"ok": False, "status": "skipped", "message": "RESEND_API_KEY chưa cấu hình"}

    client = await _email_client()
    res = await client.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        json={
            "from": settings.alert_from_email,
            "to": [to_email],
            "subject": subject,
            "html": html_body,
        },
    )
    res.raise_for_status()
    return {"ok": True, "status": "sent", "provider_response": res.json()}
