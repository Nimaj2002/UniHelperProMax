"""Base URLs of AI endpoints (014 research R5, FR-015/FR-016).

The student enters the base URL as the provider documents it; the app adds each style's
request path, ignores a trailing slash, and removes a pasted request path (saying so).

An address is **Local** when it is on this computer or a private network — an IP literal that
is loopback, private, CGNAT or link-local, or a name like `localhost`, `*.localhost`, `*.local`,
`host.docker.internal` or a single label such as `gpu-box`. Every other host is **Remote** and
must use https. No DNS lookup decides this, so a public name can't be made "Local" by pointing
it at a private address, and the result is the same on every machine.
"""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

Locality = Literal["local", "remote"]

# request paths a student may paste, longest first, per style
REQUEST_PATHS: dict[str, tuple[str, ...]] = {
    "openai": ("/chat/completions", "/completions", "/models"),
    "anthropic": ("/v1/messages", "/v1/models", "/messages", "/models", "/v1"),
    "gemini": ("/v1beta/models", "/v1/models", "/v1beta", "/v1"),
}
LOCAL_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")
LOCAL_NAMES = ("localhost", "host.docker.internal")
CGNAT = ipaddress.ip_network("100.64.0.0/10")


class AddressError(ValueError):
    def __init__(self, code: Literal["invalid_url", "https_required"], message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


INVALID = (
    "Enter a full web address, such as https://api.openai.com/v1 or http://localhost:11434/v1."
)
HTTPS_REQUIRED = (
    "Use https:// for this address. Only addresses on this computer or your local network may "
    "use plain http://."
)


@dataclass(frozen=True)
class Normalized:
    base_url: str
    removed_path: str | None
    locality: Locality


def _ip_local(host: str) -> bool | None:
    try:
        ip = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return bool(
        ip.is_loopback or ip.is_private or ip.is_link_local or (ip.version == 4 and ip in CGNAT)
    )


def host_locality(host: str) -> Locality:
    host = host.strip("[]").lower().rstrip(".")
    by_ip = _ip_local(host)
    if by_ip is not None:
        return "local" if by_ip else "remote"
    if host in LOCAL_NAMES or host.endswith(LOCAL_SUFFIXES) or "." not in host:
        return "local"
    return "remote"


def _split(url: str) -> tuple[str, str, str, str]:
    text = url.strip()
    if not text or " " in text:
        raise AddressError("invalid_url", INVALID)
    try:
        parts = urlsplit(text)
        host = parts.hostname
        _ = parts.port  # raises on a malformed port
    except ValueError as exc:
        raise AddressError("invalid_url", INVALID) from exc
    if parts.scheme.lower() not in ("http", "https") or not host:
        raise AddressError("invalid_url", INVALID)
    if parts.username or parts.password:  # credentials belong in the key field
        raise AddressError("invalid_url", INVALID)
    return parts.scheme.lower(), parts.netloc.lower(), parts.path, parts.query


def _suffix_at(style: str, path: str, suffix: str) -> int:
    lowered = path.lower()
    if style == "gemini":  # ".../v1beta/models/<model>:streamGenerateContent" keeps going
        return lowered.find(suffix)
    return len(path) - len(suffix) if lowered.endswith(suffix) else -1


def normalize(style: str, url: str) -> Normalized:
    scheme, netloc, path, query = _split(url)
    path = path.rstrip("/")
    removed = ""
    for suffix in REQUEST_PATHS.get(style, ()):
        index = _suffix_at(style, path, suffix)
        if index != -1:
            removed, path = path[index:], path[:index]
            break
    if query:
        removed += "?" + query
    host = (urlsplit(f"{scheme}://{netloc}").hostname or "").lower()
    base = urlunsplit((scheme, netloc, path.rstrip("/"), "", ""))
    return Normalized(base, removed or None, host_locality(host))


def require_secure(base_url: str, locality: Locality) -> None:
    """Remote addresses must use https; checked on save, test and every request (FR-016)."""
    if locality == "remote" and urlsplit(base_url).scheme.lower() != "https":
        raise AddressError("https_required", HTTPS_REQUIRED)
