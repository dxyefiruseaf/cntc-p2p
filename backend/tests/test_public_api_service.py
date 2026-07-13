import pytest
import httpx
from app.services.public_api_service import fetch_public_api

@pytest.mark.asyncio
async def test_fetch_public_api_disabled(mocker):
    # Giả lập config tắt fallback
    mocker.patch("app.services.public_api_service.get_settings", return_value=mocker.Mock(use_public_api_fallback=False))
    
    result = await fetch_public_api("/test")
    assert result is None

@pytest.mark.asyncio
async def test_fetch_public_api_success(mocker):
    # Mock config
    mock_settings = mocker.Mock(use_public_api_fallback=True, public_data_api_url="http://test-api.com")
    mocker.patch("app.services.public_api_service.get_settings", return_value=mock_settings)
    
    # Mock httpx.AsyncClient
    mock_client_instance = mocker.AsyncMock()
    mock_response = mocker.Mock()
    mock_response.json.return_value = {"status": "ok", "data": "test"}
    mock_response.raise_for_status.return_value = None
    mock_client_instance.get.return_value = mock_response
    
    # Mock context manager
    mock_client_class = mocker.patch("app.services.public_api_service.httpx.AsyncClient")
    mock_client_class.return_value.__aenter__.return_value = mock_client_instance
    
    result = await fetch_public_api("/test")
    assert result == {"status": "ok", "data": "test"}
    mock_client_instance.get.assert_called_once_with("http://test-api.com/test")

@pytest.mark.asyncio
async def test_fetch_public_api_exception(mocker):
    # Mock config
    mock_settings = mocker.Mock(use_public_api_fallback=True, public_data_api_url="http://test-api.com")
    mocker.patch("app.services.public_api_service.get_settings", return_value=mock_settings)
    
    # Mock httpx.AsyncClient to raise Exception
    mock_client_instance = mocker.AsyncMock()
    mock_client_instance.get.side_effect = httpx.RequestError("Network error")
    
    mock_client_class = mocker.patch("app.services.public_api_service.httpx.AsyncClient")
    mock_client_class.return_value.__aenter__.return_value = mock_client_instance
    
    result = await fetch_public_api("/test")
    assert result is None
