"""One interface for every AI request style (014 contracts/provider-styles.md, Principle IV).

The chat code builds a style-neutral `ChatRequest`; each adapter maps it to its provider's wire
format, streams `Delta`/`UsageEvent`/`End` back and turns failures into `AiError` with one of
the categories of research R6. Adding a fourth style needs no UI change: the UI discovers the
styles through `GET /ai/styles`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal, Protocol

import httpx

Category = Literal[
    "network",
    "timeout",
    "key_rejected",
    "key_unreadable",
    "rate_limited",
    "model_not_found",
    "too_large",
    "context_exceeded",
    "provider",
    "not_this_style",
    "https_required",
]
Style = Literal["openai", "anthropic", "gemini"]

CONNECT_TIMEOUT = 10.0
READ_TIMEOUT = 120.0  # first byte and between chunks
DEFAULT_MAX_TOKENS = 4096
MAX_TOKENS_CAP = 8192


class AiError(Exception):
    def __init__(
        self,
        category: Category,
        message: str,
        retry_after_seconds: int | None = None,
        looks_like: Style | None = None,
        status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.category = category
        self.message = message
        self.retry_after_seconds = retry_after_seconds
        self.looks_like = looks_like
        self.status = status


@dataclass(frozen=True)
class EndpointConfig:
    style: Style
    base_url: str
    locality: Literal["local", "remote"]
    api_key: str | None = field(default=None, repr=False)


# ───────────────────────────── neutral request parts ─────────────────────────────


@dataclass(frozen=True)
class Text:
    text: str


@dataclass(frozen=True)
class NoteText:
    title: str
    text: str = field(repr=False)


@dataclass(frozen=True)
class Image:
    mime: str
    data: bytes = field(repr=False)


@dataclass(frozen=True)
class Pdf:
    name: str
    data: bytes = field(repr=False)


@dataclass(frozen=True)
class PdfText:
    name: str
    text: str = field(repr=False)


@dataclass(frozen=True)
class Audio:
    mime: str
    format: str  # wav, mp3, ogg, … (OpenAI's input_audio takes only wav/mp3)
    data: bytes = field(repr=False)


Part = Text | NoteText | Image | Pdf | PdfText | Audio


@dataclass
class NeutralMessage:
    role: Literal["user", "assistant"]
    parts: list[Part]


@dataclass
class ChatRequest:
    model_id: str
    messages: list[NeutralMessage]
    system: str | None = None
    max_tokens: int = DEFAULT_MAX_TOKENS


def text_of(part: Part) -> str | None:
    """Plain text for text-like parts (notes and extracted PDF text are sent as text)."""
    if isinstance(part, Text):
        return part.text
    if isinstance(part, NoteText):
        return f"--- Note: {part.title} ---\n{part.text}"
    if isinstance(part, PdfText):
        return f"--- PDF text: {part.name} ---\n{part.text}"
    return None


# ───────────────────────────── stream events ─────────────────────────────


@dataclass(frozen=True)
class Delta:
    text: str


@dataclass(frozen=True)
class UsageEvent:
    input: int | None = None
    output: int | None = None
    total: int | None = None


@dataclass(frozen=True)
class End:
    finish_reason: str | None = None


StreamEvent = Delta | UsageEvent | End


@dataclass(frozen=True)
class DiscoveredModel:
    model_id: str
    display_name: str
    context_limit: int | None = None
    output_limit: int | None = None


class ChatAdapter(Protocol):
    style: Style

    async def list_models(
        self, http: httpx.AsyncClient, cfg: EndpointConfig
    ) -> list[DiscoveredModel]: ...

    async def probe(self, http: httpx.AsyncClient, cfg: EndpointConfig, model_id: str) -> None: ...

    def stream(
        self, http: httpx.AsyncClient, cfg: EndpointConfig, request: ChatRequest
    ) -> AsyncIterator[StreamEvent]: ...


def timeouts() -> httpx.Timeout:
    return httpx.Timeout(READ_TIMEOUT, connect=CONNECT_TIMEOUT)
