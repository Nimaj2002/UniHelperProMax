"""SecretStore: provider keys encrypted at rest (014 research R7, FR-063–068).

Envelope encryption with symmetric keys only — there is no public-key step, so the
post-quantum requirement of FR-064 holds as is (AES-256 keeps ~128-bit strength against
Grover). Every key is sealed with AES-256-GCM under the installation's master key, a fresh
12-byte nonce, and associated data binding it to its owner, so a ciphertext copied onto another
row fails to open. Plaintext exists only inside `use()` / `reveal()` in the backend, at the
moment of use; it is never logged and never stored on objects with a `repr`.
"""

from __future__ import annotations

import logging
import os
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from unihelper.config import Settings
from unihelper.models import Secret, SecretStoreMeta
from unihelper.models.base import now_iso
from unihelper.secrets import master_key
from unihelper.secrets.master_key import StoreKind

log = logging.getLogger("unihelper.secrets")

VERIFIER = b"uh-verifier"
VERIFIER_AAD = b"uh-secret-v1|verifier"
NONCE_BYTES = 12
MASK = "••••"
KEY_FILE_NOTE = (
    "Keys are encrypted, but the encryption key is kept in a file in your user profile. "
    "Anyone who can sign in to this computer as you can read your keys."
)
MIGRATION_MESSAGES = {
    "failed": (
        "Saved transcription keys couldn't be moved into the encrypted store. Nothing was "
        "changed; the app will try again at the next start."
    ),
}


class KeyUnreadable(Exception):
    """The master key is missing or wrong (lost key store, data restored elsewhere)."""


def mask(plaintext: str | None) -> str | None:
    """At most the last 4 characters, and none for keys shorter than 8 (FR-019)."""
    if not plaintext:
        return None
    return MASK + plaintext[-4:] if len(plaintext) >= 8 else MASK


def _aad(user_id: str, owner_kind: str, owner_id: str) -> bytes:
    return f"uh-secret-v1|{user_id}|{owner_kind}|{owner_id}".encode()


