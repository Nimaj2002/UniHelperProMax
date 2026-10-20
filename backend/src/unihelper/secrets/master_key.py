"""Where the secret store's 256-bit master key lives (014 research R7).

Never in SQLite and never under the data folder, so a copy of the database or of a backup alone
reveals no key (FR-064, FR-065):

1. the operating system's key store (`keyring`: Windows Credential Locker, macOS Keychain, Linux
   Secret Service / KWallet), service `UniHelperProMax`, account `master-key:<installation id>`;
2. otherwise a file readable only by the user in the per-user config folder (clarification Q1),
   or at `UNIHELPER_KEY_FILE`.

The key is created only for a fresh store; when a store already exists (its verifier is set)
and the key cannot be found, it is reported as lost instead of silently replaced.
"""

from __future__ import annotations

import base64
import logging
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import platformdirs

from unihelper.config import Settings

log = logging.getLogger("unihelper.secrets")

SERVICE = "UniHelperProMax"
KEY_BYTES = 32

StoreKind = Literal["os_key_store", "key_file"]


@dataclass(frozen=True)
class MasterKey:
    kind: StoreKind
    key: bytes = field(repr=False)


def account(installation_id: str) -> str:
    return f"master-key:{installation_id}"


def default_key_file(installation_id: str) -> Path:
    folder = Path(platformdirs.user_config_dir(SERVICE, appauthor=False))
    return folder / f"master-{installation_id}.key"


def key_file(settings: Settings, installation_id: str) -> Path:
    return settings.key_file or default_key_file(installation_id)


def keyring_usable() -> bool:
    """A real OS key store answers: not the `fail`/`null` backend, priority above 0, and a
    write/read/delete round trip works (headless Linux, WSL and Docker usually fail here)."""
    try:
        import keyring
        from keyring.backends import fail, null

        backend = keyring.get_keyring()
        if isinstance(backend, fail.Keyring | null.Keyring) or backend.priority <= 0:
            return False
        probe = f"probe-{secrets.token_hex(8)}"
        keyring.set_password(SERVICE, probe, "ok")
        ok = keyring.get_password(SERVICE, probe) == "ok"
        keyring.delete_password(SERVICE, probe)
        return ok
    except Exception as exc:  # any backend failure means "not usable"
        log.info("OS key store not usable (%s)", type(exc).__name__)
        return False


def choose_kind(settings: Settings) -> StoreKind:
    if settings.key_store == "file":
        return "key_file"
    if settings.key_store == "keyring":
        return "os_key_store"
    return "os_key_store" if keyring_usable() else "key_file"


def _encode(key: bytes) -> str:
    return base64.urlsafe_b64encode(key).decode("ascii")


def _decode(text: str) -> bytes | None:
    try:
        key = base64.urlsafe_b64decode(text.strip().encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        return None
    return key if len(key) == KEY_BYTES else None


def _read(kind: StoreKind, settings: Settings, installation_id: str) -> bytes | None:
    if kind == "os_key_store":
        import keyring

        try:
            stored = keyring.get_password(SERVICE, account(installation_id))
        except Exception as exc:
            log.warning("could not read the OS key store (%s)", type(exc).__name__)
            return None
        return _decode(stored) if stored else None
    path = key_file(settings, installation_id)
    try:
        return _decode(path.read_text(encoding="ascii"))
    except (OSError, UnicodeDecodeError):
        return None


def _write(kind: StoreKind, settings: Settings, installation_id: str, key: bytes) -> None:
    if kind == "os_key_store":
        import keyring

        keyring.set_password(SERVICE, account(installation_id), _encode(key))
        return
    path = key_file(settings, installation_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:  # Windows: protected by the user's profile instead
        pass
    if path.exists():
        path.unlink()  # replacing a key the user chose to give up (reset)
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as fh:
        fh.write(_encode(key))
        fh.flush()
        os.fsync(fh.fileno())


def load(settings: Settings, installation_id: str, kind: StoreKind) -> MasterKey | None:
    key = _read(kind, settings, installation_id)
    return MasterKey(kind, key) if key is not None else None


def create(settings: Settings, installation_id: str, kind: StoreKind) -> MasterKey:
    key = secrets.token_bytes(KEY_BYTES)
    _write(kind, settings, installation_id, key)
    return MasterKey(kind, key)
