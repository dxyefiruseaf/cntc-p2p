"""Create or promote a BTC BigData admin account in Supabase.

Examples:
  python scripts/create_admin.py --email admin@example.com --password "StrongPass!123"
  ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD="StrongPass!123" python scripts/create_admin.py

The script needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from backend/.env.
Do not put the service-role key in the frontend.
"""
from __future__ import annotations

import argparse
import os
import sys
from getpass import getpass
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
            return None
        page += 1
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Create or promote a BTC BigData admin account")
    parser.add_argument("--email", default=os.getenv("ADMIN_EMAIL", ""))
    parser.add_argument("--password", default=os.getenv("ADMIN_PASSWORD", ""))
    parser.add_argument("--name", default=os.getenv("ADMIN_FULL_NAME", "BTC BigData Admin"))
    args = parser.parse_args()

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not supabase_url or not service_key:
        print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env", file=sys.stderr)
        return 2

    email = args.email.strip() or input("Admin email: ").strip()
    password = args.password or getpass("Admin password (8+ chars): ")
    if "@" not in email:
        print("Admin email is invalid", file=sys.stderr)
        return 2
    if len(password) < 8:
        print("Admin password must contain at least 8 characters", file=sys.stderr)
        return 2

    client = create_client(supabase_url, service_key)
    user = _find_user_by_email(client, email)

    if user is None:
        response = client.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True,
            "app_metadata": {"role": "admin"},
            "user_metadata": {"full_name": args.name, "password_set": True},
        })
        user = _value(response, "user") or response
        action = "created"
    else:
        user_id = str(_value(user, "id"))
        response = client.auth.admin.update_user_by_id(user_id, {
            "password": password,
            "app_metadata": {**(_value(user, "app_metadata", {}) or {}), "role": "admin"},
            "user_metadata": {
                **(_value(user, "user_metadata", {}) or {}),
                "full_name": args.name,
                "password_set": True,
            },
        })
        user = _value(response, "user") or user
        action = "promoted"

    user_id = str(_value(user, "id"))
    client.table("user_profiles").upsert({
        "user_id": user_id,
        "email": email,
        "full_name": args.name,
        "role": "admin",
        "status": "active",
        "password_set": True,
    }, on_conflict="user_id").execute()

    print(f"Admin account {action}: {email}")
    print("Open the website, sign in with password, then use the Admin Console link.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
