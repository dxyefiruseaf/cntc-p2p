from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import admin, ai, alerts, demo_trades, market, payment, settlement, tax

settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.api_version,
    description="Backend FastAPI cho BTC BigData AI Advisor: Supabase + AI Advisor + API dữ liệu tài chính.",
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
        "name": settings.app_name,
        "version": settings.api_version,
        "docs": "/docs",
        "health": "/health",
        "endpoints": [
            "/api/latest",
            "/api/ohlcv?hours=168",
            "/api/indicators/summary",
            "/api/p2p-spread?hours=168",
            "/api/tax-estimate?amount=100000000&country=VN",
            "/api/net-settlement?amount=100000000&unit=vnd&side=sell&price_source=p2p",
            "/api/data-status",
            "/api/data-reliability",
            "/api/risk-score",
            "/api/market-alerts",
            "/api/p2p-comparison",
            "/api/ai/ask",
            "/api/ai/history?limit=24",
        ],
    }


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env}


app.include_router(market.router)
app.include_router(tax.router)
app.include_router(settlement.router)
app.include_router(ai.router)
app.include_router(demo_trades.router)
app.include_router(alerts.router)
app.include_router(payment.router)
app.include_router(admin.router)
