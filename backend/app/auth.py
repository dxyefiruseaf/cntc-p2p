from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request, status

from app.supabase_client import get_supabase


def _extract_bearer_token(request: Request) -> str | None:
    header = request.headers.get("Authorization") or request.headers.get("authorization")
    if not header:
        return None
    parts = header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def _normalize_user(user_obj: Any) -> dict[str, Any]:
    # supabase-py may return an AuthResponse with `.user`, or a dict-like payload.
    user = getattr(user_obj, "user", None) or user_obj
    user_id = getattr(user, "id", None) or (user.get("id") if isinstance(user, dict) else None)
    email = getattr(user, "email", None) or (user.get("email") if isinstance(user, dict) else None)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token đăng nhập không hợp lệ")
    return {"id": str(user_id), "email": email}


def get_current_user(request: Request) -> dict[str, Any]:
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cần đăng nhập để dùng tính năng này")

    sb = get_supabase()
    if sb is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Supabase chưa được cấu hình")

    try:
        user_res = sb.auth.get_user(token)
        return _normalize_user(user_res)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token đăng nhập hết hạn hoặc không hợp lệ")


def get_optional_user(request: Request) -> dict[str, Any] | None:
    token = _extract_bearer_token(request)
    if not token:
        return None
    try:
        return get_current_user(request)
    except HTTPException:
        return None
