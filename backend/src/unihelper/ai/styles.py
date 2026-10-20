"""The registry of request styles: what GET /ai/styles publishes and which adapter serves each
(014 contracts/provider-styles.md)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from unihelper.ai.anthropic import AnthropicAdapter
from unihelper.ai.base import ChatAdapter
from unihelper.ai.gemini import GeminiAdapter
from unihelper.ai.limits import LIMITS, MAX_ATTACHMENTS
from unihelper.ai.openai_compat import OpenAiAdapter


@dataclass(frozen=True)
class StyleInfo:
    id: str
    label: str
    example_base_urls: tuple[str, ...]
    chat_path: str
    models_path: str
    key_header: str
    images: bool
    pdf: bool
    audio: bool
    audio_possible: bool = True


STYLES: dict[str, StyleInfo] = {
    "openai": StyleInfo(
        "openai",
        "OpenAI-compatible",
        ("https://api.openai.com/v1", "http://localhost:11434/v1"),
        "/chat/completions",
        "/models",
        "Authorization: Bearer",
        images=True,
        pdf=False,
        audio=False,
    ),
    "anthropic": StyleInfo(
        "anthropic",
        "Anthropic",
        ("https://api.anthropic.com",),
        "/v1/messages",
        "/v1/models",
        "x-api-key",
        images=True,
        pdf=True,
        audio=False,
        audio_possible=False,  # the Messages API takes no audio
    ),
    "gemini": StyleInfo(
        "gemini",
        "Google Gemini",
        ("https://generativelanguage.googleapis.com",),
        "/v1beta/models/{model}:streamGenerateContent?alt=sse",
        "/v1beta/models",
        "x-goog-api-key",
        images=True,
        pdf=True,
        audio=True,
    ),
}

ADAPTERS: dict[str, ChatAdapter] = {
    "openai": OpenAiAdapter(),
    "anthropic": AnthropicAdapter(),
    "gemini": GeminiAdapter(),
}


def adapter(style: str) -> ChatAdapter:
    return ADAPTERS[style]


def default_capabilities(style: str) -> dict[str, bool]:
    info = STYLES[style]
    return {"images": info.images, "pdf": info.pdf, "audio": info.audio}


def limits_out(style: str) -> dict[str, Any]:
    lim = LIMITS[style]
    return {
        "max_attachments": MAX_ATTACHMENTS,
        "per_file_bytes": dict(lim.per_file_bytes),
        "per_message_bytes": lim.per_message_bytes,
        "max_images": lim.max_images,
        "max_pdf_pages": lim.max_pdf_pages,
        "image_types": list(lim.image_types),
        "audio_types": list(lim.audio_types),
    }


def styles_out() -> list[dict[str, Any]]:
    return [
        {
            "id": info.id,
            "label": info.label,
            "example_base_urls": list(info.example_base_urls),
            "chat_path": info.chat_path,
            "models_path": info.models_path,
            "key_header": info.key_header,
            "default_capabilities": default_capabilities(info.id),
            "limits": limits_out(info.id),
        }
        for info in STYLES.values()
    ]
