"""018 General notes: `/general-notes` plus the reused `/notes/{id}` endpoints for notes that
belong to no session; files live in `<user>/General Notes/`."""

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


def general(c: TestClient, name: str, content: str = "") -> dict[str, Any]:
    r = c.post(f"{API}/general-notes", json={"name": name, "content": content})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def folder(tmp_data_dir: Path, user: str = "owner") -> Path:
    return tmp_data_dir / "files" / user / "General Notes"


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def test_create_and_list(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    r = c.get(f"{API}/general-notes")
    assert r.status_code == 200 and r.json() == []  # folder missing: empty, not an error
    a = general(c, "Ideas", "# idea\n")
    check(a, "GeneralNote", spec="018")
    assert a["sessionKey"] is None and a["fileName"] == "Ideas.md" and a["content"] == "# idea\n"
    assert (folder(tmp_data_dir) / "Ideas.md").read_text() == "# idea\n"
    b = general(c, "Groceries")
    assert save(c, a, "# idea\nmore\n").status_code == 200  # a changed last
    lst = c.get(f"{API}/general-notes").json()
    check(lst, "GeneralNoteMeta", many=True, spec="018")
    assert {n["id"] for n in lst} == {a["id"], b["id"]}
    assert lst[0]["updatedAt"] >= lst[1]["updatedAt"]


@pytest.mark.parametrize("name", ["", " ", "x" * 121])
def test_create_invalid_name(owner_client: TestClient, name: str) -> None:
    r = owner_client.post(f"{API}/general-notes", json={"name": name})
    assert r.status_code == 422, r.text


def test_create_rejects_binary_and_duplicates(owner_client: TestClient) -> None:
    c = owner_client
    assert_problem(
        c.post(f"{API}/general-notes", json={"name": "Bin", "content": "a\x00b"}),
        422,
        "content_not_text",
    )
    general(c, "Ideas")
    body = assert_problem(
        c.post(f"{API}/general-notes", json={"name": " ideas "}), 409, "name_taken"
    )
    assert "general note" in body["title"]


def test_session_and_general_names_are_separate(owner_client: TestClient) -> None:
    c = owner_client
    create_note(c, make_session(c), "Ideas")
    general(c, "Ideas")  # no clash with a session note of the same name


def test_open_save_and_conflicts(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    n = general(c, "Draft")
    r = c.get(f"{API}/notes/{n['id']}")
    assert r.status_code == 200 and r.json()["sessionKey"] is None
    saved = save(c, n, "one")
    assert saved.status_code == 200
    assert_problem(save(c, n, "stale"), 412, "version_conflict")
    (folder(tmp_data_dir) / "Draft.md").write_text("edited outside")
    fresh = {**n, "version": saved.json()["version"], "hash": saved.json()["hash"]}
    assert_problem(save(c, fresh, "mine"), 409, "file_changed_on_disk")
    assert (folder(tmp_data_dir) / "Draft.md").read_text() == "edited outside"


def test_rename_and_delete(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    a = general(c, "General note 2026-10-29 14-05")
    b = general(c, "Other")
    r = c.patch(f"{API}/notes/{a['id']}", json={"name": "Buy milk"}, headers=im(1))
    assert r.status_code == 200, r.text
    assert r.json()["sessionKey"] is None and r.json()["fileName"] == "Buy milk.md"
    assert (folder(tmp_data_dir) / "Buy milk.md").exists()
    assert not (folder(tmp_data_dir) / "General note 2026-10-29 14-05.md").exists()
    assert_problem(
        c.patch(f"{API}/notes/{b['id']}", json={"name": "buy MILK"}, headers=im(1)),
        409,
        "name_taken",
    )
    assert c.delete(f"{API}/notes/{b['id']}", headers=im(1)).status_code == 204
    assert not (folder(tmp_data_dir) / "Other.md").exists()
    assert [n["id"] for n in c.get(f"{API}/general-notes").json()] == [a["id"]]


def test_other_users_cannot_reach_general_notes(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    n = general(owner_client, "Private")
    m = make_member()
    assert m.get(f"{API}/general-notes").json() == []
    assert_problem(m.get(f"{API}/notes/{n['id']}"), 404, "not_found")
    assert save(m, n, "x").status_code == 404
    assert m.patch(f"{API}/notes/{n['id']}", json={"name": "y"}, headers=im(1)).status_code == 404
    assert m.delete(f"{API}/notes/{n['id']}", headers=im(1)).status_code == 404


def test_general_notes_collapsed_preference(owner_client: TestClient) -> None:
    c = owner_client
    assert c.get(f"{API}/preferences").json()["generalNotesCollapsed"] is False
    r = c.patch(f"{API}/preferences", json={"generalNotesCollapsed": True})
    assert r.status_code == 200 and r.json()["generalNotesCollapsed"] is True
    assert c.get(f"{API}/preferences").json()["generalNotesCollapsed"] is True


def test_year_cannot_take_the_general_notes_folder(owner_client: TestClient) -> None:
    r = owner_client.post(f"{API}/years", json={"name": "General Notes"})
    assert r.status_code == 201
    assert r.json()["name"] == "General Notes"
    assert r.json()["folderName"] == "General Notes (2)"


def test_renamed_year_cannot_take_the_general_notes_folder(owner_client: TestClient) -> None:
    year = owner_client.post(f"{API}/years", json={"name": "2026"}).json()
    r = owner_client.patch(
        f"{API}/years/{year['id']}", json={"name": "general notes"}, headers=im(1)
    )
    assert r.status_code == 200, r.text
    assert r.json()["folderName"].casefold() != "general notes"
