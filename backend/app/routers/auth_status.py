from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.auth import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _role_from_metadata(user: dict) -> str:
    app_metadata = user.get("app_metadata") or {}
    user_metadata = user.get("user_metadata") or {}
    return str(app_metadata.get("role") or user_metadata.get("role") or "").strip().lower()


@router.get("/me")
def auth_me(request: Request, response: Response):
    """Return the authenticated account and its resolved application role.

    ``user_profiles.role`` remains the preferred source. For older accounts or
    a temporarily missing profile row, the signed Supabase ``app_metadata`` role
    is used as a safe fallback. This prevents an existing admin from losing the
    Admin Console after OTP login, password changes, refreshes, or migrations.
    """
    user = get_current_user(request)
    profile = dict(user.get("profile") or {})
    metadata_role = _role_from_metadata(user)
    profile_role = str(profile.get("role") or "").strip().lower()
    # Match require_admin(): admin in either the profile or signed app_metadata
    # is sufficient. This also repairs the UI when an old profile row says user.
    resolved_role = "admin" if "admin" in {profile_role, metadata_role} else (profile_role or metadata_role or "user")
    resolved_status = str(profile.get("status") or "active").lower()

    resolved_profile = {
        **profile,
        "user_id": profile.get("user_id") or user["id"],
        "email": profile.get("email") or user.get("email"),
        "role": resolved_role,
        "status": resolved_status,
    }

    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization"
    return {
        "user_id": user["id"],
        "email": user.get("email"),
        "role": resolved_role,
        "status": resolved_status,
        "profile": resolved_profile,
    }
