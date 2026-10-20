"""014 T058: each style maps the neutral request to its wire format and streams deltas and usage
back, skipping thinking parts and turning in-stream errors into classified failures."""

from __future__ import annotations

import base64

import httpx
import pytest

from tests import fake_llm
from tests.streaming_asgi import StreamingASGITransport
from unihelper.ai import anthropic, gemini, openai_compat
from unihelper.ai.base import (
    AiError,
    Audio,
    ChatRequest,
    Delta,
    EndpointConfig,
    Image,
    NeutralMessage,
    NoteText,
    Pdf,
    Text,
    UsageEvent,
)
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


def convo(model: str = "echo") -> ChatRequest:
    return ChatRequest(
        model,
        [
            NeutralMessage("user", [Text("first")]),
            NeutralMessage("assistant", [Text("an answer")]),
            NeutralMessage("user", [NoteText("Lecture 5", "notes"), Text("second")]),
        ],
        system="Be brief.",
        max_tokens=1234,
    )


async def run(style: str, request: ChatRequest) -> list:  # type: ignore[type-arg]
    cfg = EndpointConfig(style, BASES[style], "local", "k")  # type: ignore[arg-type]
    async with httpx.AsyncClient(transport=StreamingASGITransport(fake_llm.app)) as http:
        return [e async for e in adapter(style).stream(http, cfg, request)]


@pytest.mark.parametrize("style", ["openai", "anthropic", "gemini"])
async def test_deltas_and_usage(style: str) -> None:
    out = await run(style, convo())
    text = "".join(e.text for e in out if isinstance(e, Delta))
    assert text == "You said: --- Note: Lecture 5 ---\nnotes second" or text.startswith("You said:")
    assert "hmm" not in text and "thinking" not in text  # thinking parts are never shown
    usage = [e for e in out if isinstance(e, UsageEvent)]
    assert usage[-1].input == 812 and usage[-1].output == 403


async def test_openai_body() -> None:
    await run("openai", convo())
    body = fake_llm.STATE["last"]["body"]
    assert body["stream"] is True and body["stream_options"] == {"include_usage": True}
    assert [m["role"] for m in body["messages"]] == ["system", "user", "assistant", "user"]
    assert body["messages"][1]["content"] == "first"  # plain strings for text-only messages


async def test_openai_retries_without_stream_options() -> None:
    fake_llm.STATE["reject_stream_options"] = True
    out = await run("openai", convo())
    assert any(isinstance(e, Delta) for e in out)
    assert "stream_options" not in fake_llm.STATE["last"]["body"]


async def test_anthropic_body() -> None:
    await run("anthropic", convo())
    request = fake_llm.STATE["last"]
    body = request["body"]
    assert request["headers"]["anthropic-version"] == "2023-06-01"
    assert body["max_tokens"] == 1234 and body["system"] == "Be brief."
    assert [m["role"] for m in body["messages"]] == ["user", "assistant", "user"]
    assert body["messages"][2]["content"][0]["text"].startswith("--- Note: Lecture 5 ---")


async def test_gemini_body() -> None:
    await run("gemini", convo())
    request = fake_llm.STATE["last"]
    body = request["body"]
    assert request["path"].endswith("/models/echo:streamGenerateContent")
    assert body["system_instruction"] == {"parts": [{"text": "Be brief."}]}
    assert [c["role"] for c in body["contents"]] == ["user", "model", "user"]
    assert body["generationConfig"]["maxOutputTokens"] == 1234


def test_attachment_parts() -> None:
    req = ChatRequest(
        "m",
        [
            NeutralMessage(
                "user",
                [
                    Text("look"),
                    Image("image/png", b"PNG"),
                    Pdf("a.pdf", b"%PDF"),
                    Audio("audio/wav", "wav", b"RIFF"),
                ],
            )
        ],
    )
    b64 = lambda d: base64.b64encode(d).decode()  # noqa: E731
    oa = openai_compat.body(req)["messages"][0]["content"]
    assert oa[1] == {
        "type": "image_url",
        "image_url": {"url": f"data:image/png;base64,{b64(b'PNG')}"},
    }
    assert oa[2]["file"] == {
        "filename": "a.pdf",
        "file_data": f"data:application/pdf;base64,{b64(b'%PDF')}",
    }
    assert oa[3] == {"type": "input_audio", "input_audio": {"data": b64(b"RIFF"), "format": "wav"}}
    ge = gemini.body(req)["contents"][0]["parts"]
    assert ge[1] == {"inline_data": {"mime_type": "image/png", "data": b64(b"PNG")}}
    assert ge[3]["inline_data"]["mime_type"] == "audio/wav"
    no_audio = ChatRequest(
        "m", [NeutralMessage("user", [Text("x"), Image("image/png", b"P"), Pdf("a.pdf", b"%PDF")])]
    )
    an = anthropic.body(no_audio)["messages"][0]["content"]
    assert an[1]["type"] == "image" and an[1]["source"]["media_type"] == "image/png"
    assert an[2] == {
        "type": "document",
        "source": {"type": "base64", "media_type": "application/pdf", "data": b64(b"%PDF")},
    }
    with pytest.raises(AiError):
        anthropic.body(req)


@pytest.mark.parametrize("style", ["openai", "anthropic", "gemini"])
async def test_midstream_error(style: str) -> None:
    with pytest.raises(AiError) as exc:
        await run(style, convo("fail-midstream"))
    assert exc.value.category in ("provider", "rate_limited")


@pytest.mark.parametrize(
    ("style", "model", "category"),
    [
        ("openai", "fail-401", "key_rejected"),
        ("anthropic", "fail-404", "model_not_found"),
        ("gemini", "fail-429", "rate_limited"),
        ("anthropic", "fail-413", "too_large"),
    ],
)
async def test_http_errors(style: str, model: str, category: str) -> None:
    with pytest.raises(AiError) as exc:
        await run(style, convo(model))
    assert exc.value.category == category
