"""In-process login throttling (no extra infrastructure — Constitution VII).

After 5 consecutive failures for the same (username, client IP), further attempts are refused
with exponential backoff: 2, 4, 8 … seconds, capped at 15 minutes. A success resets the key.
"""

from __future__ import annotations

import math
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

FREE_FAILURES = 5
MAX_LOCK_SECONDS = 15 * 60


@dataclass
class _Entry:
    failures: int = 0
    locked_until: float = 0.0


class LoginThrottle:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._entries: dict[tuple[str, str], _Entry] = {}
        self._lock = threading.Lock()

    def retry_after(self, username: str, ip: str) -> int:
        """Seconds the caller must wait, or 0 if an attempt is allowed now."""
        with self._lock:
            e = self._entries.get((username.lower(), ip))
            if e is None:
                return 0
            remaining = e.locked_until - self._clock()
            return max(0, int(math.ceil(remaining)))

    def failure(self, username: str, ip: str) -> None:
        with self._lock:
            e = self._entries.setdefault((username.lower(), ip), _Entry())
            e.failures += 1
            if e.failures >= FREE_FAILURES:
                lock = min(2 ** (e.failures - FREE_FAILURES + 1), MAX_LOCK_SECONDS)
                e.locked_until = self._clock() + lock

    def success(self, username: str, ip: str) -> None:
        with self._lock:
            self._entries.pop((username.lower(), ip), None)
