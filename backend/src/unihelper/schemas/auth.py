from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.common import ApiModel


class NewAccount(ApiModel):
    username: str = Field(pattern=r"^[a-z0-9._-]{3,32}$")
    password: str = Field(min_length=10, max_length=256)
    timezone: str | None = Field(default=None, max_length=64)


class LoginRequest(ApiModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


class Me(ApiModel):
    id: str
    username: str
    role: Literal["owner", "member"]
    must_change_password: bool
    timezone: str


class SetupStatus(ApiModel):
    needs_owner: bool


class PasswordChange(ApiModel):
    current_password: str = Field(max_length=256)
    new_password: str = Field(min_length=10, max_length=256)


class ProfileUpdate(ApiModel):
    timezone: str | None = Field(default=None, max_length=64)


class Account(ApiModel):
    id: str
    username: str
    role: Literal["owner", "member"]
    disabled: bool
    must_change_password: bool
    created_at: str


class AccountUpdate(ApiModel):
    disabled: bool


class PasswordReset(ApiModel):
    new_password: str = Field(min_length=10, max_length=256)


class KeptFolder(ApiModel):
    kept_folder: str
