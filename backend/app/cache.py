from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock, RLock
from time import monotonic
from typing import Any, Callable, Generic, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class _CacheEntry(Generic[T]):
    value: T
    expires_at: float


class TTLCache:
    """Small thread-safe in-memory TTL cache for a single FastAPI instance.

    It deliberately has no external dependency. Entries are bounded and the
    oldest entry is evicted when the cache reaches ``max_entries``.
    """

    def __init__(self, max_entries: int = 256) -> None:
        self.max_entries = max(1, int(max_entries))
        self._entries: OrderedDict[str, _CacheEntry[Any]] = OrderedDict()
        self._lock = RLock()
        self._key_locks: dict[str, Lock] = {}

    def get(self, key: str) -> Any | None:
        now = monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= now:
                self._entries.pop(key, None)
                return None
            self._entries.move_to_end(key)
            return entry.value

    def set(self, key: str, value: T, ttl_seconds: float) -> T:
        expires_at = monotonic() + max(0.1, float(ttl_seconds))
        with self._lock:
            self._entries[key] = _CacheEntry(value=value, expires_at=expires_at)
            self._entries.move_to_end(key)
            self._remove_expired_locked()
            while len(self._entries) > self.max_entries:
                self._entries.popitem(last=False)
        return value

    def get_or_set(self, key: str, ttl_seconds: float, factory: Callable[[], T]) -> T:
        cached = self.get(key)
        if cached is not None:
            return cached

        # Prevent a cache stampede when several Admin requests arrive at the
        # same time after an entry expires.
        with self._lock:
            key_lock = self._key_locks.setdefault(key, Lock())
        try:
            with key_lock:
                cached = self.get(key)
                if cached is not None:
                    return cached
                value = factory()
                return self.set(key, value, ttl_seconds)
        finally:
            with self._lock:
                if self._key_locks.get(key) is key_lock:
                    self._key_locks.pop(key, None)

    def delete(self, key: str) -> None:
        with self._lock:
            self._entries.pop(key, None)

    def delete_prefix(self, prefix: str) -> None:
        with self._lock:
            for key in [key for key in self._entries if key.startswith(prefix)]:
                self._entries.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def _remove_expired_locked(self) -> None:
        now = monotonic()
        for key in [key for key, entry in self._entries.items() if entry.expires_at <= now]:
            self._entries.pop(key, None)
