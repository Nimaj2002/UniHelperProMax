"""014 T027: base URL normalisation, Local/Remote without DNS, and the https rule."""

from __future__ import annotations

import socket

import pytest

from unihelper.domain.ai_addresses import AddressError, host_locality, normalize, require_secure

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("style", "url", "base", "removed"),
    [
        ("openai", "http://localhost:11434/v1/", "http://localhost:11434/v1", None),
        (
            "openai",
            "https://api.openai.com/v1/chat/completions",
            "https://api.openai.com/v1",
            "/chat/completions",
        ),
        ("openai", "http://localhost:11434/v1/models", "http://localhost:11434/v1", "/models"),
        (
            "anthropic",
            "https://api.anthropic.com/v1/messages",
            "https://api.anthropic.com",
            "/v1/messages",
        ),
        (
            "anthropic",
            "https://api.anthropic.com/v1/models/",
            "https://api.anthropic.com",
            "/v1/models",
        ),
        ("anthropic", "https://api.anthropic.com/v1", "https://api.anthropic.com", "/v1"),
        (
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse",
            "https://generativelanguage.googleapis.com",
            "/v1beta/models/gemini-x:streamGenerateContent?alt=sse",
        ),
        (
            "gemini",
            "https://generativelanguage.googleapis.com/v1beta",
            "https://generativelanguage.googleapis.com",
            "/v1beta",
        ),
        ("openai", "HTTPS://API.Example.COM/v1?x=1", "https://api.example.com/v1", "?x=1"),
    ],
)
def test_normalize(style: str, url: str, base: str, removed: str | None) -> None:
    n = normalize(style, url)
    assert (n.base_url, n.removed_path) == (base, removed)


@pytest.mark.parametrize(
    "url", ["", "localhost:11434", "ftp://x/v1", "http://", "http://user:pw@host/v1", "http://a b"]
)
def test_invalid_urls(url: str) -> None:
    with pytest.raises(AddressError) as exc:
        normalize("openai", url)
    assert exc.value.code == "invalid_url"


@pytest.mark.parametrize(
    "host",
    [
        "localhost",
        "app.localhost",
        "printer.local",
        "host.docker.internal",
        "gpu-box",
        "127.0.0.1",
        "127.8.8.8",
        "::1",
        "[::1]",
        "10.1.2.3",
        "172.16.0.5",
        "172.31.255.1",
        "192.168.1.10",
        "100.64.0.1",
        "169.254.1.1",
        "fe80::1",
        "fd12:3456::1",
    ],
)
def test_local_hosts(host: str) -> None:
    assert host_locality(host) == "local"


@pytest.mark.parametrize(
    "host", ["example.com", "api.openai.com", "8.8.8.8", "172.32.0.1", "2001:4860:4860::8888"]
)
def test_remote_hosts(host: str) -> None:
    assert host_locality(host) == "remote"


def test_no_dns_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*_: object, **__: object) -> None:
        raise AssertionError("DNS must not decide locality")

    monkeypatch.setattr(socket, "getaddrinfo", boom)
    assert normalize("openai", "http://my-ollama.example.org/v1").locality == "remote"
    assert normalize("openai", "http://gpu-box:8000/v1").locality == "local"


def test_https_required_for_remote() -> None:
    require_secure("http://192.168.1.10/v1", "local")
    require_secure("https://example.com/v1", "remote")
    with pytest.raises(AddressError) as exc:
        require_secure("http://example.com/v1", "remote")
    assert exc.value.code == "https_required"
