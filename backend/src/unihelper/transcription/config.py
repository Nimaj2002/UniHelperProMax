"""Reads the user's provider settings (written by feature 005's Settings screens, B3).

Only this module touches `transcription_settings`/`provider_configs` on the 004 side. The API key
is never returned from here except through `read_secret`, which the worker calls right before a
provider request. 014: keys live encrypted in the shared secret store; the plaintext column is
read only until the startup migration has moved it (research R8).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from unihelper.models import ProviderConfig, TranscriptionSettings, User
from unihelper.secrets import store as secret_store
from unihelper.transcription.base import ProviderSpec
from unihelper.transcription.providers import SPECS


@dataclass
class ActiveProvider:
    spec: ProviderSpec
    values: dict[str, str]
    has_secret: bool
    default_language: str

    @property
    def configured(self) -> bool:
        for f in self.spec.fields:
            if not f.required:
                continue
            if f.kind == "secret" and not self.has_secret:
                return False
            if f.kind != "secret" and not self.values.get(f.key, "").strip():
                return False
        return True


def _values(row: ProviderConfig | None) -> dict[str, str]:
    if row is None:
        return {}
    try:
        data = json.loads(row.values_json or "{}")
    except ValueError:
        return {}
    return (
        {str(k): str(v) for k, v in data.items() if v is not None} if isinstance(data, dict) else {}
    )


def default_language(db: Session, user: User) -> str:
    settings = db.get(TranscriptionSettings, user.id)
    return settings.default_language if settings else "auto"


def active_provider(db: Session, user: User) -> ActiveProvider | None:
    settings = db.get(TranscriptionSettings, user.id)
    spec = SPECS.get(settings.active_provider_id or "") if settings else None
    if settings is None or spec is None:
        return None
    row = db.get(ProviderConfig, (user.id, spec.id))
    return ActiveProvider(
        spec=spec,
        values=_values(row),
        has_secret=bool(row and (row.secret or row.secret_id)),
        default_language=settings.default_language,
    )


def status(db: Session, user: User) -> dict[str, Any]:
    active = active_provider(db, user)
    return {
        "configured": bool(active and active.configured),
        "provider_id": active.spec.id if active else None,
        "provider_name": active.spec.name if active else None,
        "default_language": default_language(db, user),
    }


OWNER_KIND = "transcription_provider"


def saved_key(db: Session, row: ProviderConfig | None) -> str | None:
    """The saved key of a provider, decrypted at the moment of use; None when there is none or
    it can't be read (a lost key store — the user is asked to enter it again)."""
    if row is None:
        return None
    if row.secret is not None:  # not migrated yet (or the migration failed)
        return row.secret
    if row.secret_id is None:
        return None
    try:
        return secret_store.current().reveal(db, row.user_id, OWNER_KIND, row.provider_id)
    except secret_store.KeyUnreadable:
        return None


def read_secret(maker: sessionmaker[Session], user_id: str, provider_id: str) -> str | None:
    with maker() as db:
        return saved_key(db, db.get(ProviderConfig, (user_id, provider_id)))


@dataclass
class JobConfig:
    """`ProviderConfig` for a running job: snapshot values, live secret (005 edge cases)."""

    values: Mapping[str, str]
    reader: Callable[[], str | None] = field(repr=False)

    def secret(self) -> str | None:
        return self.reader()
