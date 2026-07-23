from __future__ import annotations

import os

import uvicorn


if __name__ == "__main__":
    environment = os.getenv("APP_ENV", "development").lower()
    reload_enabled = environment in {"development", "dev", "local"} and os.getenv("UVICORN_RELOAD", "true").lower() == "true"
    workers = 1 if reload_enabled else max(1, int(os.getenv("WEB_CONCURRENCY", "2")))
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("PORT", "8000")),
        reload=reload_enabled,
        workers=workers,
        timeout_keep_alive=int(os.getenv("KEEP_ALIVE_SECONDS", "10")),
        backlog=int(os.getenv("UVICORN_BACKLOG", "2048")),
        limit_concurrency=int(os.getenv("UVICORN_LIMIT_CONCURRENCY", "1000")),
        proxy_headers=True,
        forwarded_allow_ips="*",
    )
