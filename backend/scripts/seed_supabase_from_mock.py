"""Seed dữ liệu demo từ app/data/mock_data.json lên Supabase.

Cách chạy:
  cd backend
  cp .env.example .env
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


def main():
    load_dotenv(ROOT / ".env")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong backend/.env", file=sys.stderr)
        sys.exit(1)

    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    sb = create_client(url, key)

    ohlcv = data["ohlcv"]["data"]
    p2p = data["p2p"]["data"]

    print(f"Upserting {len(ohlcv)} OHLCV rows...")
    for batch in chunks(ohlcv):
        sb.table("btcusdt_ohlcv_1h").upsert(batch, on_conflict="timestamp").execute()

    print(f"Upserting {len(p2p)} P2P rows...")
    for batch in chunks(p2p):
        sb.table("p2p_spread_history").upsert(batch, on_conflict="timestamp,trade_type").execute()

    print("Done.")


if __name__ == "__main__":
    main()
