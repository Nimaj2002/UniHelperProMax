"""Google Gemini `streamGenerateContent` (alt=sse)."""

from __future__ import annotations

import base64
import json
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import quote

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

PAGE = 1000
MAX_PAGES = 20


def headers(cfg: EndpointConfig) -> dict[str, str]:
    return {"x-goog-api-key": cfg.api_key} if cfg.api_key else {}


def _parts(message: NeutralMessage) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for part in message.parts:
        text = text_of(part)
        if text is not None:
            if text:
                parts.append({"text": text})
        elif isinstance(part, Image | Audio):
            parts.append(
                {
                    "inline_data": {
                        "mime_type": part.mime,
                        "data": base64.b64encode(part.data).decode("ascii"),
                    }
                }
            )
        elif isinstance(part, Pdf):
            parts.append(
                {
                    "inline_data": {
                        "mime_type": "application/pdf",
                        "data": base64.b64encode(part.data).decode("ascii"),
                    }
                }
            )
    return parts or [{"text": "…"}]


def body(request: ChatRequest) -> dict[str, Any]:
    contents = [
        {"role": "model" if m.role == "assistant" else "user", "parts": _parts(m)}
        for m in request.messages
    ]
    out: dict[str, Any] = {
        "contents": contents,
        "generationConfig": {"maxOutputTokens": request.max_tokens},
    }
    if request.system:
        out["system_instruction"] = {"parts": [{"text": request.system}]}
    return out


def _model_path(model_id: str, action: str) -> str:
    name = model_id.removeprefix("models/")
    return f"/v1beta/models/{quote(name, safe='-._~')}:{action}"


class GeminiAdapter:
    style: Style = "gemini"

    async def list_models(
        self, http: httpx.AsyncClient, cfg: EndpointConfig
    ) -> list[DiscoveredModel]:
        models: list[DiscoveredModel] = []
        token: str | None = None
        for _ in range(MAX_PAGES):
            params: dict[str, Any] = {"pageSize": PAGE} | ({"pageToken": token} if token else {})
            data = await get_json(http, cfg, "/v1beta/models", headers(cfg), params)
            seen = looks_like(data)
            if (
                not isinstance(data, dict)
                or not isinstance(data.get("models"), list)
                or seen not in (None, "gemini")
            ):
                raise AiError(
                    "not_this_style",
                    "The address answered, but it doesn't look like the Gemini API.",
                    looks_like=seen,
                )
            for m in data["models"]:
                methods = m.get("supportedGenerationMethods") or []
                if isinstance(m, dict) and m.get("name") and "generateContent" in methods:
                    model_id = str(m["name"]).removeprefix("models/")
                    models.append(
                        DiscoveredModel(
                            model_id,
                            str(m.get("displayName") or model_id),
                            m.get("inputTokenLimit"),
                            m.get("outputTokenLimit"),
                        )
                    )
            token = data.get("nextPageToken")
            if not token:
                break
        return models

    async def probe(self, http: httpx.AsyncClient, cfg: EndpointConfig, model_id: str) -> None:
        await post_json(
            http,
            cfg,
            _model_path(model_id, "generateContent"),
            headers(cfg),
            {
                "contents": [{"role": "user", "parts": [{"text": "Hi"}]}],
                "generationConfig": {"maxOutputTokens": 1},
            },
        )

    async def stream(
        self, http: httpx.AsyncClient, cfg: EndpointConfig, request: ChatRequest
    ) -> AsyncIterator[StreamEvent]:
        path = _model_path(request.model_id, "streamGenerateContent") + "?alt=sse"
        async with stream_lines(http, cfg, path, headers(cfg), body(request)) as lines:
            async for event in sse.parse(lines):
                try:
                    data = json.loads(event.data)
                except ValueError:
                    continue
                if isinstance(data, dict) and "error" in data:
                    raise in_stream_error("gemini", data, cfg)
                candidates = data.get("candidates") or []
                if candidates:
                    first = candidates[0]
                    for part in (first.get("content") or {}).get("parts") or []:
                        if part.get("text") and not part.get("thought"):
                            yield Delta(part["text"])
                    if first.get("finishReason") in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST"):
                        raise AiError("provider", "The provider blocked this answer.")
                usage = data.get("usageMetadata")
                if isinstance(usage, dict) and usage:
                    yield UsageEvent(
                        usage.get("promptTokenCount"),
                        usage.get("candidatesTokenCount"),
                        usage.get("totalTokenCount"),
                    )
        yield End()
