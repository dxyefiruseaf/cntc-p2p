from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import market, news, settlement, tax

settings = get_settings()

app = FastAPI(
    title=f"{settings.app_name} Data API",
    version=settings.api_version,
    description=(
        "Server dữ liệu riêng cho BTC BigData Platform. "
        "Chỉ phục vụ market data/news/tax/settlement để giảm tải backend chính."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "name": f"{settings.app_name} Data API",
        "version": settings.api_version,
        "docs": "/docs",
        "health": "/health",
        "role": "data-server",
        "endpoints": [
            "/api/latest",
            "/api/ohlcv?hours=168",
            "/api/indicators/summary",
            "/api/p2p-spread?hours=168",
            "/api/data-status",
            "/api/data-reliability",
            "/api/risk-score",
            "/api/market-alerts",
            "/api/p2p-comparison",
            "/api/news/latest",
            "/api/tax-estimate?amount=100000000&country=VN",
            "/api/net-settlement?amount=100000000&unit=vnd&side=sell&price_source=p2p",
        ],
    }


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env, "role": "data-server"}


app.include_router(market.router)
app.include_router(news.router)
app.include_router(tax.router)
app.include_router(settlement.router)
