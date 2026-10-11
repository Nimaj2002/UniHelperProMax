"""Migration 0011 adds the calendar import tables (010 T007): existing rows are untouched, the
new tables start empty and the downgrade drops exactly them."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine

from tests.integration.test_migration_0008 import _db_at, _insert
from tests.integration.test_migration_0010 import _populate, _rows
from unihelper.db.migrate import _migration_engine, alembic_config, upgrade_to_head

pytestmark = pytest.mark.integration

NEW_TABLES = {"calendar_import_uploads", "calendar_import_runs", "calendar_import_sources"}
KEPT_TABLES = (
    "class_series",
    "courses",
    "session_folders",
    "session_exceptions",
    "notes",
    "documents",
)


def _at_0010(tmp_path: Path) -> tuple[Path, str]:
    db = tmp_path / "app.db"
    url = _db_at(db, "0009")
    _populate(db)
    upgrade_to_head_at(url, "0010")
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    _insert(con, "event_series", id="es1", user_id="u1", semester_id="s1", lineage_id="es1",
            title="AI Seminar", color="blue", start_date="2026-10-15", start_time="14:00:00",
            end_time="15:00:00", freq="none", interval_weeks=1, by_weekday="",
            end_kind="never", version=1)  # fmt: skip
    con.commit()
    con.close()
    return db, url


def upgrade_to_head_at(url: str, revision: str) -> None:
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, revision)
    finally:
        mig.dispose()


def test_0011_adds_empty_tables_and_keeps_rows(tmp_path: Path) -> None:
    db, url = _at_0010(tmp_path)
    before = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in (*KEPT_TABLES, "event_series")}

    upgrade_to_head(create_engine(url))

    for table, rows in before.items():
        assert _rows(db, f"SELECT * FROM {table} ORDER BY 1") == rows, table
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert NEW_TABLES <= tables
    for table in NEW_TABLES:
        assert _rows(db, f"SELECT count(*) FROM {table}") == [(0,)]
    assert _rows(db, "PRAGMA foreign_key_check") == []


def test_0011_constraints(tmp_path: Path) -> None:
    db, url = _at_0010(tmp_path)
    upgrade_to_head(create_engine(url))
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    _insert(con, "calendar_import_runs", id="r1", user_id="u1", file_name="a.ics",
            file_sha256="0" * 64, created_json="{}", updated_json="{}", summary_json="{}",
            created_at="2026-10-12T00:00:00+00:00")  # fmt: skip
    _insert(con, "calendar_import_sources", id="src1", user_id="u1", source_uid="uid-1",
            recurrence_key="", kind="class", lineage_id="l1", first_run_id="r1")  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        _insert(con, "calendar_import_sources", id="src2", user_id="u1", source_uid="uid-1",
                recurrence_key="", kind="event", lineage_id="l2")  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="kind"):
        _insert(con, "calendar_import_sources", id="src3", user_id="u1", source_uid="uid-3",
                recurrence_key="", kind="task", lineage_id="l3")  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="size"):
        _insert(con, "calendar_import_uploads", id="up1", user_id="u1", file_name="a.ics",
                size=5242881, sha256="0" * 64, staged_name="x.part", event_count=1,
                created_at="t", expires_at="t")  # fmt: skip
    # deleting a run keeps its sources (SET NULL)
    con.execute("DELETE FROM calendar_import_runs WHERE id = 'r1'")
    assert con.execute("SELECT first_run_id FROM calendar_import_sources").fetchall() == [(None,)]
    con.close()


def test_downgrade_drops_only_the_new_tables(tmp_path: Path) -> None:
    db, url = _at_0010(tmp_path)
    upgrade_to_head(create_engine(url))
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0010")
    finally:
        mig.dispose()
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert not (NEW_TABLES & tables)
    assert {"event_series", "trash_entries", "class_series"} <= tables
    assert _rows(db, "PRAGMA foreign_key_check") == []
