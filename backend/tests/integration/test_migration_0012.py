"""Migration 0012 adds the task board tables (012 T005): existing rows are untouched, the new
tables start empty with their constraints and partial unique index, and the downgrade drops
exactly them."""

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

NEW_TABLES = {"task_columns", "tasks", "task_checklist_items", "task_quick_notes"}


def _at_0011(tmp_path: Path) -> tuple[Path, str]:
    db, url = _at_0010(tmp_path)
    upgrade_to_head_at(url, "0011")
    return db, url


def _connect(db: Path) -> sqlite3.Connection:
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    return con


def test_0012_adds_empty_tables_and_keeps_rows(tmp_path: Path) -> None:
    db, url = _at_0011(tmp_path)
    kept = (*KEPT_TABLES, "event_series", "calendar_import_runs")
    before = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in kept}

    upgrade_to_head(create_engine(url))

    for table, rows in before.items():
        assert _rows(db, f"SELECT * FROM {table} ORDER BY 1") == rows, table
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert NEW_TABLES <= tables
    for table in NEW_TABLES:
        assert _rows(db, f"SELECT count(*) FROM {table}") == [(0,)]
    indexes = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='index'")}
    assert {
        "ix_tasks_user_column_position",
        "ix_tasks_course",
        "ix_tasks_trash",
        "uq_tasks_event_key",
    } <= indexes
    assert _rows(db, "PRAGMA foreign_key_check") == []


def test_0012_constraints(tmp_path: Path) -> None:
    db, url = _at_0011(tmp_path)
    upgrade_to_head(create_engine(url))
    con = _connect(db)
    _insert(con, "task_columns", id="col1", user_id="u1", name="To do", name_key="to do",
            position=0, version=1)  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # name, ignoring case
        _insert(con, "task_columns", id="col2", user_id="u1", name="TO DO", name_key="to do",
                position=1, version=1)  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # position
        _insert(con, "task_columns", id="col3", user_id="u1", name="Done", name_key="done",
                position=0, version=1)  # fmt: skip

    def task(tid: str, **extra: object) -> None:
        values: dict[str, object] = {"id": tid, "user_id": "u1", "column_id": "col1",
                                     "position": 0, "title": tid, "version": 1}  # fmt: skip
        _insert(con, "tasks", **{**values, **extra})

    task("t1", event_key="es1:2026-10-15")
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):  # one live task per occurrence
        task("t2", event_key="es1:2026-10-15")
    task("t3", event_key="es1:2026-10-15", deleted_at="2026-10-15T00:00:00+00:00")
    task("t4")
    task("t5")  # no event key: no limit
    with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
        task("t6", column_id="nope")
    con.commit()
    assert _rows(db, "SELECT description FROM tasks WHERE id = 't4'") == [("",)]

    _insert(con, "task_checklist_items", id="i1", user_id="u1", task_id="t1", text="step",
            position=0)  # fmt: skip
    _insert(con, "task_quick_notes", id="n1", user_id="u1", task_id="t1", version=1)
    assert con.execute("SELECT title, body FROM task_quick_notes").fetchall() == [("", "")]
    con.execute("DELETE FROM tasks WHERE id = 't1'")  # checklist and notes go with the task
    assert con.execute("SELECT count(*) FROM task_checklist_items").fetchone() == (0,)
    assert con.execute("SELECT count(*) FROM task_quick_notes").fetchone() == (0,)
    con.close()


def test_downgrade_drops_only_the_new_tables(tmp_path: Path) -> None:
    db, url = _at_0011(tmp_path)
    upgrade_to_head(create_engine(url))
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0011")
    finally:
        mig.dispose()
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert not (NEW_TABLES & tables)
    assert {"calendar_import_runs", "event_series", "courses"} <= tables
    assert _rows(db, "PRAGMA foreign_key_check") == []
