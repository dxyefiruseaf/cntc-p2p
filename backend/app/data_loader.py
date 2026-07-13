from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parent / "data" / "mock_data.json"


@lru_cache(maxsize=1)
def load_mock_data() -> dict:
    if not DATA_PATH.exists():
        return {}

    raw = DATA_PATH.read_text(encoding="utf-8").strip()

    # Xử lý BOM nếu có
    raw = raw.lstrip("\ufeff").strip()

    # Nếu file bị lưu dạng JS: window.MOCK_DATA = {...};
    if "=" in raw and not raw.startswith("{"):
        raw = raw.split("=", 1)[1].strip()

    # Nếu cuối file có dấu ;
    if raw.endswith(";"):
        raw = raw[:-1].strip()

    try:
        decoder = json.JSONDecoder()
        data, _ = decoder.raw_decode(raw)
        return data
    except json.JSONDecodeError:
        return {}
