from functools import lru_cache

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_supabase() -> Client | None:
    settings = get_settings()
    if not settings.use_supabase:
        return None
    if not settings.supabase_url or not settings.supabase_service_role_key:
        return None
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def reset_supabase_client() -> None:
    """Discard the cached sync client after a transient transport failure.

    Supabase/PostgREST uses an internal httpx connection pool. On Windows, a
    broken HTTP/2 stream can leave one pooled connection unusable and the next
    request may fail with WinError 10035. Clearing the cached client forces the
    following retry to create a fresh pool without changing normal behaviour.
    """
    get_supabase.cache_clear()
