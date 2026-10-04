from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.integration
API = "/api/v1"


def tree(c: TestClient) -> dict[str, Any]:
    node = c.get(f"{API}/course-tree").json()[0]
    return {
        "year": node["year"],
        "semester": node["semesters"][0]["semester"],
        "course": node["semesters"][0]["courses"][0],
    }


def test_rename_moves_folders(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    c.post(f"{API}/classes", json=new_class_body())
    root = tmp_data_dir / "files" / "owner"
    (root / "2026" / "Fall 2026" / "CS 201" / "keep.md").write_text("x")
    t = tree(c)
    c.patch(
        f"{API}/courses/{t['course']['id']}",
        json={"name": "CS 201: Data Structures"},
        headers={"If-Match": f'"{t["course"]["version"]}"'},
    )
    c.patch(
        f"{API}/semesters/{t['semester']['id']}",
        json={"name": "Autumn/2026"},
        headers={"If-Match": f'"{t["semester"]["version"]}"'},
    )
    c.patch(
        f"{API}/years/{t['year']['id']}",
        json={"name": "AY 2026"},
        headers={"If-Match": f'"{t["year"]["version"]}"'},
    )
    moved = root / "AY 2026" / "Autumn-2026" / "CS 201- Data Structures" / "keep.md"
    assert moved.read_text() == "x"
    assert not (root / "2026").exists()


def test_rename_collision_suffix(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    a = c.post(f"{API}/years", json={"name": "A:B"}).json()
    b = c.post(f"{API}/years", json={"name": "Other"}).json()
    assert a["folderName"] == "A-B"
    r = c.patch(f"{API}/years/{b['id']}", json={"name": "A/B"}, headers={"If-Match": '"1"'})
    assert r.json()["folderName"] == "A-B (2)"
    assert (tmp_data_dir / "files" / "owner" / "A-B (2)").is_dir()


def test_failed_commit_restores_folder(
    owner_client: TestClient, app: Any, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    y = c.post(f"{API}/years", json={"name": "2026"}).json()
    from unihelper.services import hierarchy_service

    original = hierarchy_service._rename

    def rename_then_fail(*args: Any, **kwargs: Any) -> Any:
        original(*args, **kwargs)
        raise RuntimeError("simulated DB failure after the folder was renamed")

    monkeypatch.setattr(hierarchy_service, "_rename", rename_then_fail)
    quiet = TestClient(app, raise_server_exceptions=False, cookies=dict(c.cookies))
    quiet.headers["X-CSRF-Token"] = c.headers["X-CSRF-Token"]
    r = quiet.patch(f"{API}/years/{y['id']}", json={"name": "2027"}, headers={"If-Match": '"1"'})
    assert_problem(r, 500, "internal_error")
    root = tmp_data_dir / "files" / "owner"
    assert (root / "2026").is_dir() and not (root / "2027").exists()
    assert c.get(f"{API}/years").json()[0]["name"] == "2026"


def test_semester_end_moves_sessions(owner_client: TestClient) -> None:
    c = owner_client
    c.post(f"{API}/classes", json=new_class_body())  # Mon+Wed until semester end (2026-10-31)
    t = tree(c)

    def last_date() -> str:
        s = c.get(f"{API}/sessions", params={"from": "2026-09-01", "to": "2027-03-01"}).json()
        return str(s[-1]["date"])

    assert last_date() == "2026-10-28"
    r = c.patch(
        f"{API}/semesters/{t['semester']['id']}",
        json={"endDate": "2026-10-15"},
        headers={"If-Match": f'"{t["semester"]["version"]}"'},
    )
    assert last_date() == "2026-10-14"
    c.patch(
        f"{API}/semesters/{t['semester']['id']}",
        json={"endDate": "2026-11-30"},
        headers={"If-Match": f'"{r.json()["version"]}"'},
    )
    assert last_date() == "2026-11-30"
