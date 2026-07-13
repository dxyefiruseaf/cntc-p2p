import pytest
import httpx
from app.services.email_service import send_alert_email

@pytest.mark.asyncio
async def test_send_alert_email_missing_key(mocker):
    # Mock settings where API key is empty
    mock_settings = mocker.Mock(resend_api_key=None)
    mocker.patch("app.services.email_service.get_settings", return_value=mock_settings)
    
    result = await send_alert_email("test@example.com", "Test", "<h1>Test</h1>")
    assert result["ok"] is False
    assert result["status"] == "skipped"

@pytest.mark.asyncio
async def test_send_alert_email_success(mocker):
    mock_settings = mocker.Mock(
        resend_api_key="test_key",
        alert_from_email="noreply@test.com"
    )
    mocker.patch("app.services.email_service.get_settings", return_value=mock_settings)
    
    mock_client_instance = mocker.AsyncMock()
    mock_response = mocker.Mock()
    mock_response.json.return_value = {"id": "12345"}
    mock_response.raise_for_status.return_value = None
    mock_client_instance.post.return_value = mock_response
    
    mock_client_class = mocker.patch("app.services.email_service.httpx.AsyncClient")
    mock_client_class.return_value.__aenter__.return_value = mock_client_instance
    
    result = await send_alert_email("test@example.com", "Test Subject", "<h1>Test HTML</h1>")
    
    assert result["ok"] is True
    assert result["status"] == "sent"
    assert result["provider_response"] == {"id": "12345"}
    
    mock_client_instance.post.assert_called_once_with(
        "https://api.resend.com/emails",
        headers={"Authorization": "Bearer test_key"},
        json={
            "from": "noreply@test.com",
            "to": ["test@example.com"],
            "subject": "Test Subject",
            "html": "<h1>Test HTML</h1>"
        }
    )

@pytest.mark.asyncio
async def test_send_alert_email_http_error(mocker):
    mock_settings = mocker.Mock(resend_api_key="test_key", alert_from_email="noreply@test.com")
    mocker.patch("app.services.email_service.get_settings", return_value=mock_settings)
    
    mock_client_instance = mocker.AsyncMock()
    mock_response = mocker.Mock()
    # Giả lập lỗi HTTP
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError("Unauthorized", request=mocker.Mock(), response=mock_response)
    mock_client_instance.post.return_value = mock_response
    
    mock_client_class = mocker.patch("app.services.email_service.httpx.AsyncClient")
    mock_client_class.return_value.__aenter__.return_value = mock_client_instance
    
    with pytest.raises(httpx.HTTPStatusError):
        await send_alert_email("test@example.com", "Test Subject", "<h1>Test HTML</h1>")
