import pytest
from app.repositories.market_repository import (
    get_latest_ohlcv,
    get_ohlcv,
    get_p2p_spread,
    insert_ai_history,
    upsert_ohlcv
)

def test_get_latest_ohlcv_no_client(mocker):
    mocker.patch("app.repositories.market_repository.get_supabase", return_value=None)
    assert get_latest_ohlcv() is None

def test_get_latest_ohlcv_success(mocker):
    mock_client = mocker.Mock()
    # sb.table().select().order().limit().execute()
    mock_table = mocker.Mock()
    mock_select = mocker.Mock()
    mock_order = mocker.Mock()
    mock_limit = mocker.Mock()
    mock_execute = mocker.Mock()
    
    mock_client.table.return_value = mock_table
    mock_table.select.return_value = mock_select
    mock_select.order.return_value = mock_order
    mock_order.limit.return_value = mock_limit
    mock_limit.execute.return_value = mock_execute
    
    mock_execute.data = [{"close": 60000, "timestamp": "2023-01-01"}]
    
    mocker.patch("app.repositories.market_repository.get_supabase", return_value=mock_client)
    
    result = get_latest_ohlcv()
    assert result == {"close": 60000, "timestamp": "2023-01-01"}
    mock_client.table.assert_called_with("btcusdt_ohlcv_1h")

def test_get_ohlcv_success(mocker):
    mock_client = mocker.Mock()
    mock_execute = mocker.Mock()
    mock_execute.data = [{"close": 59000}, {"close": 60000}]
    
    # We chain the mocks
    mock_client.table.return_value.select.return_value.order.return_value.limit.return_value.execute.return_value = mock_execute
    mocker.patch("app.repositories.market_repository.get_supabase", return_value=mock_client)
    
    # get_ohlcv reverses the result
    result = get_ohlcv(2)
    assert result == [{"close": 60000}, {"close": 59000}]

def test_get_p2p_spread(mocker):
    mock_client = mocker.Mock()
    mock_execute = mocker.Mock()
    mock_execute.data = [{"spread_pct": 1.5}, {"spread_pct": -1.2}]
    
    mock_client.table.return_value.select.return_value.order.return_value.limit.return_value.execute.return_value = mock_execute
    mocker.patch("app.repositories.market_repository.get_supabase", return_value=mock_client)
    
    result = get_p2p_spread(1) # should call limit(2)
    assert len(result) == 2
    mock_client.table.return_value.select.return_value.order.return_value.limit.assert_called_with(2)

def test_insert_ai_history(mocker):
    mock_client = mocker.Mock()
    mocker.patch("app.repositories.market_repository.get_supabase", return_value=mock_client)
    
    insert_ai_history({"question": "test"})
    mock_client.table.return_value.insert.assert_called_with({"question": "test"})
    mock_client.table.return_value.insert.return_value.execute.assert_called_once()

def test_upsert_ohlcv(mocker):
    mock_client = mocker.Mock()
    mocker.patch("app.repositories.market_repository.get_supabase", return_value=mock_client)
    
    rows = [{"timestamp": "2023", "close": 100}, {"timestamp": "2024", "close": 200}]
    result = upsert_ohlcv(rows)
    
    assert result == 2
    mock_client.table.return_value.upsert.assert_called_with(rows, on_conflict="timestamp")
    mock_client.table.return_value.upsert.return_value.execute.assert_called_once()
