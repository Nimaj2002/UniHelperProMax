"""Migration 0013 adds the AI chat and secret-store tables (014 T007): existing rows are untouched
(including plaintext transcription keys — they move in the startup migration, not here), the new
tables start empty with their constraints, and the downgrade drops exactly them."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine

from tests.integration.test_migration_0008 import _insert
from tests.integration.test_migration_0010 import _rows
from tests.integration.test_migration_0011 import KEPT_TABLES, upgrade_to_head_at
from tests.integration.test_migration_0012 import _at_0011
from unihelper.db.migrate import _migration_engine, alembic_config, upgrade_to_head

pytestmark = pytest.mark.integration

NEW_TABLES = {
    "secret_store_meta",
    "secrets",
    "ai_endpoints",
    "ai_models",
    "ai_settings",
    "chats",
    "chat_runs",
    "chat_drafts",
    "chat_uploads",
}


def _at_0012(tmp_path: Path) -> tuple[Path, str]:
    db, url = _at_0011(tmp_path)
    upgrade_to_head_at(url, "0012")
    return db, url


def _connect(db: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    return con


def test_0013_adds_empty_tables_and_keeps_rows(tmp_path: Path) -> None:
    db, url = _at_0012(tmp_path)
    con = _connect(db)
    _insert(
        con,
        "provider_configs",
        user_id="u1",
        provider_id="openai-compatible",
        secret="sk-plaintext-until-startup",
    )
    con.commit()
    con.close()
    kept = (*KEPT_TABLES, "event_series", "task_columns", "provider_configs")
    before = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in kept}

    upgrade_to_head(create_engine(url))

    for table, rows in before.items():
        after = _rows(db, f"SELECT * FROM {table} ORDER BY 1")
        if table == "provider_configs":  # one new nullable column at the end
            after = [r[:-1] for r in after]
        assert after == rows, table
    assert _rows(db, "SELECT secret, secret_id FROM provider_configs") == [
        ("sk-plaintext-until-startup", None)
    ]
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert NEW_TABLES <= tables
    for table in NEW_TABLES:
        assert _rows(db, f"SELECT count(*) FROM {table}") == [(0,)]
    indexes = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='index'")}
    assert {"ix_chats_folder_updated", "ix_chat_runs_chat_id", "ix_ai_models_endpoint_id"} <= (
        indexes
    )
    assert _rows(db, "PRAGMA foreign_key_check") == []


def test_0013_constraints(tmp_path: Path) -> None:
    db, url = _at_0012(tmp_path)
    upgrade_to_head(create_engine(url))
    con = _connect(db)
    _insert(
        con,
        "secrets",
        id="s1",
        user_id="u1",
        owner_kind="ai_endpoint",
        owner_id="e1",
        nonce=b"n" * 12,
        ciphertext=b"c",
    )
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # one secret per owner
        _insert(
            con,
            "secrets",
            id="s2",
            user_id="u1",
            owner_kind="ai_endpoint",
            owner_id="e1",
            nonce=b"n" * 12,
            ciphertext=b"c",
        )
    _insert(
        con,
        "ai_endpoints",
        id="e1",
        user_id="u1",
        name="Local",
        name_key="local",
        style="openai",
        base_url="http://localhost:11434/v1",
        locality="local",
        enabled=1,
        secret_id="s1",
        version=1,
    )
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # names unique per user
        _insert(
            con,
            "ai_endpoints",
            id="e2",
            user_id="u1",
            name="LOCAL",
            name_key="local",
            style="openai",
            base_url="http://x",
            locality="local",
            enabled=1,
            version=1,
        )
    _insert(
        con,
        "ai_models",
        id="m1",
        user_id="u1",
        endpoint_id="e1",
        model_id="llama3",
        display_name="llama3",
        cap_images=1,
        cap_pdf=0,
        cap_audio=0,
        hidden=0,
        source="manual",
        position=0,
    )
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        _insert(
            con,
            "ai_models",
            id="m2",
            user_id="u1",
            endpoint_id="e1",
            model_id="llama3",
            display_name="x",
            cap_images=1,
            cap_pdf=0,
            cap_audio=0,
            hidden=0,
            source="manual",
            position=1,
        )
    con.execute("DELETE FROM secrets WHERE id = 's1'")  # the endpoint keeps existing, keyless
    assert con.execute("SELECT secret_id FROM ai_endpoints").fetchall() == [(None,)]
    con.execute("DELETE FROM ai_endpoints WHERE id = 'e1'")  # models go with their endpoint
    assert con.execute("SELECT count(*) FROM ai_models").fetchone() == (0,)
    con.commit()
    con.close()


def test_downgrade_drops_only_the_new_tables(tmp_path: Path) -> None:
    db, url = _at_0012(tmp_path)
    upgrade_to_head(create_engine(url))
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0012")
    finally:
        mig.dispose()
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert not (NEW_TABLES & tables)
    assert {"provider_configs", "task_columns", "courses"} <= tables
    columns = {r[1] for r in _rows(db, "PRAGMA table_info(provider_configs)")}
    assert "secret_id" not in columns and "secret" in columns
    assert _rows(db, "PRAGMA foreign_key_check") == []
