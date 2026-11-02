"""Migration 0017 adds the time tracking tables (020 T008): existing rows are untouched, one
timer per user is enforced by the primary key, and the downgrade drops the tables."""

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
TABLES = ("time_tags", "time_entries", "time_timers")


def _at_0016(tmp_path: Path) -> tuple[Path, str]:
    db, url = _at_0010(tmp_path)
    upgrade_to_head_at(url, "0016")
    return db, url


def _timer(con: sqlite3.Connection) -> None:
    _insert(con, "time_timers", user_id="u1", style="track", state="running",
            started_at="2026-11-02T09:00:00.000+00:00", paused_ms=0, hide_panels=0,
            reminder_ack=0, description="", version=1)  # fmt: skip


def test_0017_keeps_rows_and_adds_tables(tmp_path: Path) -> None:
    db, url = _at_0016(tmp_path)
    before = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in KEPT_TABLES}
    upgrade_to_head(create_engine(url))
    for table, rows in before.items():
        assert _rows(db, f"SELECT * FROM {table} ORDER BY 1") == rows, table
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    _timer(con)
    with pytest.raises(sqlite3.IntegrityError):  # at most one timer per user
        _timer(con)
    con.commit()
    con.close()
    assert _rows(db, "PRAGMA foreign_key_check") == []


def test_0017_downgrade_drops_tables(tmp_path: Path) -> None:
    db, url = _at_0016(tmp_path)
    upgrade_to_head(create_engine(url))
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0016")
    finally:
        mig.dispose()
    names = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert not names & set(TABLES)
