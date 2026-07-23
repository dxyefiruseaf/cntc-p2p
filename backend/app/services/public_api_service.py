from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings

# Reuse TCP/TLS connections across fallback requests. Creating an AsyncClient
# for every request was measurable overhead during Render cold starts.
_CLIENT = httpx.AsyncClient(
    timeout=httpx.Timeout(8.0, connect=4.0),
    limits=httpx.Limits(max_connections=40, max_keepalive_connections=20, keepalive_expiry=30.0),
    headers={"User-Agent": "BTC-BigData-Backend/1.0"},
)


async def fetch_public_api(endpoint: str, timeout: float = 8.0) -> Any | None:
    settings = get_settings()
    if not settings.use_public_api_fallback:
        return None
    base = settings.public_data_api_url.rstrip("/")
    try:
        res = await _CLIENT.get(f"{base}{endpoint}", timeout=timeout)
        res.raise_for_status()
        return res.json()
    except Exception:
        return None
