"""014 T059: the uh-chat/1 file — round trip, fixed key order, unknown fields kept, atomic
writes, the transcript of selected versions, stems, unreadable files never overwritten."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pytest

from unihelper.chat import files
from unihelper.storage.storage_service import StorageService

pytestmark = pytest.mark.unit
FOLDER = ["ann", "2026", "Fall 2026", "CS 201", "2026-09-28"]


def doc() -> dict:  # type: ignore[type-arg]
    return {
        "turns": [
            {
                "id": "t1",
                "selected": 1,
                "versions": [
                    {
                        "id": "u1",
                        "text": "old question",
                        "createdAt": "2026-10-19T14:12:00+02:00",
                        "answers": [{"id": "a0", "status": "completed", "text": "old answer"}],
                    },
                    {
                        "id": "u2",
                        "text": "What is amortised analysis?",
                        "createdAt": "2026-10-19T14:13:00+02:00",
                        "attachments": [{"kind": "note", "ref": "n1", "title": "Lecture 5"}],
                        "selectedAnswer": 0,
                        "answers": [
                            {
                                "id": "a1",
                                "status": "stopped",
                                "text": "Amortised…",
                                "endpointLabel": "Local",
                                "modelLabel": "llama3",
                                "startedAt": "2026-10-19T14:13:05+02:00",
                                "futureField": 1,
                            }
                        ],
                    },
                ],
            },
        ],
        "title": "What is amortised analysis",
        "id": "c1",
        "createdAt": "2026-10-19T14:12:00+02:00",
        "somethingNew": {"kept": True},
    }


@pytest.fixture
def storage(tmp_path: Path) -> StorageService:
    return StorageService(tmp_path / "files")


def test_round_trip_order_and_unknown_fields(storage: StorageService) -> None:
    files.write(storage, FOLDER, "2026-10-19 1412 What", doc(), "CS 201 · Mon 28 Sep 2026")
    raw = storage.read_bytes(files.json_parts(FOLDER, "2026-10-19 1412 What"))
    assert raw is not None
    text = raw.decode()
    assert text.startswith('{\n  "format": "uh-chat/1",\n  "id": "c1",\n  "title"')
    back = files.read(storage, FOLDER, "2026-10-19 1412 What")
    assert back["somethingNew"] == {"kept": True}
    assert back["turns"][0]["versions"][1]["answers"][0]["futureField"] == 1
    assert list(json.loads(text)["turns"][0]) == ["id", "selected", "versions"]


def test_transcript_shows_selected_versions(storage: StorageService) -> None:
    md = files.render_transcript(doc(), "CS 201 · Mon 28 Sep 2026")
    assert md.startswith("# What is amortised analysis\n\nChat in CS 201 · Mon 28 Sep 2026")
    assert "What is amortised analysis?" in md and "old question" not in md
    assert "## Assistant — Local · llama3 — 14:13" in md
    assert "Attached: Lecture 5 (note)" in md and "*(Stopped)*" in md


def test_missing_transcript_is_rebuilt(storage: StorageService) -> None:
    files.write(storage, FOLDER, "s", doc(), "L")
    md = storage.path_for(files.md_parts(FOLDER, "s"))
    md.unlink()
    files.ensure_transcript(storage, FOLDER, "s", files.read(storage, FOLDER, "s"), "L")
    assert md.exists()
    md.write_text("edited outside", encoding="utf-8")
    files.ensure_transcript(storage, FOLDER, "s", files.read(storage, FOLDER, "s"), "L")
    assert md.read_text(encoding="utf-8").startswith("# What is")


def test_unreadable_files(storage: StorageService) -> None:
    with pytest.raises(files.ChatFileUnreadable):
        files.read(storage, FOLDER, "missing")
    path = storage.path_for(files.json_parts(FOLDER, "bad"))
    path.parent.mkdir(parents=True)
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(files.ChatFileUnreadable):
        files.read(storage, FOLDER, "bad")
    path.write_text('{"format": "other"}', encoding="utf-8")
    with pytest.raises(files.ChatFileUnreadable):
        files.read(storage, FOLDER, "bad")
    assert path.read_text(encoding="utf-8") == '{"format": "other"}'  # never overwritten


def test_atomic_write_leaves_no_temp_files(storage: StorageService) -> None:
    files.write(storage, FOLDER, "s", doc(), "L")
    left = [p.name for p in storage.path_for(files.chats_dir(FOLDER)).iterdir()]
    assert sorted(left) == ["s.json", "s.md"]


def test_stems_and_titles() -> None:
    when = datetime(2026, 10, 19, 14, 12)
    title = files.title_from("  What   is " + "x" * 100)
    assert len(title) == 60 and title.startswith("What is x")
    stem = files.new_stem(when, 'Why "O(n)": a/b?', [])
    assert stem == "2026-10-19 1412 Why -O(n)-- a-b-"
    assert files.new_stem(when, 'Why "O(n)": a/b?', [stem]) == f"{stem} (2)"
    dotted = files.new_stem(when, "v1.2 notes", ["2026-10-19 1412 v1.2 notes"])
    assert dotted == "2026-10-19 1412 v1.2 notes (2)"
    assert len(files.new_stem(when, "y" * 200, [])) <= 80
    assert files.message_count(doc()) == 2
