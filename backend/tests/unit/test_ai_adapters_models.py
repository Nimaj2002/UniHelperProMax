"""014 T028/T034: model lists per style (pagination, filters, limits), the probe for typed
models, style detection, and the shared SSE parser."""

from __future__ import annotations

from collections.abc import AsyncIterator

import httpx
import pytest

from tests import fake_llm
from tests.streaming_asgi import StreamingASGITransport
from unihelper.ai import sse
from unihelper.ai.base import AiError, EndpointConfig
from unihelper.ai.http import NoModelList
from unihelper.ai.styles import adapter

pytestmark = [pytest.mark.unit, pytest.mark.anyio]

BASES = {
    "openai": "http://fake/v1",
    "anthropic": "http://fake/anthropic",
    "gemini": "http://fake/gemini",
}


@pytest.fixture(autouse=True)
def _reset() -> None:
    fake_llm.reset()


def cfg(style: str, base: str | None = None, key: str | None = "k") -> EndpointConfig:
    return EndpointConfig(style, base or BASES[style], "local", key)  # type: ignore[arg-type]


async def models(style: str, **kw: object) -> list:  # type: ignore[type-arg]
    async with httpx.AsyncClient(transport=StreamingASGITransport(fake_llm.app)) as http:
        return await adapter(style).list_models(http, cfg(style, **kw))  # type: ignore[arg-type]


async def test_openai_models() -> None:
    found = await models("openai")
    assert [m.model_id for m in found] == fake_llm.MODELS
    assert fake_llm.STATE["last"]["headers"]["authorization"] == "Bearer k"


async def test_openai_without_key_sends_no_authorization() -> None:
    await models("openai", key=None)
    assert "authorization" not in fake_llm.STATE["last"]["headers"]


async def test_anthropic_models_paginate_and_report_limits() -> None:
    found = await models("anthropic")
    assert [m.model_id for m in found] == fake_llm.MODELS
    assert found[0].display_name == "Echo" and found[0].context_limit == 200000
    first, second = fake_llm.STATE["requests"]
    assert "after_id" not in first["path"] and first["headers"]["x-api-key"] == "k"
    assert first["headers"]["anthropic-version"] == "2023-06-01"


async def test_gemini_models_paginate_and_filter() -> None:
    found = await models("gemini")
    ids = [m.model_id for m in found]
    assert ids == fake_llm.MODELS  # "models/" stripped, the embedder (no generateContent) left out
    assert found[0].context_limit == 1048576
    assert fake_llm.STATE["last"]["headers"]["x-goog-api-key"] == "k"
    assert len(fake_llm.STATE["requests"]) == 2


async def test_no_model_list() -> None:
    fake_llm.STATE["no_model_list"] = True
    with pytest.raises(NoModelList):
        await models("openai")


@pytest.mark.parametrize("style", ["openai", "anthropic"])
async def test_wrong_style_is_detected(style: str) -> None:
    with pytest.raises(AiError) as exc:
        await models(style, base="http://fake/wrong")
    assert exc.value.category == "not_this_style" and exc.value.looks_like == "gemini"


async def test_key_rejected() -> None:
    fake_llm.STATE["required_key"] = "right"
    with pytest.raises(AiError) as exc:
        await models("anthropic")
    assert exc.value.category == "key_rejected"


@pytest.mark.parametrize("style", ["openai", "anthropic", "gemini"])
async def test_probe(style: str) -> None:
    async with httpx.AsyncClient(transport=StreamingASGITransport(fake_llm.app)) as http:
        await adapter(style).probe(http, cfg(style), "echo")
        with pytest.raises(AiError) as exc:
            await adapter(style).probe(http, cfg(style), "fail-404")
    assert exc.value.category == "model_not_found"


async def test_remote_http_is_refused_before_sending() -> None:
    remote = EndpointConfig("openai", "http://example.com/v1", "remote", "secret")
    async with httpx.AsyncClient(transport=StreamingASGITransport(fake_llm.app)) as http:
        with pytest.raises(AiError) as exc:
            await adapter("openai").list_models(http, remote)
    assert exc.value.category == "https_required"
    assert fake_llm.STATE["requests"] == []  # the key never left


async def _lines(*items: str) -> AsyncIterator[str]:
    for item in items:
        yield item


async def test_sse_parser() -> None:
    events = [
        e
        async for e in sse.parse(
            _lines(": comment", "event: a", "data: 1", "data: 2", "", "data: x\r", "", "data: last")
        )
    ]
    assert [(e.event, e.data) for e in events] == [
        ("a", "1\n2"),
        ("message", "x"),
        ("message", "last"),
    ]
