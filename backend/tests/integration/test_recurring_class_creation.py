"""Constitution VI critical flow: recurring class creation (real SQLite + temp storage)."""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from tests.conftest import assert_problem
from tests.contract.test_classes_sessions_read import new_class_body
from unihelper.models import ClassSeries, Course, Semester, Year

pytestmark = pytest.mark.integration
API = "/api/v1"


def test_inline_creation_creates_folders_and_sessions(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    body = new_class_body()
    body["course"]["new"]["semester"]["new"]["endDate"] = "2027-01-10"
    r = c.post(f"{API}/classes", json=body)
    assert r.status_code == 201, r.text
    assert (tmp_data_dir / "files" / "owner" / "2026" / "Fall 2026" / "CS 201").is_dir()

    sessions = c.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2027-02-28"}).json()
    got = [date.fromisoformat(s["date"]) for s in sessions]
    expected = []
    d = date(2026, 9, 28)
    while d <= date(2027, 1, 10):
        if d.weekday() in (0, 2):
            expected.append(d)
        d += timedelta(days=1)
    assert got == expected
    # Istanbul has no DST: always +03:00
    assert all(s["start"].endswith("+03:00") for s in sessions)
    assert sessions[0]["start"] == "2026-09-28T10:00:00+03:00"


def test_dst_member_in_berlin(make_member: Callable[..., TestClient]) -> None:
    m = make_member(username="berlin", timezone="Europe/Berlin")
    body = new_class_body(
        startDate="2026-10-19",
        recurrence={"freq": "weekly", "byWeekday": ["MO"], "end": {"kind": "count", "count": 2}},
    )
    assert m.post(f"{API}/classes", json=body).status_code == 201
    s = m.get(f"{API}/sessions", params={"from": "2026-10-01", "to": "2026-10-31"}).json()
    assert [x["start"] for x in s] == ["2026-10-19T10:00:00+02:00", "2026-10-26T10:00:00+01:00"]


def test_inline_creation_is_atomic(
    owner_client: TestClient, app: Any, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unihelper.services import class_service

    def boom(*_a: Any, **_k: Any) -> None:
        raise RuntimeError("simulated failure after hierarchy inserts")

    monkeypatch.setattr(class_service, "_insert_series", boom)
    body = new_class_body()
    quiet = TestClient(app, raise_server_exceptions=False, cookies=dict(owner_client.cookies))
    quiet.headers["X-CSRF-Token"] = owner_client.headers["X-CSRF-Token"]
    r = quiet.post(f"{API}/classes", json=body)
    assert_problem(r, 500, "internal_error")
    with app.state.sessionmaker() as db:
        for model in (Year, Semester, Course, ClassSeries):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_member_cannot_see_owner_sessions(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    created = owner_client.post(f"{API}/classes", json=new_class_body()).json()
    member = make_member()
    r = member.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2026-12-31"})
    assert r.status_code == 200 and r.json() == []
    assert member.get(f"{API}/course-tree").json() == []
    assert_problem(member.get(f"{API}/classes/{created['lineageId']}"), 404, "not_found")
