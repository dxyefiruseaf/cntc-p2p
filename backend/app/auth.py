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


def _object_value(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _normalize_user(user_obj: Any) -> dict[str, Any]:
    # supabase-py may return an AuthResponse with `.user`, or a dict-like payload.
    user = getattr(user_obj, "user", None) or user_obj
    user_id = _object_value(user, "id")
    email = _object_value(user, "email")
    app_metadata = _object_value(user, "app_metadata", {}) or {}
    user_metadata = _object_value(user, "user_metadata", {}) or {}
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token đăng nhập không hợp lệ")
    return {
        "id": str(user_id),
        "email": email,
        "app_metadata": app_metadata if isinstance(app_metadata, dict) else {},
        "user_metadata": user_metadata if isinstance(user_metadata, dict) else {},
    }


def get_current_user(request: Request) -> dict[str, Any]:
    token = _extract_bearer_token(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Cần đăng nhập để dùng tính năng này")

    sb = get_supabase()
    if sb is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Supabase chưa được cấu hình")

    try:
        user_res = sb.auth.get_user(token)
        user = _normalize_user(user_res)
        profile = get_user_profile(user["id"])
        if str((profile or {}).get("status") or "active").lower() != "active":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị tạm khóa")
        if profile:
            user["profile"] = profile
        return user
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


def get_user_profile(user_id: str) -> dict[str, Any] | None:
    """Load the application profile for an authenticated user.

    The auth token proves identity; the profile table is the source of truth for
    application role/status. A missing table/profile is treated as a normal user
    so older deployments keep working until the SQL migration is applied.
    """
    sb = get_supabase()
    if sb is None:
        return None
    try:
        res = (
            sb.table("user_profiles")
            .select("user_id,email,full_name,role,status,password_set,created_at,last_login_at")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception:
        return None


def require_admin(request: Request) -> dict[str, Any]:
    """Return the current admin or raise 403.

    Role is checked server-side. Frontend route hiding is only presentation and
    is never relied on for authorization.
    """
    user = get_current_user(request)
    profile = user.get("profile") or get_user_profile(user["id"])
    metadata_role = str(
        user.get("app_metadata", {}).get("role")
        or user.get("user_metadata", {}).get("role")
        or ""
    ).lower()
    profile_role = str((profile or {}).get("role") or "").lower()
    account_status = str((profile or {}).get("status") or "active").lower()

    if account_status != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản quản trị đang bị khóa")
    if profile_role != "admin" and metadata_role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Chỉ tài khoản admin được phép truy cập")

    return {**user, "profile": profile or {"role": "admin", "status": "active"}}
