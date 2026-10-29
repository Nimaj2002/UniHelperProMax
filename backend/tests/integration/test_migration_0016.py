"""Migration 0016 makes `notes.session_folder_id` nullable for general notes (018 T005): existing
rows are untouched, a note with no folder can be stored, general-note names and files are unique
per user, and the downgrade removes general notes and restores NOT NULL."""

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


def _at_0015(tmp_path: Path) -> tuple[Path, str]:
    db, url = _at_0010(tmp_path)
    upgrade_to_head_at(url, "0015")
    return db, url


def _connect(db: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    return con


def _general(con: sqlite3.Connection, nid: str, name_key: str, file_key: str) -> None:
    _insert(con, "notes", id=nid, user_id="u1", session_folder_id=None, name=name_key,
            name_key=name_key, file_name=f"{file_key}", file_key=file_key, content_hash="h",
            size=0, version=1)  # fmt: skip


def test_0016_keeps_rows_and_allows_general_notes(tmp_path: Path) -> None:
    db, url = _at_0015(tmp_path)
    before = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in KEPT_TABLES}

    upgrade_to_head(create_engine(url))

    for table, rows in before.items():
        assert _rows(db, f"SELECT * FROM {table} ORDER BY 1") == rows, table
    con = _connect(db)
    _general(con, "g1", "ideas", "ideas.md")
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # same name, same user
        _general(con, "g2", "ideas", "ideas 2.md")
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # same file, same user
        _general(con, "g3", "other", "ideas.md")
    con.commit()
    con.close()
    assert _rows(db, "PRAGMA foreign_key_check") == []


def test_0016_downgrade_drops_general_notes(tmp_path: Path) -> None:
    db, url = _at_0015(tmp_path)
    upgrade_to_head(create_engine(url))
    con = _connect(db)
    _general(con, "g1", "ideas", "ideas.md")
    con.commit()
    con.close()
    session_notes = _rows(db, "SELECT * FROM notes WHERE session_folder_id IS NOT NULL ORDER BY 1")
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0015")
    finally:
        mig.dispose()
    assert _rows(db, "SELECT * FROM notes ORDER BY 1") == session_notes
    notnull = {r[1]: r[3] for r in _rows(db, "PRAGMA table_info(notes)")}
    assert notnull["session_folder_id"] == 1
