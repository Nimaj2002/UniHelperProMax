"""021 research R2–R4: proxy URL building, the local-address bypass and failure classes."""

from __future__ import annotations

import httpx
import pytest

from unihelper.domain import proxy

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "target",
    [
        "http://localhost:11434/v1",
        "http://127.0.0.1:8000",
        "http://192.168.1.5:8000",
        "http://10.0.0.2",
        "http://gpu-box:8000",
        "http://studio.local",
        "http://[::1]:8000",
    ],
)
def test_local_targets_bypass(target: str) -> None:
    assert proxy.bypasses(target)


@pytest.mark.parametrize(
    "target", ["https://api.openai.com/v1", "https://8.8.8.8", "https://api.anthropic.com"]
)
def test_remote_targets_use_proxy(target: str) -> None:
    assert not proxy.bypasses(target)


def test_proxy_url_encodes_credentials() -> None:
    url = proxy.proxy_url("socks5", "proxy.example.com", 1080, "me@uni", "p@ss:/ w")
    assert url == "socks5://me%40uni:p%40ss%3A%2F%20w@proxy.example.com:1080"
    parsed = httpx.URL(url)
    assert (parsed.username, parsed.password) == ("me@uni", "p@ss:/ w")


def test_proxy_url_variants() -> None:
    assert proxy.proxy_url("http", "::1", 8080, None, None) == "http://[::1]:8080"
    assert proxy.proxy_url("https", "p.example", 443, "me", None) == "https://me@p.example:443"


@pytest.mark.parametrize(
    ("host", "clean"),
    [
        ("Proxy.Example.com", "proxy.example.com"),
        ("10.0.0.1", "10.0.0.1"),
        ("[::1]", "::1"),
        ("::1", "::1"),
        ("gpu-box", "gpu-box"),
        ("http://x", None),
        ("a/b", None),
        ("me@host", None),
        ("host:8080", None),
        ("a b", None),
        ("-bad.example", None),
        ("", None),
    ],
)
def test_clean_host(host: str, clean: str | None) -> None:
    assert proxy.clean_host(host) == clean


@pytest.mark.parametrize(
    ("exc", "kind"),
    [
        (httpx.ProxyError("407 Proxy Authentication Required"), "credentials_rejected"),
        (httpx.ProxyError("Requested authentication method not acceptable"),
         "credentials_rejected"),
        (httpx.ProxyError("Invalid username/password"), "credentials_rejected"),
        (httpx.ProxyError("502 Bad Gateway"), "no_onward_connection"),
        (httpx.ConnectError("refused"), "unreachable"),
        (httpx.ConnectTimeout("slow"), "unreachable"),
        (httpx.ReadTimeout("slow"), None),
        (httpx.RemoteProtocolError("bad"), None),
    ],
)  # fmt: skip
def test_failure(exc: Exception, kind: str | None) -> None:
    assert proxy.failure(exc) == kind


def test_socks5_sends_host_name_not_ip() -> None:
    """Research R3: the SOCKS5 CONNECT carries the target's name, so DNS happens at the proxy
    (blocked local DNS doesn't break proxied requests)."""
    from httpcore._async.socks_proxy import _init_socks5_connection  # noqa: F401 - must exist
    from socksio import socks5

    request = socks5.SOCKS5CommandRequest.from_address(
        socks5.SOCKS5Command.CONNECT, (b"api.openai.com", 443)
    )
    assert request.atype == socks5.SOCKS5AType.DOMAIN_NAME
