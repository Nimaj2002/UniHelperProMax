"""Migration 0018 adds the proxy table and the two "Use proxy" switches (021 T006): existing rows
are untouched, switches default to off, and the downgrade removes everything again."""

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


def _at_0017(tmp_path: Path) -> tuple[Path, str]:
    db, url = _at_0010(tmp_path)
    upgrade_to_head_at(url, "0017")
    return db, url


def _proxy(con: sqlite3.Connection, **over: object) -> None:
    values: dict[str, object] = dict(
        user_id="u1",
        scheme="http",
        host="proxy.example",
        port=8080,
        version=1,
        created_at="x",
        updated_at="x",
    )
    values.update(over)
    _insert(con, "proxy_settings", **values)


def test_0018_keeps_rows_and_adds_proxy(tmp_path: Path) -> None:
    db, url = _at_0017(tmp_path)
    before = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in KEPT_TABLES}
    upgrade_to_head(create_engine(url))
    for table, rows in before.items():
        if table in ("transcription_settings", "ai_settings"):
            continue  # gained a column; checked below
        assert _rows(db, f"SELECT * FROM {table} ORDER BY 1") == rows, table
    for table in ("transcription_settings", "ai_settings"):
        assert all(r[-1] == 0 for r in _rows(db, f"SELECT use_proxy FROM {table}")), table
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    for bad in ({"scheme": "ftp"}, {"port": 0}, {"port": 65536}):
        with pytest.raises(sqlite3.IntegrityError):
            _proxy(con, **bad)
    _proxy(con)
    with pytest.raises(sqlite3.IntegrityError):  # one proxy per user
        _proxy(con)
    con.commit()
    con.close()
    assert _rows(db, "PRAGMA foreign_key_check") == []


def test_0018_downgrade_removes_proxy(tmp_path: Path) -> None:
    db, url = _at_0017(tmp_path)
    upgrade_to_head(create_engine(url))
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0017")
    finally:
        mig.dispose()
    names = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "proxy_settings" not in names
    cols = {r[1] for r in _rows(db, "PRAGMA table_info(ai_settings)")}
    assert "use_proxy" not in cols
