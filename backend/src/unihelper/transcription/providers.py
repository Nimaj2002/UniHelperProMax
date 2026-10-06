"""Registered providers (B1/B2). Adding one = a spec + an adapter here; no UI or API change."""

from __future__ import annotations

import httpx

from unihelper.transcription.base import (
    AudioPart,
    Progress,
    ProviderConfig,
    ProviderError,
    ProviderField,
    ProviderSpec,
    TranscriptionProvider,
)
from unihelper.transcription.openai_client import OpenAITranscriptionClient

ADDRESS = ProviderField("address", "Server address", "url", True, "http://localhost:8000")

VOICE_STUDIO = ProviderSpec(
    id="voice-studio",
    name="Voice Studio",
    fields=(ADDRESS, ProviderField("model", "Model", "text", False, "whisper-1")),
    max_upload_bytes=None,
)
OPENAI_COMPATIBLE = ProviderSpec(
    id="openai-compatible",
    name="OpenAI-compatible",
    fields=(
        ProviderField("address", "Server address", "url", True, "https://api.openai.com"),
        ProviderField("apiKey", "API key", "secret", True),
        ProviderField("model", "Model", "text", True, "whisper-1"),
    ),
    max_upload_bytes=25 * 1024 * 1024,
)


class OpenAIStyleProvider:
    """An OpenAI transcription API endpoint, with or without a key."""

    def __init__(self, spec: ProviderSpec, http: httpx.AsyncClient, uses_key: bool) -> None:
        self.spec = spec
        self.client = OpenAITranscriptionClient(http)
        self.uses_key = uses_key

    def _key(self, config: ProviderConfig) -> str | None:
        if not self.uses_key:
            return None
        key = config.secret()
        if not key:
            raise ProviderError(
                "invalid_credentials",
                "No API key is saved for this provider. Add it in Settings → Transcription.",
                settings_related=True,
            )
        return key

    async def transcribe(
        self, part: AudioPart, language: str | None, config: ProviderConfig, on_progress: Progress
    ) -> str:
        values = config.values
        return await self.client.transcribe(
            values.get("address", ""),
            part,
            model=values.get("model") or "whisper-1",
            language=language,
            api_key=self._key(config),
            on_progress=on_progress,
            provider_id=self.spec.id,
        )

    async def test(self, config: ProviderConfig) -> None:
        model = config.values.get("model") if self.uses_key else None
        await self.client.test(
            config.values.get("address", ""), self._key(config), self.spec.id, model
        )


SPECS: dict[str, ProviderSpec] = {s.id: s for s in (VOICE_STUDIO, OPENAI_COMPATIBLE)}


def all_specs() -> list[ProviderSpec]:
    return list(SPECS.values())


def build(provider_id: str, http: httpx.AsyncClient) -> TranscriptionProvider:
    if provider_id == VOICE_STUDIO.id:
        return OpenAIStyleProvider(VOICE_STUDIO, http, uses_key=False)
    if provider_id == OPENAI_COMPATIBLE.id:
        return OpenAIStyleProvider(OPENAI_COMPATIBLE, http, uses_key=True)
    raise ProviderError("not_configured", settings_related=True)
