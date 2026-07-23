"""Restore the Admin role for an existing Supabase account without changing its password.

Usage from the backend directory:
    python scripts/restore_admin_role.py --email admin@example.com

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")


def _value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _find_user_by_email(client: Any, email: str) -> Any | None:
    page = 1
    while page <= 20:
        response = client.auth.admin.list_users(page=page, per_page=100)
        users = _value(response, "users", response if isinstance(response, list) else []) or []
        for user in users:
            if str(_value(user, "email", "")).lower() == email.lower():
                return user
        if len(users) < 100:
            break
        page += 1
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Restore BTC BigData Admin role")
    parser.add_argument("--email", default=os.getenv("ADMIN_EMAIL", ""))
    parser.add_argument("--name", default=os.getenv("ADMIN_FULL_NAME", "BTC BigData Admin"))
    args = parser.parse_args()

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env", file=sys.stderr)
        return 2

    email = args.email.strip() or input("Admin email: ").strip()
    if "@" not in email:
        print("Admin email is invalid", file=sys.stderr)
        return 2

    client = create_client(supabase_url, service_key)
    user = _find_user_by_email(client, email)
    if user is None:
        print(f"No Supabase Auth account found for {email}", file=sys.stderr)
        return 1

    user_id = str(_value(user, "id"))
    app_metadata = dict(_value(user, "app_metadata", {}) or {})
    user_metadata = dict(_value(user, "user_metadata", {}) or {})
    full_name = str(user_metadata.get("full_name") or user_metadata.get("name") or args.name)

    client.auth.admin.update_user_by_id(user_id, {
        "app_metadata": {**app_metadata, "role": "admin"},
        "user_metadata": {**user_metadata, "full_name": full_name},
    })
    client.table("user_profiles").upsert({
        "user_id": user_id,
        "email": email,
        "full_name": full_name,
        "role": "admin",
        "status": "active",
    }, on_conflict="user_id").execute()

    print(f"Admin role restored for {email} ({user_id})")
    print("Redeploy/restart the backend, sign out, and sign in again.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
