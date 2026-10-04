from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note, make_session, save
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
NOTES = Path("files/owner/2026/Fall 2026/CS 201/2026-09-28/notes")


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def test_rename(
    owner_client: TestClient, tmp_data_dir: Path, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    key = make_session(c)
    n = create_note(c, key, "Untitled", "body")
    create_note(c, key, "Other")
    r = c.patch(f"{API}/notes/{n['id']}", json={"name": "Midterm review"}, headers=im(1))
    assert r.status_code == 200
    check(r.json(), "NoteMeta", spec="002")
    assert r.json()["fileName"] == "Midterm review.md" and r.json()["version"] == 2
    assert (tmp_data_dir / NOTES / "Midterm review.md").read_text() == "body"
    assert not (tmp_data_dir / NOTES / "Untitled.md").exists()
    assert_problem(
        c.patch(f"{API}/notes/{n['id']}", json={"name": "other"}, headers=im(2)), 409, "name_taken"
    )
    assert_problem(
        c.patch(f"{API}/notes/{n['id']}", json={"name": "x"}, headers=im(1)),
        412,
        "version_conflict",
    )
    assert c.patch(f"{API}/notes/{n['id']}", json={"name": " "}, headers=im(2)).status_code == 422
    assert_problem(
        make_member().patch(f"{API}/notes/{n['id']}", json={"name": "x"}, headers=im(2)),
        404,
        "not_found",
    )


def test_rename_rolls_back_file_on_failure(
    owner_client: TestClient, app: Any, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    n = create_note(c, make_session(c), "Before")
    from unihelper.services import note_service

    original = note_service.meta

    def boom(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("simulated failure after the file was renamed")

    monkeypatch.setattr(note_service, "meta", boom)
    quiet = TestClient(app, raise_server_exceptions=False, cookies=dict(c.cookies))
    quiet.headers["X-CSRF-Token"] = c.headers["X-CSRF-Token"]
    assert (
        quiet.patch(f"{API}/notes/{n['id']}", json={"name": "After"}, headers=im(1)).status_code
        == 500
    )
    monkeypatch.setattr(note_service, "meta", original)
    assert (tmp_data_dir / NOTES / "Before.md").exists()
    assert not (tmp_data_dir / NOTES / "After.md").exists()


def test_delete(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    a, b = create_note(c, key, "A"), create_note(c, key, "B")
    saved = save(c, a, "x").json()
    assert_problem(c.delete(f"{API}/notes/{a['id']}", headers=im(1)), 412, "version_conflict")
    assert c.delete(f"{API}/notes/{a['id']}", headers=im(saved["version"])).status_code == 204
    assert not (tmp_data_dir / NOTES / "A.md").exists()
    assert (tmp_data_dir / NOTES / "B.md").exists()
    assert [n["id"] for n in c.get(f"{API}/sessions/{key}/notes").json()] == [b["id"]]
    assert_problem(c.delete(f"{API}/notes/{a['id']}", headers=im(1)), 404, "not_found")
