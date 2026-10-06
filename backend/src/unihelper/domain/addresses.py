"""Provider server addresses (005 FR-007, research C3).

An API key may only travel over plain `http://` to this computer or a private network: the
host must be `localhost`, a loopback/private/link-local address, or a name whose every
resolved address is one of those. Unresolvable names count as public.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from urllib.parse import urlsplit

Resolver = Callable[[str], list[str]]
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="resolve")


@dataclass(frozen=True)
class ParsedAddress:
    scheme: str
    host: str


def parse_address(url: str) -> ParsedAddress | None:
    try:
        parts = urlsplit(url.strip())
        host = parts.hostname
        _ = parts.port  # raises on a malformed port
    except ValueError:
        return None
    if parts.scheme not in ("http", "https") or not host or parts.username or parts.password:
        return None
    if " " in url.strip():
        return None
    return ParsedAddress(parts.scheme, host.lower())


def _ip_is_local(text: str) -> bool:
    try:
        ip = ipaddress.ip_address(text.split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_loopback or ip.is_private or ip.is_link_local


def _system_resolve(host: str) -> list[str]:
    return [str(info[4][0]) for info in socket.getaddrinfo(host, None)]


def is_local_host(host: str, resolve: Resolver = _system_resolve, timeout: float = 2.0) -> bool:
    host = host.strip("[]").lower()
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        ipaddress.ip_address(host.split("%", 1)[0])
        return _ip_is_local(host)
    except ValueError:
        pass
    try:
        addresses = _pool.submit(resolve, host).result(timeout=timeout)
    except (OSError, FutureTimeout, UnicodeError):
        return False
    return bool(addresses) and all(_ip_is_local(a) for a in addresses)


def address_problem(url: str, has_key: bool, resolve: Resolver = _system_resolve) -> str | None:
    """None when acceptable, else `invalid_address` or `https_required`."""
    parsed = parse_address(url)
    if parsed is None:
        return "invalid_address"
    if has_key and parsed.scheme == "http" and not is_local_host(parsed.host, resolve):
        return "https_required"
    return None
