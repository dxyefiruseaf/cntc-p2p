from __future__ import annotations

import httpx

from app.config import get_settings


async def send_alert_email(to_email: str, subject: str, html_body: str) -> dict:
    settings = get_settings()
    if not settings.resend_api_key:
        return {"ok": False, "status": "skipped", "message": "RESEND_API_KEY chưa cấu hình"}

    async with httpx.AsyncClient(timeout=30) as client:
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
