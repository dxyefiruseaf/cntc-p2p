from typing import Any

import httpx

from app.config import get_settings


async def fetch_public_api(endpoint: str, timeout: float = 8.0) -> Any | None:
    settings = get_settings()
    if not settings.use_public_api_fallback:
        return None
    base = settings.public_data_api_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.get(f"{base}{endpoint}")
            res.raise_for_status()
            return res.json()
    except Exception:
        return None
