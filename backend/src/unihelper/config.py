"""Runtime settings, read from environment variables (research R14)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    static_dir: Path | None = None
    secure_cookies: bool = False
    host: str = "127.0.0.1"
    port: int = 8000

    @property
    def db_path(self) -> Path:
        return self.data_dir / "unihelper.sqlite3"

    @property
    def files_root(self) -> Path:
        return self.data_dir / "files"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"


def load_settings() -> Settings:
    static = os.environ.get("UNIHELPER_STATIC_DIR")
    return Settings(
        data_dir=Path(os.environ.get("UNIHELPER_DATA_DIR", "./data")).resolve(),
        static_dir=Path(static).resolve() if static else None,
        secure_cookies=_env_bool("UNIHELPER_SECURE_COOKIES", False),
        host=os.environ.get("UNIHELPER_HOST", "127.0.0.1"),
        port=int(os.environ.get("UNIHELPER_PORT", "8000")),
    )
