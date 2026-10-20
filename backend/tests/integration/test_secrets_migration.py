"""014 T016: plaintext transcription keys move into the encrypted store at startup, all or
nothing (FR-067, SC-006) — real SQLite, real files, the fake transcriber."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests import fake_transcriber
from tests.conftest import OWNER, _attach_csrf
from tests.contract.notes_helpers import create_note
from tests.contract.transcription_helpers import (
    API,
    configure,
    finished_recording,
    job,
    make_session,
    run_jobs,
    transcribe,
)
from unihelper.models import ProviderConfig, SecretStoreMeta, User
from unihelper.secrets import store as secret_store
from unihelper.services import auth_service

pytestmark = pytest.mark.integration

OWNER_KEY = "sk-owner-plaintext-0001"
MEMBER_KEY = "sk-member-plaintext-0002"


@contextmanager
def running(app: FastAPI) -> Iterator[TestClient]:
    """One server run: the lifespan (and so the startup migration) runs on entry."""
    with TestClient(app) as c:
        yield c


def sign_in(c: TestClient) -> TestClient:
    r = c.post(f"{API}/auth/login", json={k: OWNER[k] for k in ("username", "password")})
    assert r.status_code == 200, r.text
    return _attach_csrf(c)


def seed_plaintext(app: FastAPI) -> None:
    """Keys as an installation from before 014 left them, then mark the migration pending."""
    with app.state.sessionmaker() as db:
        db.add(
            User(
                username="member",
                password_hash=auth_service.hash_password("x" * 12),
                role="member",
                timezone="UTC",
            )
        )
        db.commit()
    configure(
        app,
        provider="openai-compatible",
        model="whisper-1",
        api_key=OWNER_KEY,
        address="https://fake",
    )
    configure(
        app,
        username="member",
        provider="openai-compatible",
        model="whisper-1",
        api_key=MEMBER_KEY,
        address="https://fake",
    )
    with app.state.sessionmaker() as db:
        meta = db.get(SecretStoreMeta, 1)
        assert meta is not None
        meta.migration_state = "pending"
        db.commit()


def rows(app: FastAPI) -> list[ProviderConfig]:
    with app.state.sessionmaker() as db:
        return list(db.query(ProviderConfig).order_by(ProviderConfig.user_id))


def test_keys_move_at_startup_and_transcription_still_works(app: FastAPI) -> None:
    with running(app) as c:
        assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        seed_plaintext(app)
    with running(app) as c:  # restart: the startup migration runs
        configs = rows(app)
        assert len(configs) == 2
        assert all(r.secret is None and r.secret_id is not None for r in configs)
        with app.state.sessionmaker() as db:
            meta = db.get(SecretStoreMeta, 1)
            assert meta is not None and meta.migration_state == "done"
            store = app.state.secrets
            keys = {
                store.reveal(db, r.user_id, "transcription_provider", r.provider_id)
                for r in configs
            }
        assert keys == {OWNER_KEY, MEMBER_KEY}

        # transcription authenticates with the migrated key
        sign_in(c)
        fake_transcriber.app.state.required_key = OWNER_KEY
        key = make_session(c)
        note = create_note(c, key, "Lecture")
        rec = finished_recording(c, key, 3)
        started = transcribe(c, rec["id"], noteId=note["id"])
        assert started.status_code == 202, started.text
        run_jobs(c)
        assert job(c, started.json()["id"])["status"] == "completed"
        view = c.get(f"{API}/settings/transcription").json()
        oa = next(p for p in view["providers"] if p["providerId"] == "openai-compatible")
        assert oa["secret"] == {"configured": True, "last4": "0001", "readable": True}
        status = c.get(f"{API}/secrets/status").json()
        assert status["migration"] == "done" and status["readable"] is True


def test_a_failed_migration_changes_nothing_and_is_retried(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    with running(app) as c:
        assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        seed_plaintext(app)

    real_put = secret_store.SecretStore.put
    calls = {"n": 0}

    def flaky_put(self, db, user_id, owner_kind, owner_id, plaintext):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        if calls["n"] == 2:  # the second key fails
            raise OSError("disk full")
        return real_put(self, db, user_id, owner_kind, owner_id, plaintext)

    monkeypatch.setattr(secret_store.SecretStore, "put", flaky_put)
    with running(app) as c:
        configs = rows(app)
        assert {r.secret for r in configs} == {OWNER_KEY, MEMBER_KEY}  # plaintext kept
        assert all(r.secret_id is None for r in configs)
        with app.state.sessionmaker() as db:
            assert db.query(secret_store.Secret).count() == 0
        sign_in(c)
        status = c.get(f"{API}/secrets/status").json()
        assert (
            status["migration"] == "failed" and "Nothing was changed" in status["migrationMessage"]
        )
        # transcription still has its (plaintext) key
        view = c.get(f"{API}/settings/transcription").json()
        oa = next(p for p in view["providers"] if p["providerId"] == "openai-compatible")
        assert oa["secret"]["configured"] is True and oa["secret"]["last4"] == "0001"

    monkeypatch.setattr(secret_store.SecretStore, "put", real_put)
    with running(app):  # next start: retried, succeeds
        assert all(r.secret is None and r.secret_id for r in rows(app))
        with app.state.sessionmaker() as db:
            meta = db.get(SecretStoreMeta, 1)
            assert meta is not None and meta.migration_state == "done"
