from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BTC BigData API"
    app_env: str = "development"
    api_version: str = "1.0.0"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    supabase_anon_key: str | None = None
    use_supabase: bool = True

    public_data_api_url: str = "https://btc-bigdata-is55a.onrender.com"
    use_public_api_fallback: bool = True

    ai_provider: str = "mock"
    ai_model: str | None = None
    gemini_api_key: str | None = None
    groq_api_key: str | None = None
    openai_api_key: str | None = None

    # Email alerts (Resend)
    resend_api_key: str | None = None
    alert_from_email: str = "BTC BigData Alert <onboarding@resend.dev>"
    alert_cooldown_hours: int = 6

    # Frontend / payment redirects
    frontend_url: str = "http://localhost:5173"

    # VNPay Sandbox
    vnpay_tmn_code: str | None = None
    vnpay_hash_secret: str | None = None
    vnpay_pay_url: str = "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"
    vnpay_return_url: str = "http://localhost:8000/api/payment/return"
    vnpay_wallet_return_url: str | None = None

    # Demo payment mode for coursework: create QR + confirm internally, no real bank/payment app needed.
    wallet_demo_payment_enabled: bool = True

    admin_seed_token: str = "change-me"

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    @property
    def cors_origin_list(self) -> List[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
