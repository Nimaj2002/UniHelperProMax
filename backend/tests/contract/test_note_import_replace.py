"""PUT /notes/{id}/import-replace (006 US5, T038)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note, make_session, save
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
NOTES = Path("files/owner/2026/Fall 2026/CS 201/2026-09-28/notes")


def replace(c: TestClient, note: dict[str, Any], content: str, version: int | None = None) -> Any:
    v = note["version"] if version is None else version
    return c.put(
        f"{API}/notes/{note['id']}/import-replace",
        json={"content": content},
        headers={"If-Match": f'"{v}"'},
    )


def test_replace_keeps_name_and_bumps_version(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture 3", "old text")
    r = replace(c, note, "# Imported\r\nnew text\n")
    assert r.status_code == 200, r.text
    body = r.json()
    check(body, "Note", spec="006")
    assert body["name"] == "Lecture 3" and body["fileName"] == note["fileName"]
    assert body["version"] == note["version"] + 1 and body["content"] == "# Imported\r\nnew text\n"
    path = tmp_data_dir / NOTES / note["fileName"]
    assert path.read_bytes() == b"# Imported\r\nnew text\n"
    assert c.get(f"{API}/notes/{note['id']}").json()["hash"] == body["hash"]


def test_stale_version_replaces_nothing(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture 3", "old text")
    saved = save(c, note, "typed after the user chose Replace")
    assert saved.status_code == 200
    assert_problem(replace(c, note, "imported"), 412, "version_conflict")
    path = tmp_data_dir / NOTES / note["fileName"]
    assert path.read_text() == "typed after the user chose Replace"


def test_refused_while_a_transcription_targets_the_note(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    from tests.contract.transcription_helpers import configure, finished_recording, transcribe

    c = owner_client
    configure(app)
    key = make_session(c)
    note = create_note(c, key, "Lecture 3", "old text")
    rec = finished_recording(c, key)
    assert transcribe(c, rec["id"], noteId=note["id"]).status_code == 202  # queued = active
    assert_problem(replace(c, note, "imported"), 409, "note_transcribing")
    assert (tmp_data_dir / NOTES / note["fileName"]).read_text() == "old text"


def test_file_edited_outside_the_app(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture 3", "old text")
    path = tmp_data_dir / NOTES / note["fileName"]
    path.write_text("edited in another editor")
    assert_problem(replace(c, note, "imported"), 409, "file_changed_on_disk")
    assert path.read_text() == "edited in another editor"


def test_missing_file_is_recreated_with_the_import(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture 3", "old text")
    path = tmp_data_dir / NOTES / note["fileName"]
    path.unlink()
    r = replace(c, note, "imported")
    assert r.status_code == 200, r.text
    assert path.read_text() == "imported"


def test_binary_content_and_foreign_note(
    owner_client: TestClient, make_member: Any, tmp_data_dir: Path
) -> None:
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture 3", "old text")
    assert_problem(replace(c, note, "a\x00b"), 422, "content_not_text")
    assert_problem(replace(make_member(), note, "x"), 404, "not_found")
    assert (tmp_data_dir / NOTES / note["fileName"]).read_text() == "old text"
