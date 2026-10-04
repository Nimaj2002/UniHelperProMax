"""Notes are plain Markdown files in the session folder; writes are atomic and never silently
overwrite edits made outside the app (Constitution I/II)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.contract.notes_helpers import API, create_note, make_session, save
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.integration


def test_files_and_folders(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    n = create_note(c, key, "Lecture notes")
    save(c, n, "# Lecture\n\nçalışma notları ✓\n")
    course = tmp_data_dir / "files/owner/2026/Fall 2026/CS 201"
    assert (course / "2026-09-28/notes/Lecture notes.md").read_text(
        encoding="utf-8"
    ) == "# Lecture\n\nçalışma notları ✓\n"
    # a lab on the same date gets its own, time-suffixed folder
    course_id = c.get(f"{API}/sessions/{key}").json()["courseId"]
    lab = c.post(
        f"{API}/classes",
        json=new_class_body(
            course={"id": course_id}, title="Lab", startTime="14:00", endTime="15:00"
        ),
    ).json()
    create_note(c, f"{lab['lineageId']}:2026-09-28", "Lab notes")
    assert (course / "2026-09-28 1400/notes/Lab notes.md").exists()
    # names unsafe for file systems keep their display name
    odd = create_note(c, key, "a/b:c?")
    assert odd["name"] == "a/b:c?" and odd["fileName"] == "a-b-c-.md"


def test_external_edit_adopted_on_read(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    n = create_note(c, make_session(c), "N")
    path = tmp_data_dir / "files/owner/2026/Fall 2026/CS 201/2026-09-28/notes/N.md"
    path.write_text("from vim")
    got = c.get(f"{API}/notes/{n['id']}").json()
    assert got["content"] == "from vim" and got["version"] == 2
    assert save(c, got, "next").status_code == 200


def test_failed_write_keeps_previous_content(
    owner_client: TestClient, app: Any, tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    c = owner_client
    n = create_note(c, make_session(c), "N")
    r = save(c, n, "good").json()
    real = os.replace

    def fail_for_notes(src: Any, dst: Any) -> None:
        if str(dst).endswith("N.md"):
            raise OSError("disk full")
        real(src, dst)

    monkeypatch.setattr(os, "replace", fail_for_notes)
    quiet = TestClient(app, raise_server_exceptions=False, cookies=dict(c.cookies))
    quiet.headers["X-CSRF-Token"] = c.headers["X-CSRF-Token"]
    bad = quiet.put(
        f"{API}/notes/{n['id']}/content",
        json={"content": "lost?", "baseHash": r["hash"]},
        headers={"If-Match": f'"{r["version"]}"'},
    )
    assert bad.status_code == 500
    monkeypatch.setattr(os, "replace", real)
    path = tmp_data_dir / "files/owner/2026/Fall 2026/CS 201/2026-09-28/notes/N.md"
    assert path.read_text() == "good"
    assert c.get(f"{API}/notes/{n['id']}").json()["version"] == r["version"]  # unchanged
