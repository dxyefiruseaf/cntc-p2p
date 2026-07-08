from pydantic import BaseModel, Field


class AskAIRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    amount_vnd: float | None = None
    risk_profile: str = "moderate"


class AskAIResponse(BaseModel):
    verdict: str
    confidence: int
    answer: str
    reasons: list[str]
    risks: list[str]
    suggested_action: str
    disclaimer: str
    created_at: str


class SeedRequest(BaseModel):
    token: str
    limit_ohlcv: int = Field(720, ge=1, le=8760)
    limit_p2p: int = Field(1440, ge=1, le=20000)
