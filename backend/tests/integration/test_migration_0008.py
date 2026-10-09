"""Migration 0008 rebuilds `recordings`; it must not cascade-delete transcription jobs, and a
migration that leaves dangling references must roll back entirely (006 research I2, T005)."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from sqlalchemy import create_engine

from unihelper.config import Settings
from unihelper.db.engine import make_engine
from unihelper.db.migrate import (
    ForeignKeyCheckError,
    _migration_engine,
    alembic_config,
    upgrade_to_head,
)

pytestmark = pytest.mark.integration

NOW = "2026-10-01T10:00:00.000+00:00"
_FILL = {"VARCHAR": "x", "TEXT": "", "INTEGER": 0, "BOOLEAN": 0, "FLOAT": 0.0}


def _db_at(path: Path, revision: str) -> str:
    url = f"sqlite:///{path}"
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.upgrade(cfg, revision)
    finally:
        mig.dispose()
    return url


def _insert(con: sqlite3.Connection, table: str, **values: Any) -> None:
    """Insert a row, filling other NOT NULL columns with harmless values."""
    for _cid, name, ctype, notnull, default, _pk in con.execute(f"PRAGMA table_info({table})"):
        if name in values or not notnull or default is not None:
            continue
        base = ctype.split("(")[0].upper()
        values[name] = NOW if name.endswith("_at") else _FILL.get(base, "x")
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    con.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(values.values()))


def _seed(path: Path) -> None:
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys=ON")
    _insert(con, "users", id="u1", username="owner", role="owner", timezone="UTC")
    _insert(con, "years", id="y1", user_id="u1", name="2026", name_key="2026", position=0)
    _insert(con, "semesters", id="s1", user_id="u1", year_id="y1", name="Fall", name_key="fall")
    _insert(
        con,
        "courses",
        id="c1",
        user_id="u1",
        semester_id="s1",
        name="CS",
        name_key="cs",
        default_color="blue",
    )
    _insert(
        con,
        "session_folders",
        id="f1",
        user_id="u1",
        course_id="c1",
        lineage_id="l1",
        original_date="2026-09-28",
        start_time="10:00:00",
        end_time="11:00:00",
    )
    _insert(
        con,
        "recordings",
        id="r1",
        user_id="u1",
        session_folder_id="f1",
        name="Recording 10:02",
        name_key="recording 10:02",
        file_name="Recording 10-02.webm",
        file_key="recording 10-02.webm",
        mime_type="audio/webm",
        status="complete",
        started_at=NOW,
        duration_ms=60000,
        size=1234,
        version=3,
    )
    _insert(
        con,
        "transcription_jobs",
        id="j1",
        user_id="u1",
        recording_id="r1",
        note_name="Lecture",
        language="en",
        provider_id="voice_studio",
        status="completed",
        part_count=1,
        appended_text="hello",
    )
    con.commit()
    con.close()


def _job(path: Path) -> tuple[Any, ...] | None:
    con = sqlite3.connect(path)
    try:
        return con.execute("SELECT * FROM transcription_jobs WHERE id = 'j1'").fetchone()
    finally:
        con.close()


def test_0008_keeps_transcription_history(tmp_path: Path) -> None:
    settings = Settings(data_dir=tmp_path)
    db = settings.db_path
    url = _db_at(db, "0007")
    _seed(db)
    job_before = _job(db)
    assert job_before is not None

    upgrade_to_head(create_engine(url))

    assert _job(db) == job_before  # the rebuild did not cascade-delete or alter the job
    con = sqlite3.connect(db)
    row = con.execute(
        "SELECT id, name, file_name, version, origin, original_file_name FROM recordings"
    ).fetchall()
    assert row == [("r1", "Recording 10:02", "Recording 10-02.webm", 3, "recorded", None)]
    (version,) = con.execute("SELECT version_num FROM alembic_version").fetchone()
    assert version >= "0008"  # upgraded through 0008 (later migrations may follow)
    indexes = {r[1] for r in con.execute("PRAGMA index_list(recordings)")}
    assert {"ix_recordings_session_folder_id", "ix_recordings_user_id"} <= indexes
    con.close()

    # app connections get foreign keys back, and the new mime types are allowed
    app_engine = make_engine(settings)
    with app_engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        conn.exec_driver_sql(
            "INSERT INTO recordings (id, user_id, session_folder_id, name, name_key, file_name,"
            " file_key, mime_type, status, started_at, duration_ms, size, next_seq, created_at,"
            " updated_at, version, origin) VALUES ('r2', 'u1', 'f1', 'Lecture', 'lecture',"
            " 'Lecture.mp3', 'lecture.mp3', 'audio/mpeg', 'complete', :t, 0, 0, 0, :t, :t, 1,"
            " 'imported')".replace(":t", f"'{NOW}'")
        )
        conn.commit()
    app_engine.dispose()


def test_dangling_reference_rolls_back_the_upgrade(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    url = _db_at(db, "0007")
    _seed(db)
    con = sqlite3.connect(db)  # foreign keys are off by default on a plain connection
    _insert(
        con,
        "transcription_jobs",
        id="j2",
        user_id="u1",
        recording_id="gone",
        note_name="Lecture",
        language="en",
        provider_id="voice_studio",
        status="completed",
        part_count=1,
    )
    con.commit()
    con.close()

    with pytest.raises(ForeignKeyCheckError, match="transcription_jobs"):
        upgrade_to_head(create_engine(url))

    con = sqlite3.connect(db)
    assert con.execute("SELECT version_num FROM alembic_version").fetchone() == ("0007",)
    columns = {r[1] for r in con.execute("PRAGMA table_info(recordings)")}
    assert "origin" not in columns  # the table rebuild was rolled back too
    leftovers = con.execute("SELECT name FROM sqlite_master WHERE name LIKE '_alembic_tmp%'")
    assert leftovers.fetchall() == []
    con.close()
