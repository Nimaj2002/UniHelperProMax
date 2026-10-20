"""Anthropic Messages API (`anthropic-version: 2023-06-01`)."""

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

VERSION = "2023-06-01"
PAGE = 100
MAX_PAGES = 20


def headers(cfg: EndpointConfig) -> dict[str, str]:
    out = {"anthropic-version": VERSION}
    if cfg.api_key:
        out["x-api-key"] = cfg.api_key
    return out


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _blocks(message: NeutralMessage) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for part in message.parts:
        text = text_of(part)
        if text is not None:
            if text:
                blocks.append({"type": "text", "text": text})
        elif isinstance(part, Image):
            blocks.append(
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": part.mime, "data": _b64(part.data)},
                }
            )
        elif isinstance(part, Pdf):
            blocks.append(
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": _b64(part.data),
                    },
                }
            )
        elif isinstance(part, Audio):
            raise AiError("provider", "Anthropic models don't accept audio.")
    return blocks or [{"type": "text", "text": "…"}]


def body(request: ChatRequest, stream: bool = True) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []
    for message in request.messages:  # roles must alternate: merge neighbours of one role
        blocks = _blocks(message)
        if messages and messages[-1]["role"] == message.role:
            messages[-1]["content"].extend(blocks)
        else:
            messages.append({"role": message.role, "content": blocks})
    out: dict[str, Any] = {
        "model": request.model_id,
        "max_tokens": request.max_tokens,
        "messages": messages,
        "stream": stream,
    }
    if request.system:
        out["system"] = request.system
    return out


class AnthropicAdapter:
    style: Style = "anthropic"

    async def list_models(
        self, http: httpx.AsyncClient, cfg: EndpointConfig
    ) -> list[DiscoveredModel]:
        models: list[DiscoveredModel] = []
        after: str | None = None
        for _ in range(MAX_PAGES):
            params: dict[str, Any] = {"limit": PAGE} | ({"after_id": after} if after else {})
            data = await get_json(http, cfg, "/v1/models", headers(cfg), params)
            seen = looks_like(data)
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("data"), list)
                or seen not in (None, "anthropic")
            ):
                raise AiError(
                    "not_this_style",
                    "The address answered, but it doesn't look like the Anthropic API.",
                    looks_like=seen,
                )
            for m in data["data"]:
                if isinstance(m, dict) and m.get("id"):
                    models.append(
                        DiscoveredModel(
                            str(m["id"]),
                            str(m.get("display_name") or m["id"]),
                            m.get("max_input_tokens"),
                            m.get("max_tokens"),
                        )
                    )
            if not data.get("has_more") or not data.get("last_id"):
                break
            after = str(data["last_id"])
        return models

    async def probe(self, http: httpx.AsyncClient, cfg: EndpointConfig, model_id: str) -> None:
        await post_json(
            http,
            cfg,
            "/v1/messages",
            headers(cfg),
            {"model": model_id, "max_tokens": 1, "messages": [{"role": "user", "content": "Hi"}]},
        )

    async def stream(
        self, http: httpx.AsyncClient, cfg: EndpointConfig, request: ChatRequest
    ) -> AsyncIterator[StreamEvent]:
        input_tokens: int | None = None
        async with stream_lines(http, cfg, "/v1/messages", headers(cfg), body(request)) as lines:
            async for event in sse.parse(lines):
                try:
                    data = json.loads(event.data)
                except ValueError:
                    continue
                kind = event.event if event.event != "message" else data.get("type", "")
                if kind == "error":
                    raise in_stream_error("anthropic", data, cfg)
                if kind == "message_start":
                    usage = (data.get("message") or {}).get("usage") or {}
                    input_tokens = usage.get("input_tokens")
                elif kind == "content_block_delta":
                    delta = data.get("delta") or {}
                    if delta.get("type") == "text_delta" and delta.get("text"):
                        yield Delta(delta["text"])
                elif kind == "message_delta":
                    usage = data.get("usage") or {}
                    output = usage.get("output_tokens")
                    if output is not None or input_tokens is not None:
                        total = (input_tokens or 0) + (output or 0)
                        yield UsageEvent(input_tokens, output, total)
                elif kind == "message_stop":
                    break
        yield End()
