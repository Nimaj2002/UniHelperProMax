"""Task CSV export (012 T098, research R19): UTF-8 with BOM, RFC 4180 quoting, CRLF rows,
checklist and quick-note cells, header-only when there are no tasks."""

from __future__ import annotations

import csv
import io
from collections.abc import Iterator
from typing import Any

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from unihelper.models import Base, User
from unihelper.schemas.tasks import TaskCreate
from unihelper.services import task_service as ts

pytestmark = pytest.mark.unit

HEADER = (
    "Title,Description,Column,Due date,Due time,Course,Linked event,Checklist,Quick notes,"
    "Completed at"
)


def parse(data: bytes) -> list[list[str]]:
    assert data.startswith(b"\xef\xbb\xbf")
    return list(csv.reader(io.StringIO(data.decode("utf-8-sig"), newline="")))


def test_empty_export_is_header_only() -> None:
    data = ts.csv_bytes([])
    assert data == ("﻿" + HEADER + "\r\n").encode("utf-8")


def test_quoting_newlines_and_turkish_characters() -> None:
    row = (
        'Say "hi", then leave',
        "line 1\nline 2",
        "Yapılacaklar",
        "2026-11-02",
        "09:30",
        "Çalışma Yöntemleri",
        "Şölen (2026-10-15)",
        "",
        "",
        "",
    )
    data = ts.csv_bytes([row])
    text = data.decode("utf-8-sig")
    assert text.startswith(HEADER + "\r\n")
    assert '"Say ""hi"", then leave","line 1\nline 2",Yapılacaklar,' in text
    assert text.endswith(",,,\r\n")
    assert parse(data)[1] == list(row)
    assert "ğüşıöç".encode() in ts.csv_bytes([("ğüşıöç",) + ("",) * 9])


def test_checklist_and_quick_note_cells() -> None:
    assert ts.checklist_cell([("Read", True), ("Write", False)]) == "[x] Read\n[ ] Write"
    assert ts.checklist_cell([]) == ""
    cell = ts.quick_notes_cell([("Idea", "Use diagrams"), ("", "No title"), ("Only title", "")])
    assert cell == "Idea: Use diagrams\n\nNo title\n\nOnly title"
    parsed = parse(ts.csv_bytes([("T", "", "", "", "", "", "", "", cell, "")]))
    assert parsed[1][8] == cell


@pytest.fixture
def db() -> Iterator[Session]:
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn: Any, _record: Any) -> None:
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False, expire_on_commit=False) as session:
        yield session
    engine.dispose()


def test_export_in_board_order_live_only(db: Session) -> None:
    user = User(username="owner", password_hash="x", role="owner", timezone="Europe/Istanbul")
    db.add(user)
    db.flush()
    _todo, doing, _done = ts.tcs.ensure_columns(db, user)
    ts.create_task(db, user, TaskCreate(title="Second", column_id=doing.id))
    ts.create_task(db, user, TaskCreate(title="First"))
    gone = ts.create_task(db, user, TaskCreate(title="Deleted"))
    ts.soft_delete_task(db, user, ts.get_task(db, user, gone["id"]))
    rows = parse(ts.export_csv(db, user))
    assert [r[0] for r in rows[1:]] == ["First", "Second"]
    assert [r[2] for r in rows[1:]] == ["To do", "In progress"]
    assert ts.export_filename(user).startswith("UniHelperProMax-tasks-")
    assert ts.export_filename(user).endswith(".csv")
