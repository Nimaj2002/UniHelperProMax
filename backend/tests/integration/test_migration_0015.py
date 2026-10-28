"""Migration 0015 adds `document_hides` (017 T004): existing rows are untouched, the table starts
empty, a hide goes away with its document or its session folder, and the downgrade drops exactly
it."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine

from tests.integration.test_migration_0008 import _insert
from tests.integration.test_migration_0010 import _rows
from tests.integration.test_migration_0011 import KEPT_TABLES, _at_0010, upgrade_to_head_at
from unihelper.db.migrate import _migration_engine, alembic_config, upgrade_to_head

pytestmark = pytest.mark.integration


def _at_0014(tmp_path: Path) -> tuple[Path, str]:
    db, url = _at_0010(tmp_path)
    upgrade_to_head_at(url, "0014")
    return db, url


def _connect(db: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    return con


def test_0015_adds_empty_table_and_keeps_rows(tmp_path: Path) -> None:
    db, url = _at_0014(tmp_path)
    before = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in KEPT_TABLES}

    upgrade_to_head(create_engine(url))

    for table, rows in before.items():
        assert _rows(db, f"SELECT * FROM {table} ORDER BY 1") == rows, table
    assert _rows(db, "SELECT count(*) FROM document_hides") == [(0,)]
    indexes = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='index'")}
    assert {"ix_document_hides_document_id", "ix_document_hides_user_id"} <= indexes
    assert _rows(db, "PRAGMA foreign_key_check") == []


def test_0015_hides_cascade_with_document_and_folder(tmp_path: Path) -> None:
    db, url = _at_0014(tmp_path)
    upgrade_to_head(create_engine(url))
    con = _connect(db)
    _insert(con, "document_hides", session_folder_id="f1", document_id="d1", user_id="u1")
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # one hide per session and PDF
        _insert(con, "document_hides", session_folder_id="f1", document_id="d1", user_id="u1")
    con.execute("DELETE FROM documents WHERE id = 'd1'")
    assert con.execute("SELECT count(*) FROM document_hides").fetchone() == (0,)

    _insert(con, "documents", id="d2", user_id="u1", session_folder_id="f2", name="Notes",
            name_key="notes", file_name="Notes.pdf", file_key="notes.pdf",
            original_file_name="Notes.pdf", size=10, sha256="0" * 64, encrypted=0,
            uploaded_at="2026-10-01T00:00:00+00:00", version=1)  # fmt: skip
    _insert(con, "document_hides", session_folder_id="f1", document_id="d2", user_id="u1")
    con.execute("DELETE FROM notes WHERE session_folder_id = 'f1'")
    con.execute("DELETE FROM session_folders WHERE id = 'f1'")
    assert con.execute("SELECT count(*) FROM document_hides").fetchone() == (0,)
    con.commit()
    con.close()


def test_0015_downgrade_drops_the_table(tmp_path: Path) -> None:
    db, url = _at_0014(tmp_path)
    upgrade_to_head(create_engine(url))
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0014")
    finally:
        mig.dispose()
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "document_hides" not in tables
    assert "documents" in tables
