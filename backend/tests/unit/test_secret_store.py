"""014 T014: the secret store seals keys with AES-256-GCM bound to their owner, detects a wrong
master key through its verifier, and never shows plaintext in reprs."""

from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from unihelper.config import Settings
from unihelper.db.migrate import upgrade_to_head
from unihelper.models import Secret, User
from unihelper.secrets import master_key
from unihelper.secrets.store import MASK, KeyUnreadable, SecretStore, mask

pytestmark = pytest.mark.unit

KEY = "sk-test-0123456789abcd"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data", key_store="file", key_file=tmp_path / "keys" / "master.key"
    )


@pytest.fixture
def db(settings: Settings) -> Session:
    settings.data_dir.mkdir(parents=True)
    engine = create_engine(settings.db_url)
    upgrade_to_head(engine)
    session = Session(engine)
    for uid in ("u1", "u2"):
        session.add(
            User(id=uid, username=f"user{uid}", password_hash="x", role="member", timezone="UTC")
        )
    session.flush()
    return session


def _open(settings: Settings, db: Session) -> SecretStore:
    store = SecretStore(settings)
    store.open(db)
    return store


def test_round_trip_and_fresh_nonces(settings: Settings, db: Session) -> None:
    store = _open(settings, db)
    assert store.readable and store.kind == "key_file"
    store.put(db, "u1", "ai_endpoint", "e1", KEY)
    first = db.query(Secret).one()
    nonce1, ct1 = first.nonce, first.ciphertext
    assert KEY.encode() not in ct1 and len(nonce1) == 12
    assert store.reveal(db, "u1", "ai_endpoint", "e1") == KEY
    store.put(db, "u1", "ai_endpoint", "e1", KEY)  # same key again: a new nonce
    again = db.query(Secret).one()
    assert again.nonce != nonce1 and again.ciphertext != ct1
    with store.use(db, "u1", "ai_endpoint", "e1") as plaintext:
        assert plaintext == KEY
    assert store.reveal(db, "u1", "ai_endpoint", "missing") is None


def test_ciphertext_is_bound_to_its_owner(settings: Settings, db: Session) -> None:
    store = _open(settings, db)
    store.put(db, "u1", "ai_endpoint", "e1", KEY)
    store.put(db, "u2", "ai_endpoint", "e2", "other-key-12345678")
    a, b = sorted(db.query(Secret).all(), key=lambda r: r.owner_id)
    b.nonce, b.ciphertext = a.nonce, a.ciphertext  # copied onto another owner's row
    db.flush()
    with pytest.raises(KeyUnreadable):
        store.reveal(db, "u2", "ai_endpoint", "e2")


def test_wrong_master_key_is_detected(settings: Settings, db: Session) -> None:
    store = _open(settings, db)
    store.put(db, "u1", "transcription_provider", "openai-compatible", KEY)
    assert settings.key_file is not None
    settings.key_file.unlink()
    master_key.create(settings, store.installation_id, "key_file")  # a different key
    reopened = _open(settings, db)
    assert not reopened.readable
    state = reopened.state(db, "u1", "transcription_provider", "openai-compatible")
    assert state == {"configured": True, "masked": MASK, "readable": False}
    with pytest.raises(KeyUnreadable):
        reopened.reveal(db, "u1", "transcription_provider", "openai-compatible")
    with pytest.raises(KeyUnreadable):
        reopened.put(db, "u1", "ai_endpoint", "e9", KEY)


def test_a_missing_key_is_reported_not_replaced(settings: Settings, db: Session) -> None:
    store = _open(settings, db)
    store.put(db, "u1", "ai_endpoint", "e1", KEY)
    assert settings.key_file is not None
    settings.key_file.unlink()
    reopened = _open(settings, db)
    assert not reopened.readable
    assert not settings.key_file.exists()  # never silently re-created
    reopened.reset(db)
    assert reopened.readable and db.query(Secret).count() == 0
    reopened.put(db, "u1", "ai_endpoint", "e1", KEY)
    assert _open(settings, db).reveal(db, "u1", "ai_endpoint", "e1") == KEY


def test_masking() -> None:
    assert mask(None) is None and mask("") is None
    assert mask("short") == MASK  # under 8 characters: nothing shown
    assert mask("12345678") == MASK + "5678"
    assert mask(KEY) == MASK + "abcd"


def test_state_and_reprs_hide_plaintext(settings: Settings, db: Session) -> None:
    store = _open(settings, db)
    store.put(db, "u1", "ai_endpoint", "e1", KEY)
    state = store.state(db, "u1", "ai_endpoint", "e1")
    assert state == {"configured": True, "masked": MASK + "abcd", "readable": True}
    assert store.state(db, "u1", "ai_endpoint", "none")["configured"] is False
    row = db.query(Secret).one()
    for text in (
        repr(store),
        repr(row),
        repr(master_key.load(settings, store.installation_id, "key_file")),
    ):
        assert KEY not in text and "key=" not in text.replace("key_file", "")


def test_status(settings: Settings, db: Session) -> None:
    store = _open(settings, db)
    status = store.status(db)
    assert status["store"] == "key_file" and status["readable"] is True
    assert "Anyone who can sign in" in status["protection_note"]
    assert status["unreadable_secrets"] == 0
