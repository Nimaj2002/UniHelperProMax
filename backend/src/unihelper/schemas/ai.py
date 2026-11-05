"""AI endpoints, models, settings and the secret store (014 contracts/openapi.yaml)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator

from unihelper.schemas.common import ApiModel

Style = Literal["openai", "anthropic", "gemini"]
Locality = Literal["local", "remote"]


class KeyState(ApiModel):
    """`SecretState` in the contract: never the key, at most its last 4 characters."""

    configured: bool
    masked: str | None
    readable: bool


class SecretStoreStatus(ApiModel):
    store: Literal["os_key_store", "key_file"]
    protection_note: str | None
    readable: bool
    unreadable_secrets: int
    migration: Literal["done", "failed", "not_needed", "pending"]
    migration_message: str | None


class SecretReset(ApiModel):
    confirm: Literal[True]


class Capabilities(ApiModel):
    images: bool
    pdf: bool
    audio: bool


class Limits(ApiModel):
    max_attachments: int
    per_file_bytes: dict[str, int]
    per_message_bytes: int
    max_images: int | None
    max_pdf_pages: int | None
    image_types: list[str]
    audio_types: list[str]


class AiStyle(ApiModel):
    id: Style
    label: str
    example_base_urls: list[str]
    chat_path: str
    models_path: str
    key_header: str
    default_capabilities: Capabilities
    limits: Limits


class BaseUrlCheck(ApiModel):
    style: Style
    base_url: str = Field(max_length=2048)


class BaseUrlResult(ApiModel):
    base_url: str
    removed_path: str | None
    locality: Locality


class AiModelOut(ApiModel):
    id: str
    model_id: str
    display_name: str
    capabilities: Capabilities
    hidden: bool
    source: Literal["fetched", "manual"]
    context_limit: int | None
    output_limit: int | None


class AiModelInput(ApiModel):
    id: str | None = None
    model_id: str = Field(min_length=1, max_length=200)
    display_name: str = Field(min_length=1, max_length=80)
    capabilities: Capabilities
    hidden: bool = False
    source: Literal["fetched", "manual"] = "manual"
    context_limit: int | None = Field(default=None, ge=1)
    output_limit: int | None = Field(default=None, ge=1)

    @field_validator("model_id", "display_name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class AiEndpointOut(ApiModel):
    id: str
    name: str
    style: Style
    base_url: str
    locality: Locality
    enabled: bool
    key: KeyState
    models: list[AiModelOut]
    privacy_acknowledged: bool
    version: int


class AiEndpointCreate(ApiModel):
    name: str = Field(min_length=1, max_length=60)
    style: Style
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: str | None = Field(default=None, max_length=4096)
    enabled: bool = True
    models: list[AiModelInput] = Field(default_factory=list, max_length=500)


class AiEndpointUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    style: Style | None = None
    base_url: str | None = Field(default=None, min_length=1, max_length=2048)
    # absent = keep the saved key, string = replace, null = remove (as for transcription)
    api_key: str | None = Field(default=None, max_length=4096)
    enabled: bool | None = None
    models: list[AiModelInput] | None = Field(default=None, max_length=500)


class AiEndpointTest(ApiModel):
    style: Style
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: str | None = Field(default=None, max_length=4096)
    use_saved_key_of: str | None = None
    model_id: str | None = Field(default=None, max_length=200)


TestOutcome = Literal[
    "working",
    "key_rejected",
    "model_not_found",
    "unreachable",
    "timeout",
    "not_this_style",
    "https_required",
    "provider",
    "proxy",  # 021
]


class AiTestResult(ApiModel):
    outcome: TestOutcome
    message: str
    hint: str | None = None
    looks_like: Style | None = None
    model_count: int | None = None


class AiDiscoverResult(ApiModel):
    outcome: Literal[
        "working",
        "key_rejected",
        "unreachable",
        "timeout",
        "not_this_style",
        "no_model_list",
        "provider",
        "proxy",  # 021
    ]
    message: str | None
    models: list[AiModelInput]


class ModelRef(ApiModel):
    endpoint_id: str
    model_id: str  # ai_models.id


class AiSettingsOut(ApiModel):
    custom_instructions: str
    last_model: ModelRef | None
    version: int
    use_proxy: bool = False  # 021


class AiSettingsUpdate(ApiModel):
    custom_instructions: str = Field(max_length=8000)
    use_proxy: bool | None = None  # 021: absent = keep; true needs a saved proxy
