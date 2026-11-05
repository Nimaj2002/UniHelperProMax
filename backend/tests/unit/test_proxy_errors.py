"""021 research R4: proxy failures name the proxy; direct connections keep their old messages."""

from __future__ import annotations

from dataclasses import replace

import httpx
import pytest

from unihelper.ai.base import EndpointConfig
from unihelper.ai.errors import MESSAGES, classify_exception
from unihelper.transcription.openai_client import (
    MSG_UNREACHABLE,
    OpenAITranscriptionClient,
    _transport_error,
)
from unihelper.transcription.openai_client import (
    test_reason as reason_for,
)

pytestmark = pytest.mark.unit
CFG = EndpointConfig(style="openai", base_url="https://api.example.com/v1", locality="remote")


@pytest.mark.parametrize(
    ("exc", "start"),
    [
        (httpx.ConnectError("refused"), "Couldn't reach the proxy"),
        (httpx.ProxyError("407 Proxy Authentication Required"), "The proxy rejected"),
        (httpx.ProxyError("502 Bad Gateway"), "The proxy was reached"),
    ],
)
def test_ai_proxied(exc: Exception, start: str) -> None:
    error = classify_exception(exc, replace(CFG, proxy="http://127.0.0.1:9"))
    assert error.category == "proxy"
    assert error.message.startswith(start)


def test_ai_proxied_read_timeout_is_still_a_timeout() -> None:
    assert classify_exception(
        httpx.ReadTimeout("x"), replace(CFG, proxy="http://127.0.0.1:9")
    ).category == ("timeout")


def test_ai_direct_unchanged() -> None:
    error = classify_exception(httpx.ConnectError("refused"), CFG)
    assert (error.category, error.message) == ("network", MESSAGES["network"])


def test_transcription_proxied_and_direct() -> None:
    err = _transport_error(httpx.ConnectError("refused"), proxied=True)
    assert err.category == "unavailable" and err.message.startswith("Couldn't reach the proxy")
    assert err.retryable and err.settings_related
    assert reason_for(err) == "proxy"
    auth = _transport_error(httpx.ProxyError("Invalid username/password"), proxied=True)
    assert not auth.retryable
    direct = _transport_error(httpx.ConnectError("refused"))
    assert direct.message == MSG_UNREACHABLE and reason_for(direct) == "unreachable"


@pytest.mark.anyio
async def test_transcription_client_uses_proxied_flag() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = OpenAITranscriptionClient(http, proxied=True)
        with pytest.raises(Exception) as info:
            await client.test("https://api.example.com", "sk-x", "openai-compatible", "whisper-1")
    assert "proxy" in str(getattr(info.value, "message", "")).lower()
