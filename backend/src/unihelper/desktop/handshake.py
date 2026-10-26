"""The per-launch secrets the Electron main process passes on stdin (research R5).

`launchToken` proves the backend's identity (an HMAC of a nonce) and authorizes shutdown;
`clientSecret` is the header the main process adds to every request from the app window
(research R8). Neither value is ever logged, written to disk or put in the environment.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from typing import IO

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_NONCE = re.compile(r"^(?:[0-9a-f]{2}){16,64}$")  # 32–128 hex characters
_KEYS = {"launchToken", "clientSecret"}


class HandshakeError(ValueError):
    pass


@dataclass(frozen=True, repr=False)
class Handshake:
    launch_token: str
    client_secret: str

    def __repr__(self) -> str:
        return "Handshake(<redacted>)"

    __str__ = __repr__

    def proof(self, nonce_hex: str) -> str:
        """HMAC-SHA256 with the token's bytes as key and the nonce's bytes as message."""
        if not _NONCE.fullmatch(nonce_hex or ""):
            raise HandshakeError("bad nonce")
        key = bytes.fromhex(self.launch_token)
        return hmac.new(key, bytes.fromhex(nonce_hex), hashlib.sha256).hexdigest()

    def check_client(self, value: str | None) -> bool:
        return value is not None and hmac.compare_digest(value, self.client_secret)

    def check_bearer(self, authorization: str | None) -> bool:
        if not authorization or not authorization.startswith("Bearer "):
            return False
        return hmac.compare_digest(authorization.removeprefix("Bearer "), self.launch_token)


def parse(line: str) -> Handshake:
    try:
        data = json.loads(line)
    except (TypeError, ValueError) as exc:
        raise HandshakeError("handshake is not JSON") from exc
    if not isinstance(data, dict) or set(data) != _KEYS:
        raise HandshakeError("handshake must have exactly launchToken and clientSecret")
    token, secret = data["launchToken"], data["clientSecret"]
    if not all(isinstance(v, str) and _HEX64.fullmatch(v) for v in (token, secret)):
        raise HandshakeError("handshake values must be 64 lowercase hex characters")
    return Handshake(launch_token=token, client_secret=secret)


def read_handshake(stream: IO[str]) -> Handshake:
    """Read exactly one line; the rest of the stream stays open for the watchdog."""
    return parse(stream.readline())


_current: Handshake | None = None


def current() -> Handshake | None:
    return _current


def set_current(value: Handshake | None) -> None:
    global _current
    _current = value


set_for_tests = set_current