class SecretStore:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._aead: AESGCM | None = None
        self.kind: StoreKind = "key_file"
        self.installation_id = ""

    def __repr__(self) -> str:
        return f"SecretStore(kind={self.kind!r}, readable={self.readable})"

    @property
    def readable(self) -> bool:
        return self._aead is not None

    # ───────────────────────────── opening ─────────────────────────────

    def _meta(self, db: Session) -> SecretStoreMeta:
        meta = db.get(SecretStoreMeta, 1)
        if meta is None:
            meta = SecretStoreMeta(
                id=1, installation_id=str(uuid.uuid4()), migration_state="pending"
            )
            db.add(meta)
            db.flush()
        return meta

    def open(self, db: Session) -> None:
        """Find (or, for a fresh store, create) the master key and check it against the
        verifier. A lost key leaves the store unreadable; nothing else is affected (FR-068)."""
        meta = self._meta(db)
        self.installation_id = meta.installation_id
        kind: StoreKind = (
            meta.store_kind  # type: ignore[assignment]
            if meta.store_kind in ("os_key_store", "key_file")
            and self._settings.key_store == "auto"
            else master_key.choose_kind(self._settings)
        )
        self.kind = kind
        key = master_key.load(self._settings, meta.installation_id, kind)
        if meta.verifier_ct is None:
            key = key or master_key.create(self._settings, meta.installation_id, kind)
            self._aead = AESGCM(key.key)
            meta.verifier_nonce, meta.verifier_ct = self._seal(VERIFIER, VERIFIER_AAD)
        elif key is None or not self._verifies(AESGCM(key.key), meta):
            self._aead = None
            log.warning("secret store: the master key is missing or does not match")
        else:
            self._aead = AESGCM(key.key)
        meta.store_kind = kind
        db.flush()

    def _verifies(self, aead: AESGCM, meta: SecretStoreMeta) -> bool:
        try:
            assert meta.verifier_nonce is not None and meta.verifier_ct is not None
            return aead.decrypt(meta.verifier_nonce, meta.verifier_ct, VERIFIER_AAD) == VERIFIER
        except InvalidTag:
            return False

    # ───────────────────────────── sealing ─────────────────────────────

    def _seal(self, plaintext: bytes, aad: bytes) -> tuple[bytes, bytes]:
        if self._aead is None:
            raise KeyUnreadable
        nonce = os.urandom(NONCE_BYTES)
        return nonce, self._aead.encrypt(nonce, plaintext, aad)

    def _open(self, row: Secret) -> str:
        if self._aead is None:
            raise KeyUnreadable
        try:
            data = self._aead.decrypt(
                row.nonce, row.ciphertext, _aad(row.user_id, row.owner_kind, row.owner_id)
            )
        except InvalidTag as exc:
            raise KeyUnreadable from exc
        return data.decode("utf-8")

    # ───────────────────────────── per secret ─────────────────────────────

    def _row(self, db: Session, user_id: str, owner_kind: str, owner_id: str) -> Secret | None:
        return db.scalar(
            select(Secret).where(
                Secret.user_id == user_id,
                Secret.owner_kind == owner_kind,
                Secret.owner_id == owner_id,
            )
        )

    def put(self, db: Session, user_id: str, owner_kind: str, owner_id: str, plaintext: str) -> str:
        """Store (or replace) a key; returns the secret's id."""
        nonce, ciphertext = self._seal(
            plaintext.encode("utf-8"), _aad(user_id, owner_kind, owner_id)
        )
        row = self._row(db, user_id, owner_kind, owner_id)
        if row is None:
            row = Secret(user_id=user_id, owner_kind=owner_kind, owner_id=owner_id)
            db.add(row)
        row.nonce, row.ciphertext = nonce, ciphertext
        db.flush()
        return row.id

    def remove(self, db: Session, user_id: str, owner_kind: str, owner_id: str) -> None:
        row = self._row(db, user_id, owner_kind, owner_id)
        if row is not None:
            db.delete(row)
            db.flush()

    def reveal(self, db: Session, user_id: str, owner_kind: str, owner_id: str) -> str | None:
        """The plaintext key, or None when there is none. Raises KeyUnreadable."""
        row = self._row(db, user_id, owner_kind, owner_id)
        return self._open(row) if row is not None else None

    @contextmanager
    def use(
        self, db: Session, user_id: str, owner_kind: str, owner_id: str
    ) -> Iterator[str | None]:
        plaintext = self.reveal(db, user_id, owner_kind, owner_id)
        try:
            yield plaintext
        finally:
            del plaintext

    def state(self, db: Session, user_id: str, owner_kind: str, owner_id: str) -> dict[str, Any]:
        """`{configured, masked, readable}` — computed in the backend, never the key itself."""
        row = self._row(db, user_id, owner_kind, owner_id)
        if row is None:
            return {"configured": False, "masked": None, "readable": True}
        try:
            return {"configured": True, "masked": mask(self._open(row)), "readable": True}
        except KeyUnreadable:
            return {"configured": True, "masked": MASK, "readable": False}

    # ───────────────────────────── store-wide ─────────────────────────────

    def unreadable_count(self, db: Session) -> int:
        rows = list(db.scalars(select(Secret)))
        count = 0
        for row in rows:
            try:
                self._open(row)
            except KeyUnreadable:
                count += 1
        return count

    def status(self, db: Session) -> dict[str, Any]:
        meta = self._meta(db)
        total = db.scalar(select(func.count()).select_from(Secret)) or 0
        state = meta.migration_state
        migration = "not_needed" if state == "done" and total == 0 else state
        return {
            "store": self.kind,
            "protection_note": KEY_FILE_NOTE if self.kind == "key_file" else None,
            "readable": self.readable,
            "unreadable_secrets": self.unreadable_count(db),
            "migration": migration,
            "migration_message": MIGRATION_MESSAGES.get(state),
        }

    def reset(self, db: Session) -> None:
        """Start a new key store after the old master key was lost: drop the keys that can't
        be read (they're useless) and seal a new verifier. Nothing else changes (FR-068)."""
        meta = self._meta(db)
        db.execute(delete(Secret))
        key = master_key.create(self._settings, meta.installation_id, self.kind)
        self._aead = AESGCM(key.key)
        meta.verifier_nonce, meta.verifier_ct = self._seal(VERIFIER, VERIFIER_AAD)
        meta.rotated_at = now_iso()
        db.flush()


# The app's store, set at startup. Code without access to `app.state` (the transcription
# worker's key reader) uses `current()`.
_current: SecretStore | None = None


def install(store: SecretStore) -> None:
    global _current
    _current = store


def current() -> SecretStore:
    if _current is None:
        raise RuntimeError("the secret store has not been opened")
    return _current
