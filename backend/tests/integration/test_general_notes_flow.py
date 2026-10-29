"""018 General notes end to end on a real database and file system: saves never overwrite an
outside edit, and the list follows files added or removed outside the app, without touching the
account's session notes."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note, make_session, save
from tests.contract.test_general_notes import folder, general

pytestmark = pytest.mark.integration


def test_general_notes_follow_the_folder(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    lecture = create_note(c, key, "Lecture", "session text")
    n = general(c, "Scratch")
    first = save(c, n, "one").json()
    second = save(c, {**n, **first}, "one two").json()
    root = folder(tmp_data_dir)
    (root / "Scratch.md").write_text("changed outside")
    stale = {**n, "version": second["version"], "hash": first["hash"]}
    assert_problem(save(c, stale, "mine"), 409, "file_changed_on_disk")
    assert (root / "Scratch.md").read_text() == "changed outside"

    (root / "extra.md").write_text("dropped in")
    (root / "ignored.txt").write_text("not a note")
    names = {x["name"]: x for x in c.get(f"{API}/general-notes").json()}
    assert set(names) == {"Scratch", "extra"}
    assert c.get(f"{API}/notes/{names['extra']['id']}").json()["content"] == "dropped in"

    (root / "Scratch.md").unlink()
    assert [x["name"] for x in c.get(f"{API}/general-notes").json()] == ["extra"]
    assert c.get(f"{API}/notes/{n['id']}").status_code == 404

    assert [x["id"] for x in c.get(f"{API}/sessions/{key}/notes").json()] == [lecture["id"]]
    assert c.get(f"{API}/notes/{lecture['id']}").json()["content"] == "session text"
