"""Migration 0010 rebuilds `session_folders` and `session_exceptions` for events and the Trash
(009 T006): every existing row and reference survives, old folders become `kind = 'class'`,
and a course already in a `_Events` folder is left untouched (research R1)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import create_engine

from tests.integration.test_migration_0008 import NOW, _db_at, _insert, _job, _seed
from unihelper.db.migrate import _migration_engine, alembic_config, upgrade_to_head

pytestmark = pytest.mark.integration

CONTENT_TABLES = (
    "notes",
    "recordings",
    "transcription_jobs",
    "documents",
    "annotation_ops",
    "workspace_states",
    "class_series",
    "courses",
)
OLD_FOLDER_COLUMNS = (
    "id, user_id, course_id, lineage_id, original_date, folder_name, folder_key, start_time,"
    " end_time, title, location, created_at"
)
OLD_EXCEPTION_COLUMNS = (
    "id, user_id, lineage_id, original_date, kind, start_time, end_time, location, version"
)


def _rows(db: Path, sql: str) -> list[tuple[object, ...]]:
    con = sqlite3.connect(db)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def _populate(db: Path) -> None:
    """A 0009 database: one class with two session folders holding notes, a recording with a
    transcription job, a document with annotation ops, workspace states and exceptions, plus a
    second course whose folder is `_Events`."""
    _seed(db)  # user u1, 2026/Fall/CS, folder f1, recording r1, transcription job j1
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("UPDATE session_folders SET folder_name = '2026-09-28', folder_key = '2026-09-28'")
    _insert(con, "class_series", id="cs1", user_id="u1", course_id="c1", lineage_id="l1",
            color="blue", start_date="2026-09-28", start_time="10:00:00", end_time="11:00:00",
            freq="weekly", interval_weeks=1, by_weekday="MO", end_kind="never",
            version=1)  # fmt: skip
    _insert(con, "session_folders", id="f2", user_id="u1", course_id="c1", lineage_id="l1",
            original_date="2026-10-05", folder_name="2026-10-05", folder_key="2026-10-05",
            start_time="10:00:00", end_time="11:00:00", title="Midterm review",
            location="Room 4")  # fmt: skip
    for nid, folder in (("n1", "f1"), ("n2", "f2")):
        _insert(con, "notes", id=nid, user_id="u1", session_folder_id=folder, name="Lecture",
                name_key="lecture", file_name="Lecture.md", file_key="lecture.md",
                content_hash="h", size=7, version=2)  # fmt: skip
    _insert(con, "documents", id="d1", user_id="u1", session_folder_id="f2", name="Slides",
            name_key="slides", file_name="Slides.pdf", file_key="slides.pdf",
            original_file_name="slides.pdf", size=100, sha256="0" * 64, encrypted=0,
            page_count=3, uploaded_at=NOW, version=1)  # fmt: skip
    _insert(con, "annotation_ops", op_id="op1", document_id="d1", result_json="{}",
            applied_at=NOW)  # fmt: skip
    _insert(con, "workspace_states", user_id="u1", lineage_id="l1", original_date="2026-10-05",
            open_note_ids='["n2"]', active_note_id="n2",
            tabs_json='[{"kind":"document"}]')  # fmt: skip
    _insert(con, "session_exceptions", id="e1", user_id="u1", lineage_id="l1",
            original_date="2026-10-12", kind="cancelled", version=1)  # fmt: skip
    _insert(con, "session_exceptions", id="e2", user_id="u1", lineage_id="l1",
            original_date="2026-10-19", kind="modified", start_time="12:00:00",
            end_time="13:00:00", location="Lab", version=3)  # fmt: skip
    _insert(con, "courses", id="c2", user_id="u1", semester_id="s1", name="_Events",
            name_key="_events", folder_name="_Events", folder_key="_events",
            default_color="green")  # fmt: skip
    con.commit()
    con.close()


def test_0010_keeps_every_row_and_reference(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    url = _db_at(db, "0009")
    _populate(db)
    content = {t: _rows(db, f"SELECT * FROM {t} ORDER BY 1") for t in CONTENT_TABLES}
    folders = _rows(db, f"SELECT {OLD_FOLDER_COLUMNS} FROM session_folders ORDER BY id")
    exceptions = _rows(db, f"SELECT {OLD_EXCEPTION_COLUMNS} FROM session_exceptions ORDER BY id")
    job = _job(db)

    upgrade_to_head(create_engine(url))

    for table, rows in content.items():
        assert _rows(db, f"SELECT * FROM {table} ORDER BY 1") == rows, table
    assert _job(db) == job
    assert _rows(db, f"SELECT {OLD_FOLDER_COLUMNS} FROM session_folders ORDER BY id") == folders
    assert (
        _rows(
            db,
            "SELECT kind, semester_id, trash_entry_id, origin_path"
            " FROM session_folders ORDER BY id",
        )
        == [("class", None, None, None)] * 2
    )
    assert (
        _rows(db, f"SELECT {OLD_EXCEPTION_COLUMNS} FROM session_exceptions ORDER BY id")
        == exceptions
    )
    assert (
        _rows(
            db,
            "SELECT title, color, links_json, moved_date, detached FROM session_exceptions",
        )
        == [(None, None, None, None, 0)] * 2
    )
    # the course already in `_Events` is not renamed (it is flagged by the course tree instead)
    assert _rows(db, "SELECT name, folder_name FROM courses WHERE id = 'c2'") == [
        ("_Events", "_Events")
    ]
    assert _rows(db, "PRAGMA foreign_key_check") == []
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"event_series", "event_links", "trash_entries"} <= tables
    (version,) = _rows(db, "SELECT version_num FROM alembic_version")[0]
    assert version >= "0010"


def test_0010_constraints(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    url = _db_at(db, "0009")
    _populate(db)
    upgrade_to_head(create_engine(url))
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys=ON")
    # an event folder hangs off its semester; a class folder needs its course
    _insert(con, "session_folders", id="f3", user_id="u1", semester_id="s1", kind="event",
            lineage_id="ev1", original_date="2026-10-15", folder_name="2026-10-15 AI Seminar",
            folder_key="2026-10-15 ai seminar", start_time="14:00:00",
            end_time="15:30:00")  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="owner"):
        _insert(con, "session_folders", id="f4", user_id="u1", kind="class", lineage_id="l9",
                original_date="2026-10-15", folder_name="a", folder_key="a",
                start_time="14:00:00", end_time="15:00:00")  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="UNIQUE"):
        _insert(con, "session_folders", id="f5", user_id="u1", semester_id="s1", kind="event",
                lineage_id="ev2", original_date="2026-10-15",
                folder_name="2026-10-15 AI Seminar", folder_key="2026-10-15 ai seminar",
                start_time="14:00:00", end_time="15:30:00")  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="title_len"):
        _insert(con, "event_series", id="es1", user_id="u1", semester_id="s1", lineage_id="es1",
                title="", color="blue", start_date="2026-10-15", start_time="14:00:00",
                end_time="15:00:00", freq="none", interval_weeks=1, by_weekday="",
                end_kind="never", version=1)  # fmt: skip
    with pytest.raises(sqlite3.IntegrityError, match="color"):
        _insert(con, "session_exceptions", id="e9", user_id="u1", lineage_id="l1",
                original_date="2026-11-02", kind="modified", color="mauve", version=1)  # fmt: skip
    con.close()


def test_downgrade_restores_the_0009_schema(tmp_path: Path) -> None:
    db = tmp_path / "app.db"
    url = _db_at(db, "0009")
    _populate(db)
    folders = _rows(db, f"SELECT {OLD_FOLDER_COLUMNS} FROM session_folders ORDER BY id")
    upgrade_to_head(create_engine(url))
    cfg = alembic_config(url)
    mig = _migration_engine(url)
    try:
        with mig.begin() as conn:
            cfg.attributes["connection"] = conn
            command.downgrade(cfg, "0009")
    finally:
        mig.dispose()
    assert _rows(db, f"SELECT {OLD_FOLDER_COLUMNS} FROM session_folders ORDER BY id") == folders
    columns = {r[1] for r in _rows(db, "PRAGMA table_info(session_folders)")}
    assert not ({"kind", "semester_id", "trash_entry_id", "origin_path"} & columns)
    tables = {r[0] for r in _rows(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert not ({"event_series", "event_links", "trash_entries"} & tables)
    assert _rows(db, "PRAGMA foreign_key_check") == []
