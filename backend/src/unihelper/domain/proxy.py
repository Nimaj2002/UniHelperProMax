"""Proxy addresses and failures (021 research R2–R4), shared by the AI and transcription code.

Pure functions: the proxy URL is built only at the moment of use and never logged.
"""

from __future__ import annotations

import ipaddress
import re
from typing import Literal
from urllib.parse import quote, urlsplit

import httpx

from unihelper.domain.ai_addresses import host_locality

Failure = Literal["unreachable", "credentials_rejected", "no_onward_connection"]

MESSAGES: dict[str, str] = {
    "unreachable": "Couldn't reach the proxy. Check its address and port, or turn the proxy off.",
    "credentials_rejected": "The proxy rejected the username or password.",
    "no_onward_connection": "The proxy was reached but couldn't connect to the server.",
}
_LABEL = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$")


def clean_host(host: str) -> str | None:
    """The host as stored (IPv6 without brackets), or None when it isn't a bare host name or
    IP address — no scheme, path, port, credentials or spaces."""
    text = host.strip()
    bare = text[1:-1] if text.startswith("[") and text.endswith("]") else text
    try:
        return str(ipaddress.ip_address(bare))
    except ValueError:
        pass
    name = text.rstrip(".")
    if not name or len(name) > 253 or not all(_LABEL.match(p) for p in name.split(".")):
        return None
    return name.lower()


def proxy_url(scheme: str, host: str, port: int, username: str | None, password: str | None) -> str:
    netloc = f"[{host}]" if ":" in host else host
    if username or password:
        creds = quote(username or "", safe="")
        if password:
            creds += ":" + quote(password, safe="")
        netloc = f"{creds}@{netloc}"
    return f"{scheme}://{netloc}:{port}"


def bypasses(target_url: str) -> bool:
    """Local providers (this computer, private network) always connect directly (FR-011a)."""
    try:
        host = urlsplit(target_url.strip()).hostname
    except ValueError:
        return False
    return bool(host) and host_locality(host or "") == "local"


def failure(exc: BaseException) -> Failure | None:
    """What went wrong with the proxy, for a request that was sent through one; None when the
    error is not the proxy's (a read timeout, a protocol error from the server)."""
    if isinstance(exc, httpx.ProxyError):
        text = str(exc).lower()
        # HTTP: "407 Proxy Authentication Required"; SOCKS5: "Invalid username/password"
        if "407" in text or "auth" in text or "password" in text:
            return "credentials_rejected"
        return "no_onward_connection"
    if isinstance(exc, httpx.ConnectError | httpx.ConnectTimeout):
        return "unreachable"  # the proxy is the only host a proxied client connects to
    return None
