"""Reads the user's provider settings (written by feature 005's Settings screens, B3).

Only this module touches `transcription_settings`/`provider_configs` on the 004 side. The API key
is never returned from here except through `read_secret`, which the worker calls right before a
provider request.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session, sessionmaker

from unihelper.models import ProviderConfig, TranscriptionSettings, User
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
        has_secret=bool(row and row.secret),
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


def read_secret(maker: sessionmaker[Session], user_id: str, provider_id: str) -> str | None:
    with maker() as db:
        row = db.get(ProviderConfig, (user_id, provider_id))
        return row.secret if row else None


@dataclass
class JobConfig:
    """`ProviderConfig` for a running job: snapshot values, live secret (005 edge cases)."""

    values: Mapping[str, str]
    reader: Callable[[], str | None] = field(repr=False)

    def secret(self) -> str | None:
        return self.reader()
