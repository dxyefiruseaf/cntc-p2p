"""Seed dữ liệu demo từ app/data/mock_data.json lên Supabase.

Cách chạy:
  cd backend
  copy .env.example .env
  # điền SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  python scripts/seed_supabase_from_mock.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "app" / "data" / "mock_data.json"


def chunks(items, size=500):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def read_mock_data(path: Path) -> dict:
    if not path.exists():
        print(f"Không tìm thấy file mock data: {path}", file=sys.stderr)
        sys.exit(1)

    raw = path.read_text(encoding="utf-8").strip()

    # Xử lý BOM nếu có
    raw = raw.lstrip("\ufeff").strip()

    # Nếu file bị lưu dạng JS: window.MOCK_DATA = {...};
    if "=" in raw and not raw.startswith("{"):
        raw = raw.split("=", 1)[1].strip()

    # Nếu cuối file có dấu ;
    if raw.endswith(";"):
        raw = raw[:-1].strip()

    # Đọc object JSON đầu tiên, bỏ phần dư nếu có
    try:
        decoder = json.JSONDecoder()
        data, _ = decoder.raw_decode(raw)
        return data
    except json.JSONDecodeError as e:
        print("File mock_data.json vẫn chưa phải JSON hợp lệ.", file=sys.stderr)
        print(f"Lỗi: {e}", file=sys.stderr)
        print(f"File đang đọc: {path}", file=sys.stderr)
        sys.exit(1)


def main():
    load_dotenv(ROOT / ".env")

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print(
            "Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong backend/.env",
            file=sys.stderr,
        )
        sys.exit(1)

    data = read_mock_data(DATA_PATH)

    if "ohlcv" not in data or "p2p" not in data:
        print("mock_data.json phải có 2 key chính: ohlcv và p2p", file=sys.stderr)
        print(f"Các key hiện có: {list(data.keys())}", file=sys.stderr)
        sys.exit(1)

    ohlcv = data["ohlcv"].get("data", [])
    p2p = data["p2p"].get("data", [])

    sb = create_client(url, key)

    print(f"Upserting {len(ohlcv)} OHLCV rows...")
    for batch in chunks(ohlcv):
        sb.table("btcusdt_ohlcv_1h").upsert(
            batch,
            on_conflict="timestamp",
        ).execute()

    print(f"Upserting {len(p2p)} P2P rows...")
    for batch in chunks(p2p):
        sb.table("p2p_spread_history").upsert(
            batch,
            on_conflict="timestamp,trade_type",
        ).execute()

    print("Done.")


if __name__ == "__main__":
    main()