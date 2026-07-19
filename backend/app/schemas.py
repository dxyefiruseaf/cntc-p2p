from typing import Any

from pydantic import BaseModel, Field


class AskAIRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    amount_vnd: float | None = None
    risk_profile: str = "moderate"


class AskAIResponse(BaseModel):
    intent: str = "general"
    uses_market_data: bool = False
    data_quality: dict[str, Any] | None = None
    verdict: str
    confidence: int
    answer: str
    reasons: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    suggested_action: str = ""
    disclaimer: str = ""
    created_at: str
    risk_score: int | None = None
    risk_level: str | None = None
    risk_factors: list[dict[str, Any]] = Field(default_factory=list)


class SeedRequest(BaseModel):
    token: str
    limit_ohlcv: int = Field(720, ge=1, le=8760)
    limit_p2p: int = Field(1440, ge=1, le=20000)
