"""OpenAI-compatible chat completions (OpenAI, Ollama, LM Studio, llama.cpp, vLLM …)."""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from unihelper.ai import sse
from unihelper.ai.base import (
    AiError,
    Audio,
    ChatRequest,
    Delta,
    DiscoveredModel,
    End,
    EndpointConfig,
    Image,
    NeutralMessage,
    Pdf,
    StreamEvent,
    Style,
    UsageEvent,
    text_of,
)
from unihelper.ai.errors import in_stream_error, looks_like
from unihelper.ai.http import get_json, post_json, stream_lines


def headers(cfg: EndpointConfig) -> dict[str, str]:
    return {"Authorization": f"Bearer {cfg.api_key}"} if cfg.api_key else {}


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _content(message: NeutralMessage) -> str | list[dict[str, Any]]:
    texts = [text_of(p) for p in message.parts]
    if message.role == "assistant" or all(t is not None for t in texts):
        return "\n\n".join(t for t in texts if t)  # plain strings suit older local servers
    parts: list[dict[str, Any]] = []
    for part, text in zip(message.parts, texts, strict=True):
        if text is not None:
            parts.append({"type": "text", "text": text})
        elif isinstance(part, Image):
            parts.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{part.mime};base64,{_b64(part.data)}"},
                }
            )
        elif isinstance(part, Pdf):
            parts.append(
                {
                    "type": "file",
                    "file": {
                        "filename": part.name,
                        "file_data": f"data:application/pdf;base64,{_b64(part.data)}",
                    },
                }
            )
        elif isinstance(part, Audio):
            parts.append(
                {
                    "type": "input_audio",
                    "input_audio": {"data": _b64(part.data), "format": part.format},
                }
            )
    return parts


def body(request: ChatRequest, stream: bool = True, usage: bool = True) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []
    if request.system:
        messages.append({"role": "system", "content": request.system})
    messages += [{"role": m.role, "content": _content(m)} for m in request.messages]
    out: dict[str, Any] = {"model": request.model_id, "messages": messages, "stream": stream}
    if stream and usage:
        out["stream_options"] = {"include_usage": True}
    return out


class OpenAiAdapter:
    style: Style = "openai"

    async def list_models(
        self, http: httpx.AsyncClient, cfg: EndpointConfig
    ) -> list[DiscoveredModel]:
        data = await get_json(http, cfg, "/models", headers(cfg))
        seen = looks_like(data)
        if (
            seen not in (None, "openai")
            or not isinstance(data, dict)
            or not isinstance(data.get("data"), list)
        ):
            raise AiError(
                "not_this_style",
                "The address answered, but it doesn't look like an OpenAI-compatible service.",
                looks_like=seen,
            )
        return [
            DiscoveredModel(str(m["id"]), str(m["id"]))
            for m in data["data"]
            if isinstance(m, dict) and m.get("id")
        ]

    async def probe(self, http: httpx.AsyncClient, cfg: EndpointConfig, model_id: str) -> None:
        await post_json(
            http,
            cfg,
            "/chat/completions",
            headers(cfg),
            {
                "model": model_id,
                "messages": [{"role": "user", "content": "Hi"}],
                "max_tokens": 1,
                "stream": False,
            },
        )

    async def stream(
        self, http: httpx.AsyncClient, cfg: EndpointConfig, request: ChatRequest
    ) -> AsyncIterator[StreamEvent]:
        try:
            async for event in self._stream(http, cfg, body(request)):
                yield event
        except AiError as err:
            # some older local servers refuse `stream_options`: retry once without it
            if err.status == 400 and "stream_options" in err.message:
                async for event in self._stream(http, cfg, body(request, usage=False)):
                    yield event
            else:
                raise

    async def _stream(
        self, http: httpx.AsyncClient, cfg: EndpointConfig, payload: dict[str, Any]
    ) -> AsyncIterator[StreamEvent]:
        async with stream_lines(http, cfg, "/chat/completions", headers(cfg), payload) as lines:
            async for event in sse.parse(lines):
                if event.data.strip() == "[DONE]":
                    break
                try:
                    chunk = json.loads(event.data)
                except ValueError:
                    continue
                if isinstance(chunk, dict) and "error" in chunk:
                    raise in_stream_error("openai", chunk, cfg)
                choices = chunk.get("choices") or []
                if choices:
                    text = (choices[0].get("delta") or {}).get("content")
                    if text:
                        yield Delta(text)
                usage = chunk.get("usage")
                if isinstance(usage, dict):
                    yield UsageEvent(
                        usage.get("prompt_tokens"),
                        usage.get("completion_tokens"),
                        usage.get("total_tokens"),
                    )
        yield End()
