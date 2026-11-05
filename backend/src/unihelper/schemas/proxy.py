from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.common import ApiModel
from unihelper.schemas.settings import SecretState

ProxyScheme = Literal["http", "https", "socks5"]
Section = Literal["transcription", "ai"]


class ProxyOut(ApiModel):
    scheme: ProxyScheme
    host: str
    port: int
    username: str | None
    password: SecretState
    version: int
    updated_at: str


class ProxySettingsOut(ApiModel):
    proxy: ProxyOut | None
    used_by: list[Section]


class ProxySave(ApiModel):
    scheme: ProxyScheme
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    username: str | None = Field(default=None, max_length=255)
    # absent = keep the saved password, string = replace, null = remove
    password: str | None = Field(default=None, max_length=1024)


class ProxyTest(ApiModel):
    scheme: ProxyScheme
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    username: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, max_length=1024)
    use_saved_password: bool = False


class ProxyTestResult(ApiModel):
    outcome: Literal[
        "working", "unreachable", "credentials_rejected", "no_onward_connection", "timeout"
    ]
    message: str


class ProxyDeleted(ApiModel):
    disabled_sections: list[Section]
