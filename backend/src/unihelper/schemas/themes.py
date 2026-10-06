from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.common import ApiModel

# the app's semantic colour tokens a theme defines (005 data-model)
TOKENS = (
    "surface",
    "surface-elevated",
    "surface-sunken",
    "surface-hover",
    "text-primary",
    "text-muted",
    "border",
    "divider",
    "grid-line",
    "accent",
    "accent-foreground",
    "now-line",
    "focus-ring",
    "success",
    "warning",
    "danger",
    "danger-foreground",
    "editor-surface",
)
KEY_COLORS = ("background", "surface", "text", "accent")


class ThemeWrite(ApiModel):
    name: str = Field(max_length=200)
    key_colors: dict[str, str]
    overrides: dict[str, str]
    colors: dict[str, str]
    low_contrast: bool


class ThemeCreate(ThemeWrite):
    base: Literal["light", "dark"]
    unique_name: bool = False


class Theme(ApiModel):
    id: str
    name: str
    base: Literal["light", "dark"]
    key_colors: dict[str, str]
    overrides: dict[str, str]
    colors: dict[str, str]
    low_contrast: bool
    version: int
    created_at: str
    updated_at: str
