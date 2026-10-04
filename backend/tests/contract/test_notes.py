from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note, make_session, save
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
NOTES = Path("2026") / "Fall 2026" / "CS 201" / "2026-09-28" / "notes"


def test_create_and_list(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    assert c.get(f"{API}/sessions/{key}/notes").json() == []
    n1 = create_note(c, key, "Lecture notes")
    check(n1, "Note", spec="002")
    assert n1["fileName"] == "Lecture notes.md" and n1["content"] == "" and n1["version"] == 1
    n2 = create_note(c, key, "Homework 3", "# Q1\n")
    root = tmp_data_dir / "files" / "owner" / NOTES
    assert (root / "Lecture notes.md").read_text() == ""
    assert (root / "Homework 3.md").read_text() == "# Q1\n"
    lst = c.get(f"{API}/sessions/{key}/notes").json()
    check(lst, "NoteMeta", many=True, spec="002")
    assert [n["id"] for n in lst] == [n1["id"], n2["id"]]  # creation order


@pytest.mark.parametrize("name", ["", "   ", "x" * 121])
def test_create_invalid_name(owner_client: TestClient, name: str) -> None:
    key = make_session(owner_client)
    r = owner_client.post(f"{API}/sessions/{key}/notes", json={"name": name})
    assert r.status_code == 422


def test_create_duplicate_name(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    create_note(c, key, "Lecture notes")
    assert_problem(
        c.post(f"{API}/sessions/{key}/notes", json={"name": "lecture NOTES"}), 409, "name_taken"
    )


def test_unknown_or_foreign_session(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    key = make_session(c)
    lineage = key.split(":")[0]
    assert_problem(c.get(f"{API}/sessions/{lineage}:2026-09-29/notes"), 404, "not_found")
    assert_problem(c.post(f"{API}/sessions/garbage/notes", json={"name": "x"}), 404, "not_found")
    note = create_note(c, key, "Mine")
    m = make_member()
    assert_problem(m.get(f"{API}/sessions/{key}/notes"), 404, "not_found")
    assert_problem(m.get(f"{API}/notes/{note['id']}"), 404, "not_found")
    assert_problem(save(m, note, "hack"), 404, "not_found")


def test_get_and_save(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    note = create_note(c, make_session(c), "Lecture notes")
    r = save(c, note, "# Trees\n- binary\n")
    assert r.status_code == 200, r.text
    check(r.json(), "SaveResult", spec="002")
    assert r.json()["version"] == 2
    got = c.get(f"{API}/notes/{note['id']}").json()
    check(got, "Note", spec="002")
    assert got["content"] == "# Trees\n- binary\n" and got["hash"] == r.json()["hash"]
    assert (
        tmp_data_dir / "files/owner" / NOTES / "Lecture notes.md"
    ).read_text() == "# Trees\n- binary\n"


def test_save_conflicts(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    note = create_note(c, make_session(c), "Lecture notes")
    first = save(c, note, "v2").json()
    # another window saved: stale version
    body = assert_problem(save(c, note, "stale"), 412, "version_conflict")
    check(body, "NoteConflict", spec="002")
    assert body["current"]["content"] == "v2" and body["current"]["version"] == 2
    assert_problem(
        c.put(
            f"{API}/notes/{note['id']}/content", json={"content": "x", "baseHash": first["hash"]}
        ),
        428,
        "if_match_required",
    )
    # edited outside the app
    path = tmp_data_dir / "files/owner" / NOTES / "Lecture notes.md"
    path.write_text("edited in another editor")
    body = assert_problem(
        save(c, note, "mine", version=2, base_hash=first["hash"]), 409, "file_changed_on_disk"
    )
    assert body["current"]["content"] == "edited in another editor"
    assert path.read_text() == "edited in another editor"  # never silently overwritten
    # "Use mine": retry with the current version/hash
    ok = save(
        c, note, "mine", version=body["current"]["version"], base_hash=body["current"]["hash"]
    )
    assert ok.status_code == 200 and path.read_text() == "mine"
    # deleted outside the app
    path.unlink()
    got = c.get(f"{API}/notes/{note['id']}").json()
    assert got["missing"] is True and got["content"] == "" and got["hash"] == ""
    # a window unaware of the deletion is stopped …
    body = assert_problem(
        save(c, note, "again", version=got["version"], base_hash=ok.json()["hash"]),
        409,
        "file_missing",
    )
    assert body["current"]["content"] is None and body["current"]["hash"] == ""
    # … and "Use mine" (based on the missing state) recreates the file
    assert (
        save(
            c, note, "again", version=body["current"]["version"], base_hash=body["current"]["hash"]
        ).status_code
        == 200
    )
    assert path.read_text() == "again"


def test_content_size_limit(owner_client: TestClient) -> None:
    c = owner_client
    note = create_note(c, make_session(c), "Big")
    r = save(c, note, "x" * (5 * 1024 * 1024 + 1))
    assert r.status_code == 422
