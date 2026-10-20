from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.common import ApiModel
from unihelper.schemas.transcription import LANGUAGE


class SecretState(ApiModel):
    configured: bool
    last4: str | None
    readable: bool = True  # 014: false when the secret store can't decrypt it


class ProviderSettings(ApiModel):
    provider_id: str
    values: dict[str, str]
    secret: SecretState
    status: Literal["not_configured", "not_tested", "connected", "failed"]
    last_error: str | None
    tested_at: str | None


class TranscriptionSettings(ApiModel):
    active_provider_id: str | None
    default_language: str
    providers: list[ProviderSettings]


class ProviderSave(ApiModel):
    provider_id: str
    values: dict[str, str]
    # absent = keep the saved key, string = replace, null = remove (FR-010)
    api_key: str | None = Field(default=None, max_length=500)


class TranscriptionSettingsSave(ApiModel):
    active_provider_id: str
    default_language: str = Field(pattern=LANGUAGE.pattern)
    provider: ProviderSave


class ConnectionTest(ApiModel):
    provider_id: str
    values: dict[str, str]
    api_key: str | None = Field(default=None, max_length=500)
    use_saved_key: bool = False


class ConnectionTestResult(ApiModel):
    ok: bool
    category: (
        Literal[
            "unreachable",
            "timeout",
            "invalid_credentials",
            "model_not_found",
            "not_a_transcription_service",
            "unknown",
        ]
        | None
    )
    message: str | None
