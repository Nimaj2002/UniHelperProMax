"""Programmatic Alembic upgrade, run at app startup (idempotent when already at head).

Migrations run on their own short-lived connection with foreign keys OFF and real transactional
DDL (006 research I2). SQLite rebuilds a table to change a constraint (`batch_alter_table`:
create → copy → DROP → rename), and with `PRAGMA foreign_keys=ON` the DROP runs an implicit
DELETE that fires `ON DELETE CASCADE` — e.g. rebuilding `recordings` would delete every
transcription job. That pragma can't change inside a transaction, so it is set when the
connection opens, and `PRAGMA foreign_key_check` runs before commit: a migration that leaves a
dangling reference is rolled back as a whole (SQLite's documented 12-step ALTER procedure).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


class ForeignKeyCheckError(RuntimeError):
    pass


def alembic_config(db_url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", db_url)
    return cfg


def _migration_engine(url: str) -> Engine:
    """FKs off, and pysqlite's implicit transactions replaced by an explicit BEGIN so DDL is
    transactional too (SQLAlchemy's documented pysqlite recipe)."""
    engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 5})

    @event.listens_for(engine, "connect")
    def _connect(dbapi_conn: Any, _record: Any) -> None:
        dbapi_conn.isolation_level = None
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=OFF")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.close()

    @event.listens_for(engine, "begin")
    def _begin(conn: Any) -> None:
        conn.exec_driver_sql("BEGIN IMMEDIATE")

    return engine


def upgrade_to_head(engine: Engine) -> None:
    url = engine.url.render_as_string(hide_password=False)
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, "head")
            dangling = conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            if dangling:
                tables = sorted({row[0] for row in dangling})
                raise ForeignKeyCheckError(
                    f"Migration left rows with missing references in: {', '.join(tables)}"
                )
    finally:
        mig.dispose()
