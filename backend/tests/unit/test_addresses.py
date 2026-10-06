from __future__ import annotations

import pytest

from unihelper.domain.addresses import address_problem, is_local_host, parse_address

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8000",
        "https://api.openai.com",
        "https://h.example/v1/",
        "http://192.168.1.5",
    ],
)
def test_valid(url: str) -> None:
    assert parse_address(url) is not None


@pytest.mark.parametrize(
    "url",
    [
        "",
        "localhost:8000",
        "ftp://h",
        "http://",
        "https://user:pw@h",
        "http://h:99999",
        "http:// h",
    ],
)
def test_invalid(url: str) -> None:
    assert parse_address(url) is None


def fake(mapping: dict[str, list[str]]):  # type: ignore[no-untyped-def]
    def resolve(host: str) -> list[str]:
        if host not in mapping:
            raise OSError("no such host")
        return mapping[host]

    return resolve


@pytest.mark.parametrize(
    ("host", "local"),
    [
        ("localhost", True),
        ("app.localhost", True),
        ("127.0.0.1", True),
        ("::1", True),
        ("10.0.0.7", True),
        ("172.16.4.1", True),
        ("192.168.1.5", True),
        ("169.254.1.1", True),
        ("fd00::1", True),
        ("8.8.8.8", False),
        ("studio.lan", True),  # resolves to private only
        ("mixed.example", False),  # one public address is enough to be public
        ("public.example", False),
        ("unknown.example", False),  # unresolvable → public
    ],
)
def test_local_hosts(host: str, local: bool) -> None:
    resolve = fake(
        {
            "studio.lan": ["192.168.1.20"],
            "mixed.example": ["10.0.0.1", "93.184.216.34"],
            "public.example": ["93.184.216.34"],
        }
    )
    assert is_local_host(host, resolve) is local


def test_address_problem() -> None:
    resolve = fake({"public.example": ["93.184.216.34"]})
    assert address_problem("nope", has_key=False, resolve=resolve) == "invalid_address"
    assert address_problem("http://public.example", has_key=False, resolve=resolve) is None
    assert (
        address_problem("http://public.example", has_key=True, resolve=resolve) == "https_required"
    )
    assert address_problem("https://public.example", has_key=True, resolve=resolve) is None
    assert address_problem("http://localhost:8020", has_key=True, resolve=resolve) is None
