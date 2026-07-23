from __future__ import annotations

from hashlib import sha256
from typing import Any

from fastapi import HTTPException, Request, status

from app.cache import TTLCache
from app.supabase_client import get_supabase

_AUTH_CACHE = TTLCache(max_entries=10_000)
_PROFILE_CACHE = TTLCache(max_entries=10_000)
AUTH_CACHE_SECONDS = 20
PROFILE_CACHE_SECONDS = 10


def _token_cache_key(token: str) -> str:
    return f"auth:token:{sha256(token.encode('utf-8')).hexdigest()}"


def invalidate_user_auth_cache(user_id: str | None = None) -> None:
    # Token keys cannot be mapped back to a user without maintaining another
    # unbounded index, so status/role changes clear the small bounded cache.
    _AUTH_CACHE.clear()
    if user_id:
        _PROFILE_CACHE.delete(f"auth:profile:{user_id}")
    else:
        _PROFILE_CACHE.clear()


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

    cache_key = _token_cache_key(token)
    cached = _AUTH_CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        user_res = sb.auth.get_user(token)
        user = _normalize_user(user_res)
        profile = get_user_profile(user["id"], raise_on_error=True)
        if str((profile or {}).get("status") or "active").lower() != "active":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tài khoản đã bị tạm khóa")
        if profile:
            user["profile"] = profile
        return _AUTH_CACHE.set(cache_key, user, AUTH_CACHE_SECONDS)
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


def get_user_profile(user_id: str, *, raise_on_error: bool = False) -> dict[str, Any] | None:
    """Load the application profile for an authenticated user.

    The auth token proves identity; the profile table is the source of truth for
    application role/status. A missing table/profile is treated as a normal user
    so older deployments keep working until the SQL migration is applied.
    """
    cache_key = f"auth:profile:{user_id}"
    cached = _PROFILE_CACHE.get(cache_key)
    if cached is not None:
        return dict(cached) if cached else None

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
        profile = res.data[0] if res.data else None
        _PROFILE_CACHE.set(cache_key, profile or {}, PROFILE_CACHE_SECONDS)
        return profile
    except Exception as exc:
        if raise_on_error:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Không kiểm tra được trạng thái tài khoản. Vui lòng thử lại.",
            ) from exc
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
