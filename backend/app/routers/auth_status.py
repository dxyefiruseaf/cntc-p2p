from __future__ import annotations

from fastapi import APIRouter, Request, Response

from app.auth import get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/me")
def auth_me(request: Request, response: Response):
    """Validate the current Supabase session against application account status.

    Supabase proves identity, while ``user_profiles.status`` remains the
    application source of truth. Suspended accounts receive HTTP 403 even when
    an old access token has not expired yet.
    """
    user = get_current_user(request)
    profile = user.get("profile") or {}
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization"
    return {
        "user_id": user["id"],
        "email": user.get("email"),
        "role": profile.get("role") or "user",
        "status": profile.get("status") or "active",
        "profile": profile,
    }
