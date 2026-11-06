"""Runtime settings, read from environment variables (research R14)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

KeyStoreMode = Literal["auto", "keyring", "file"]

# 015: the desktop app's fixed port; it is part of the window's storage origin (research R7).
# start.sh, start.ps1 and the Dockerfile keep passing 8000 explicitly.
DEFAULT_PORT = 47813
LOOPBACK = "127.0.0.1"


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str, sep: str = ",") -> tuple[str, ...]:
    return tuple(p.strip() for p in os.environ.get(name, "").split(sep) if p.strip())


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    static_dir: Path | None = None
    secure_cookies: bool = False
    host: str = LOOPBACK
    port: int = DEFAULT_PORT
    # 004: background transcription worker
    transcription_concurrency: int = 2
    transcription_autorun: bool = True  # tests run jobs explicitly instead
    graph_autorun: bool = True  # 022: the knowledge-graph worker; tests run it explicitly
    # 014: where the secret store's master key lives (research R7) and chat run limits (R1)
    key_store: KeyStoreMode = "auto"
    key_file: Path | None = None  # default: platformdirs user config dir
    chat_max_runs_per_user: int = 4
    chat_max_runs_total: int = 8
    # 015: desktop mode (contracts/backend-desktop-mode.md)
    files_dir: Path | None = None  # default: <data_dir>/files
    desktop: bool = False
    desktop_user: str | None = None
    desktop_timezone: str | None = None  # the computer's IANA time zone, for the owner
    app_version: str | None = None
    allowed_hosts: tuple[str, ...] = ()  # web mode Host allow-list; empty = no check
    app_files_roots: tuple[Path, ...] = ()  # desktop: folders the data folder must not be in

    def __post_init__(self) -> None:
        if self.desktop:  # desktop mode only ever listens on the loopback address (FR-018)
            object.__setattr__(self, "host", LOOPBACK)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "unihelper.sqlite3"

    @property
    def files_root(self) -> Path:
        return self.files_dir if self.files_dir is not None else self.data_dir / "files"

    @property
    def backups_dir(self) -> Path:
        return self.data_dir / "backups"

    # 016: full backups of one account (research R6, R7)
    @property
    def exports_dir(self) -> Path:
        return self.backups_dir / "exports"

    @property
    def safety_dir(self) -> Path:
        return self.backups_dir / "safety"

    def journal_path(self, user_id: str) -> Path:
        return self.backups_dir / f"restore-{user_id}.journal.json"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_path}"

    def check(self) -> None:
        """Refuse settings that would break a guarantee before touching any data."""
        if self.key_file is not None and self.key_file.resolve().is_relative_to(
            self.data_dir.resolve()
        ):
            raise RuntimeError("UNIHELPER_KEY_FILE must not be inside the data folder")
        files = self.files_root.resolve()
        if files.is_relative_to(self.backups_dir.resolve()):
            raise RuntimeError("UNIHELPER_FILES_DIR must not be inside the backups folder")
        if self.key_file is not None and self.key_file.resolve().is_relative_to(files):
            raise RuntimeError("UNIHELPER_KEY_FILE must not be inside the files folder")


def load_settings() -> Settings:
    static = os.environ.get("UNIHELPER_STATIC_DIR")
    key_file = os.environ.get("UNIHELPER_KEY_FILE")
    files_dir = os.environ.get("UNIHELPER_FILES_DIR")
    key_store = os.environ.get("UNIHELPER_KEY_STORE", "auto").strip().lower()
    if key_store not in ("auto", "keyring", "file"):
        raise RuntimeError("UNIHELPER_KEY_STORE must be auto, keyring or file")
    return Settings(
        data_dir=Path(os.environ.get("UNIHELPER_DATA_DIR", "./data")).resolve(),
        static_dir=Path(static).resolve() if static else None,
        secure_cookies=_env_bool("UNIHELPER_SECURE_COOKIES", False),
        host=os.environ.get("UNIHELPER_HOST", LOOPBACK),
        port=int(os.environ.get("UNIHELPER_PORT", str(DEFAULT_PORT))),
        transcription_concurrency=int(os.environ.get("UNIHELPER_TRANSCRIPTION_CONCURRENCY", "2")),
        key_store=key_store,  # type: ignore[arg-type]
        key_file=Path(key_file).expanduser().resolve() if key_file else None,
        files_dir=Path(files_dir).expanduser().resolve() if files_dir else None,
        desktop=_env_bool("UNIHELPER_DESKTOP", False),
        desktop_user=os.environ.get("UNIHELPER_DESKTOP_USER") or None,
        desktop_timezone=os.environ.get("UNIHELPER_DESKTOP_TZ") or None,
        app_version=os.environ.get("UNIHELPER_APP_VERSION") or None,
        allowed_hosts=_env_list("UNIHELPER_ALLOWED_HOSTS"),
        app_files_roots=tuple(
            Path(p).resolve() for p in _env_list("UNIHELPER_APP_FILES_ROOTS", os.pathsep)
        ),
    )
