import pytest
from app.services.ai_service import call_ai_provider, fallback_answer, build_system_prompt, build_market_prompt

@pytest.mark.asyncio
async def test_call_ai_provider_mock(mocker):
    mock_settings = mocker.Mock(ai_provider="mock", ai_model=None)
    mocker.patch("app.services.ai_service.get_settings", return_value=mock_settings)
    
    result = await call_ai_provider("test prompt", "system prompt")
    assert result is None

@pytest.mark.asyncio
async def test_call_ai_provider_gemini(mocker):
    mock_settings = mocker.Mock(
        ai_provider="gemini", 
        gemini_api_key="fake_key",
        ai_model="gemini-test"
    )
    mocker.patch("app.services.ai_service.get_settings", return_value=mock_settings)
    
    # Mock _call_gemini
    mock_call_gemini = mocker.patch("app.services.ai_service._call_gemini", return_value="Gemini response")
    
    result = await call_ai_provider("test prompt", "system prompt")
    
    assert result == "Gemini response"
    mock_call_gemini.assert_called_once_with("test prompt", "system prompt", "fake_key", "gemini-test")

@pytest.mark.asyncio
async def test_call_ai_provider_openai(mocker):
    mock_settings = mocker.Mock(
        ai_provider="openai", 
        openai_api_key="fake_key",
        ai_model="gpt-test",
        groq_api_key=None
    )
    mocker.patch("app.services.ai_service.get_settings", return_value=mock_settings)
    
    # Mock _call_openai_compatible
    mock_call_openai = mocker.patch("app.services.ai_service._call_openai_compatible", return_value="OpenAI response")
    
    result = await call_ai_provider("test prompt", "system prompt")
    
    assert result == "OpenAI response"
    mock_call_openai.assert_called_once_with(
        "test prompt", 
        "system prompt", 
        api_key="fake_key", 
        base_url="https://api.openai.com/v1/chat/completions",
        model="gpt-test"
    )

def test_fallback_answer():
    rule_result = {"verdict": "BUY", "reasons": ["RSI quá thấp", "MACD cắt lên"]}
    latest = {"close": 60000}
    p2p = {}
    
    result = fallback_answer("Nên mua không?", rule_result, latest, p2p)
    
    assert "Kết luận tham khảo: BUY" in result
    assert "$60,000.00" in result
    assert "RSI quá thấp" in result
    assert "MACD cắt lên" in result
    assert "Có thể cân nhắc chia nhỏ vị thế" in result

def test_build_prompts():
    system_prompt = build_system_prompt()
    assert "Bạn là trợ lý phân tích Bitcoin" in system_prompt
    
    market_prompt = build_market_prompt(
        question="Nên làm gì?",
        latest={"close": 50000},
        summary={"trend": "up"},
        p2p={"latest": 26000},
        rule_result={"verdict": "BUY"}
    )
    assert "Nên làm gì?" in market_prompt
    assert "50000" in market_prompt
