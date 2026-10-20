"""014 T029: provider failures become the categories of research R6, with scrubbed messages."""

from __future__ import annotations

import json

import httpx
import pytest

from unihelper.ai.base import EndpointConfig
from unihelper.ai.errors import classify_exception, classify_response, looks_like, scrub

pytestmark = pytest.mark.unit

CFG = EndpointConfig("openai", "https://api.example.com/v1", "remote", "sk-secret-key-123456")
LOCAL = EndpointConfig("openai", "http://localhost:11434/v1", "local", None)


def j(body: object) -> str:
    return json.dumps(body)


OPENAI = lambda code, msg="m": j({"error": {"message": msg, "type": "x", "code": code}})  # noqa: E731
ANTHROPIC = lambda kind, msg="m": j({"type": "error", "error": {"type": kind, "message": msg}})  # noqa: E731
GOOGLE = lambda code, status, msg="m", details=None: j(  # noqa: E731
    {"error": {"code": code, "status": status, "message": msg, "details": details or []}}
)


@pytest.mark.parametrize(
    ("style", "status", "body", "category"),
    [
        ("openai", 401, OPENAI("invalid_api_key"), "key_rejected"),
        ("openai", 404, OPENAI("model_not_found"), "model_not_found"),
        ("openai", 413, OPENAI(None, "too big"), "too_large"),
        ("openai", 429, OPENAI("rate_limit_exceeded"), "rate_limited"),
        ("openai", 400, OPENAI("context_length_exceeded"), "context_exceeded"),
        ("openai", 500, OPENAI(None, "boom"), "provider"),
        ("anthropic", 401, ANTHROPIC("authentication_error"), "key_rejected"),
        ("anthropic", 403, ANTHROPIC("permission_error"), "key_rejected"),
        ("anthropic", 404, ANTHROPIC("not_found_error"), "model_not_found"),
        ("anthropic", 413, ANTHROPIC("request_too_large"), "too_large"),
        ("anthropic", 429, ANTHROPIC("rate_limit_error"), "rate_limited"),
        ("anthropic", 529, ANTHROPIC("overloaded_error"), "provider"),
        ("gemini", 403, GOOGLE(403, "PERMISSION_DENIED"), "key_rejected"),
        ("gemini", 404, GOOGLE(404, "NOT_FOUND"), "model_not_found"),
        ("gemini", 429, GOOGLE(429, "RESOURCE_EXHAUSTED"), "rate_limited"),
        (
            "gemini",
            400,
            GOOGLE(400, "INVALID_ARGUMENT", "Request payload size exceeds the limit"),
            "too_large",
        ),
        ("openai", 200, j({"models": [{"name": "models/x"}]}), "not_this_style"),
        ("openai", 404, ANTHROPIC("not_found_error"), "not_this_style"),
        ("anthropic", 200, "<html>nginx</html>", "not_this_style"),
    ],
)
def test_categories(style: str, status: int, body: str, category: str) -> None:
    cfg = EndpointConfig(style, CFG.base_url, "remote", CFG.api_key)  # type: ignore[arg-type]
    assert classify_response(style, status, body, None, cfg).category == category  # type: ignore[arg-type]


def test_retry_after_from_header_and_retry_info() -> None:
    header = classify_response("openai", 429, OPENAI("rate"), httpx.Headers({"retry-after": "7"}))
    assert header.retry_after_seconds == 7
    info = classify_response(
        "gemini",
        429,
        GOOGLE(
            429,
            "RESOURCE_EXHAUSTED",
            details=[{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "12s"}],
        ),
        None,
    )
    assert info.retry_after_seconds == 12
    none = classify_response("anthropic", 429, ANTHROPIC("rate_limit_error"), None)
    assert none.retry_after_seconds is None


def test_not_this_style_names_the_style() -> None:
    err = classify_response("openai", 200, j({"models": [{"name": "models/x"}]}), None)
    assert err.looks_like == "gemini"
    assert (
        looks_like(j and {"data": [{"type": "model", "id": "c"}], "has_more": False}) == "anthropic"
    )
    assert looks_like({"object": "list", "data": [{"id": "gpt", "object": "model"}]}) == "openai"


def test_scrub_removes_keys_and_limits_length() -> None:
    text = (
        "bad key sk-secret-key-123456 and AIzaSyA1234567890abcdefghij and "
        "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 done " + "x" * 600
    )
    out = scrub(text, CFG.api_key)
    assert "sk-secret" not in out and "AIza" not in out and "ABCDEFGHIJKLMNOP" not in out
    assert "[redacted]" in out and len(out) <= 500
    err = classify_response(
        "openai", 500, OPENAI(None, "Incorrect key sk-secret-key-123456"), None, CFG
    )
    assert CFG.api_key not in err.message  # type: ignore[operator]


def test_exceptions() -> None:
    assert classify_exception(httpx.ConnectTimeout("t"), CFG).category == "timeout"
    refused = classify_exception(httpx.ConnectError("refused"), LOCAL)
    assert refused.category == "network" and "“localhost”" in refused.message
    remote = classify_exception(httpx.ConnectError("refused"), CFG)
    assert remote.category == "network" and "localhost" not in remote.message
