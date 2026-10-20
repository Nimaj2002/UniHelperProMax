"""Runtime settings, read from environment variables (research R14)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

KeyStoreMode = Literal["auto", "keyring", "file"]


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
    # 004: background transcription worker
    transcription_concurrency: int = 2
    transcription_autorun: bool = True  # tests run jobs explicitly instead
    # 014: where the secret store's master key lives (research R7) and chat run limits (R1)
    key_store: KeyStoreMode = "auto"
    key_file: Path | None = None  # default: platformdirs user config dir
    chat_max_runs_per_user: int = 4
    chat_max_runs_total: int = 8

    @property
    def db_path(self) -> Path:
        return self.data_dir / "unihelper.sqlite3"

    @property
    def files_root(self) -> Path:
        return self.data_dir / "files"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    def check(self) -> None:
        """Refuse settings that would break a guarantee before touching any data."""
        if self.key_file is not None and self.key_file.resolve().is_relative_to(
            self.data_dir.resolve()
        ):
            raise RuntimeError("UNIHELPER_KEY_FILE must not be inside the data folder")


def load_settings() -> Settings:
    static = os.environ.get("UNIHELPER_STATIC_DIR")
    key_file = os.environ.get("UNIHELPER_KEY_FILE")
    key_store = os.environ.get("UNIHELPER_KEY_STORE", "auto").strip().lower()
    if key_store not in ("auto", "keyring", "file"):
        raise RuntimeError("UNIHELPER_KEY_STORE must be auto, keyring or file")
    return Settings(
        data_dir=Path(os.environ.get("UNIHELPER_DATA_DIR", "./data")).resolve(),
        static_dir=Path(static).resolve() if static else None,
        secure_cookies=_env_bool("UNIHELPER_SECURE_COOKIES", False),
        host=os.environ.get("UNIHELPER_HOST", "127.0.0.1"),
        port=int(os.environ.get("UNIHELPER_PORT", "8000")),
        transcription_concurrency=int(os.environ.get("UNIHELPER_TRANSCRIPTION_CONCURRENCY", "2")),
        key_store=key_store,  # type: ignore[arg-type]
        key_file=Path(key_file).expanduser().resolve() if key_file else None,
    )
