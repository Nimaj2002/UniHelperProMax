"""Migration 0009 adds the 007 tables and two workspace columns without touching existing rows
(T006), and the migrated schema matches the models."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine

from tests.integration.test_migration_0008 import _db_at, _insert, _job, _seed
from unihelper.db.migrate import _migration_engine, alembic_config, upgrade_to_head
from unihelper.models import Base

pytestmark = pytest.mark.integration


def _rows(db: Path, table: str) -> list[tuple[object, ...]]:
    con = sqlite3.connect(db)
    try:
        return con.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
    finally:
        con.close()


def test_0009_keeps_existing_data(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    url = _db_at(db, "0008")
    _seed(db)
    con = sqlite3.connect(db)
    _insert(con, "notes", id="n1", user_id="u1", session_folder_id="f1", name="Lecture",
            name_key="lecture", file_name="Lecture.md", file_key="lecture.md",
            content_hash="h", size=0, version=1)  # fmt: skip
    _insert(con, "workspace_states", user_id="u1", lineage_id="l1", original_date="2026-09-28",
            open_note_ids='["n1"]', active_note_id="n1")  # fmt: skip
    con.commit()
    con.close()
    before = {t: _rows(db, t) for t in ("notes", "recordings", "transcription_jobs")}
    job = _job(db)

    upgrade_to_head(create_engine(url))

    for table, rows in before.items():
        assert _rows(db, table) == rows, table
    assert _job(db) == job
    con = sqlite3.connect(db)
    ws = con.execute(
        "SELECT open_note_ids, active_note_id, tabs_json, split_json FROM workspace_states"
    ).fetchall()
    assert ws == [('["n1"]', "n1", None, None)]
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"documents", "document_positions", "annotation_ops"} <= tables
    assert con.execute("SELECT version_num FROM alembic_version").fetchone() == ("0009",)
    con.close()


def test_models_match_the_migrated_schema(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    url = _db_at(db, "head")
    engine = create_engine(url)
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    engine.dispose()
    assert diff == []


def test_downgrade_removes_the_007_schema(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    url = _db_at(db, "head")
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0008")
    finally:
        mig.dispose()
    con = sqlite3.connect(db)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    columns = {r[1] for r in con.execute("PRAGMA table_info(workspace_states)")}
    con.close()
    assert not ({"documents", "document_positions", "annotation_ops"} & tables)
    assert "tabs_json" not in columns and "split_json" not in columns
