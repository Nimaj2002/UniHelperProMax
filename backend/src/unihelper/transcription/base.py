"""The one interface every transcription provider implements (Constitution IV,
contracts/provider-interface.md). The UI only sees `ProviderSpec`s and job results."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

FieldKind = Literal["url", "secret", "text"]
ErrorCategory = Literal[
    "not_configured",
    "invalid_credentials",
    "unavailable",
    "file_rejected",
    "quota_exceeded",
    "unknown",
]

# plain-language messages; never built from provider responses (they could echo secrets)
MESSAGES: dict[ErrorCategory, str] = {
    "not_configured": "No transcription provider is set up yet.",
    "invalid_credentials": "The provider rejected the API key. Check it in Settings.",
    "unavailable": "The transcription provider couldn't be reached or is unavailable right now.",
    "file_rejected": "The provider couldn't accept this audio file.",
    "quota_exceeded": "Your provider account has run out of quota.",
    "unknown": "The transcription failed for an unknown reason.",
}


@dataclass(frozen=True)
class ProviderField:
    key: str
    label: str
    kind: FieldKind
    required: bool
    placeholder: str | None = None


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    name: str
    fields: tuple[ProviderField, ...]
    max_upload_bytes: int | None


@dataclass(frozen=True)
class AudioPart:
    data: bytes
    file_name: str
    mime_type: str
    duration_ms: int


class ProviderConfig(Protocol):
    @property
    def values(self) -> Mapping[str, str]: ...

    def secret(self) -> str | None:
        """Read at call time from the database; never cached in jobs or logged."""
        ...


Progress = Callable[[float], Awaitable[None]]


class ProviderError(Exception):
    def __init__(
        self,
        category: ErrorCategory,
        message: str | None = None,
        *,
        settings_related: bool = False,
        retryable: bool = False,
        status: int | None = None,
    ) -> None:
        self.category: ErrorCategory = category
        self.message = message or MESSAGES[category]
        self.settings_related = settings_related
        self.retryable = retryable
        self.status = status  # HTTP status, for logs only
        super().__init__(self.message)

    def __str__(self) -> str:
        return self.message


class TranscriptionProvider(Protocol):
    spec: ProviderSpec

    async def transcribe(
        self, part: AudioPart, language: str | None, config: ProviderConfig, on_progress: Progress
    ) -> str: ...

    async def test(self, config: ProviderConfig) -> None: ...
