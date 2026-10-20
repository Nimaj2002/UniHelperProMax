"""Move plaintext transcription keys into the secret store, all or nothing (014 research R8).

Runs at startup after the schema migration (it needs the master key, which Alembic must not
touch). In one transaction: encrypt each key, check it decrypts back, then clear the plaintext.
Any failure rolls everything back — the plaintext stays and transcription keeps working — and
is retried at the next start (FR-067)."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from unihelper.models import ProviderConfig, SecretStoreMeta
from unihelper.secrets.store import SecretStore

log = logging.getLogger("unihelper.secrets")

OWNER_KIND = "transcription_provider"


def _move_all(db: Session, store: SecretStore) -> None:
    rows = list(db.scalars(select(ProviderConfig).where(ProviderConfig.secret.is_not(None))))
    for row in rows:
        plaintext = row.secret
        assert plaintext is not None
        row.secret_id = store.put(db, row.user_id, OWNER_KIND, row.provider_id, plaintext)
        if store.reveal(db, row.user_id, OWNER_KIND, row.provider_id) != plaintext:
            raise RuntimeError("round trip mismatch")
        row.secret = None
    db.flush()


def migrate_plaintext(maker: sessionmaker[Session], store: SecretStore) -> None:
    with maker() as db:
        meta = db.get(SecretStoreMeta, 1)
        if meta is None:
            return
        if meta.migration_state == "done":
            return
        if not store.readable:
            return  # keep the plaintext until there is a key to seal it with
    with maker() as db:
        try:
            _move_all(db, store)
            meta = db.get(SecretStoreMeta, 1)
            assert meta is not None
            meta.migration_state, meta.migration_error = "done", None
            db.commit()
        except Exception as exc:
            db.rollback()
            log.error("could not migrate transcription keys (%s)", type(exc).__name__)
            with maker() as fail_db:
                meta = fail_db.get(SecretStoreMeta, 1)
                if meta is not None:
                    meta.migration_state = "failed"
                    meta.migration_error = type(exc).__name__[:200]
                    fail_db.commit()
