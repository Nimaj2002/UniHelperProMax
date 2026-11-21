"""025: GET /media/recordings, GET /recordings/{id}/peaks, POST /recordings/{id}/trim."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.audio_real import make_audio
from tests.conftest import assert_problem
from tests.contract.import_helpers import API, audios_dir, import_audio, make_session
from tests.contract.openapi_check import check
from tests.contract.test_classes_sessions_read import new_class_body

pytestmark = pytest.mark.contract


def _import_real(c: TestClient, key: str, tmp_path: Path, seconds: float = 6.0) -> dict[str, Any]:
    src = tmp_path / "lecture.wav"
    make_audio(src, "wav", "pcm_s16le", seconds)
    r = import_audio(c, key, "lecture.wav", src.read_bytes())
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def _trim(
    c: TestClient, rec: dict[str, Any], body: dict[str, Any], version: int | None = None
) -> Any:
    headers = {"If-Match": f'"{version}"'} if version is not None else {}
    return c.post(f"{API}/recordings/{rec['id']}/trim", json=body, headers=headers)


def test_browse_groups_by_class_and_session(owner_client: TestClient, tmp_path: Path) -> None:
    c = owner_client
    assert c.get(f"{API}/media/recordings").json() == []
    key = make_session(c)
    rec = _import_real(c, key, tmp_path)
    r = c.get(f"{API}/media/recordings")
    assert r.status_code == 200
    check(r.json(), "MediaClassGroup", many=True, spec="025")
    group = r.json()[0]
    assert group["name"] == "CS 201" and group["sessions"][0]["sessionKey"] == key
    assert [x["id"] for x in group["sessions"][0]["recordings"]] == [rec["id"]]
    assert group["sessions"][0]["recordings"][0]["hasTranscript"] is False


def test_browse_requires_login(client: TestClient) -> None:
    assert client.get(f"{API}/media/recordings").status_code == 401


def test_peaks(owner_client: TestClient, tmp_path: Path) -> None:
    c = owner_client
    rec = _import_real(c, make_session(c), tmp_path, 4.0)
    r = c.get(f"{API}/recordings/{rec['id']}/peaks", params={"buckets": 100})
    assert r.status_code == 200, r.text
    check(r.json(), "Peaks", spec="025")
    assert len(r.json()["peaks"]) == 100 and abs(r.json()["durationMs"] - 4000) <= 60
    assert c.get(f"{API}/recordings/{rec['id']}/peaks", params={"buckets": 5}).status_code == 422
    assert c.get(f"{API}/recordings/nope/peaks").status_code == 404


def test_peaks_unreadable(owner_client: TestClient, tmp_path: Path, tmp_data_dir: Path) -> None:
    c = owner_client
    rec = _import_real(c, make_session(c), tmp_path)
    (audios_dir(tmp_data_dir) / rec["fileName"]).write_bytes(b"garbage" * 100)
    assert_problem(c.get(f"{API}/recordings/{rec['id']}/peaks"), 422, "unreadable_audio")


def test_trim_save_as_new_keeps_original(
    owner_client: TestClient, tmp_path: Path, tmp_data_dir: Path
) -> None:
    c = owner_client
    key = make_session(c)
    rec = _import_real(c, key, tmp_path)
    original = audios_dir(tmp_data_dir) / rec["fileName"]
    before = hashlib.sha256(original.read_bytes()).hexdigest()
    r = _trim(c, rec, {"startMs": 1000, "endMs": 4000, "mode": "new", "name": "Intro cut"})
    assert r.status_code == 201, r.text
    body = r.json()
    check(body, "TrimResult", spec="025")
    assert body["mode"] == "new" and body["recording"]["name"] == "Intro cut"
    assert abs(body["recording"]["durationMs"] - 3000) <= 100
    assert hashlib.sha256(original.read_bytes()).hexdigest() == before
    names = [x["name"] for x in c.get(f"{API}/sessions/{key}/recordings").json()]
    assert "Intro cut" in names and len(names) == 2
    assert (audios_dir(tmp_data_dir) / "Intro cut.wav").is_file()


def test_trim_new_errors(owner_client: TestClient, tmp_path: Path) -> None:
    c = owner_client
    rec = _import_real(c, make_session(c), tmp_path)
    ok = {"startMs": 1000, "endMs": 4000, "mode": "new", "name": "Cut"}
    assert _trim(c, rec, ok).status_code == 201
    assert_problem(_trim(c, rec, ok), 409, "name_taken")
    assert_problem(_trim(c, rec, {**ok, "name": "  "}), 422, "name_required")
    assert_problem(_trim(c, rec, {**ok, "name": None}), 422, "name_required")
    assert_problem(
        _trim(c, rec, {**ok, "name": "X", "startMs": 4000, "endMs": 4000}), 422, "invalid_range"
    )
    assert_problem(_trim(c, rec, {**ok, "name": "X", "endMs": 99999}), 422, "invalid_range")
    assert_problem(
        _trim(c, rec, {**ok, "name": "X", "startMs": 0, "endMs": 6000}), 422, "invalid_range"
    )
    assert c.post(f"{API}/recordings/nope/trim", json=ok).status_code == 404


def test_trim_overwrite(owner_client: TestClient, tmp_path: Path, tmp_data_dir: Path) -> None:
    c = owner_client
    rec = _import_real(c, make_session(c), tmp_path)
    body = {"startMs": 2000, "endMs": 5000, "mode": "overwrite"}
    assert_problem(_trim(c, rec, body), 428, "if_match_required")
    assert_problem(_trim(c, rec, body, version=rec["version"] + 5), 412, "version_conflict")
    r = _trim(c, rec, body, version=rec["version"])
    assert r.status_code == 200, r.text
    out = r.json()
    check(out, "TrimResult", spec="025")
    assert out["mode"] == "overwrite" and out["recording"]["id"] == rec["id"]
    assert out["recording"]["version"] == rec["version"] + 1 and out["transcriptStale"] is False
    assert abs(out["recording"]["durationMs"] - 3000) <= 100
    again = c.get(f"{API}/recordings/{rec['id']}").json()
    assert again["durationMs"] == out["recording"]["durationMs"] and again["name"] == rec["name"]
    leftovers = [p.name for p in audios_dir(tmp_data_dir).iterdir() if ".bak-" in p.name]
    assert leftovers == []
    # the old audio is in the Trash, as a recording entry (025 FR-008a)
    entries = c.get(f"{API}/trash", params={"kind": "recording"}).json()
    assert len(entries) == 1 and entries[0]["kind"] == "recording"
    assert entries[0]["label"] == rec["name"] and entries[0]["missingFiles"] == 0
    assert len(list((audios_dir(tmp_data_dir) / ".trash").iterdir())) == 1


def test_trim_blocked_while_transcribing(
    owner_client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unihelper.services import transcription_service

    c = owner_client
    rec = _import_real(c, make_session(c), tmp_path)
    monkeypatch.setattr(transcription_service, "has_active_job_for_recording", lambda *_: True)
    assert_problem(
        _trim(c, rec, {"startMs": 0, "endMs": 1000, "mode": "new", "name": "A"}),
        409,
        "recording_transcribing",
    )


def test_trash_recording_restore_and_purge(
    owner_client: TestClient, tmp_path: Path, tmp_data_dir: Path
) -> None:
    c = owner_client
    key = make_session(c)
    rec = _import_real(c, key, tmp_path)
    before = (audios_dir(tmp_data_dir) / rec["fileName"]).read_bytes()
    body = {"startMs": 2000, "endMs": 5000, "mode": "overwrite"}
    assert _trim(c, rec, body, version=rec["version"]).status_code == 200
    (entry,) = c.get(f"{API}/trash").json()
    assert entry["kind"] == "recording" and entry["recordingCount"] == 1

    # restore: the old audio comes back as its own recording; the trimmed one stays
    r = c.post(f"{API}/trash/{entry['id']}/restore", headers={"If-Match": f'"{entry["version"]}"'})
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "recording" and r.json()["firstSessionKey"] == key
    recs = c.get(f"{API}/sessions/{key}/recordings").json()
    assert sorted(x["name"] for x in recs) == sorted([rec["name"], f"{rec['name']} (2)"])
    restored = next(x for x in recs if x["name"].endswith("(2)"))
    assert restored["durationMs"] == rec["durationMs"]
    assert (audios_dir(tmp_data_dir) / restored["fileName"]).read_bytes() == before
    assert c.get(f"{API}/trash").json() == []

    # a second overwrite, then permanent delete removes the file
    live = next(x for x in recs if not x["name"].endswith("(2)"))
    assert (
        _trim(
            c, live, {"startMs": 0, "endMs": 1000, "mode": "overwrite"}, version=live["version"]
        ).status_code
        == 200
    )
    (entry,) = c.get(f"{API}/trash").json()
    d = c.delete(f"{API}/trash/{entry['id']}", headers={"If-Match": f'"{entry["version"]}"'})
    assert d.status_code == 204
    assert c.get(f"{API}/trash").json() == []
    assert list((audios_dir(tmp_data_dir) / ".trash").iterdir()) == []


def test_trash_recording_restore_needs_its_session(
    owner_client: TestClient, tmp_path: Path
) -> None:
    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    key = f"{cls['lineageId']}:2026-09-28"
    rec = _import_real(c, key, tmp_path)
    body = {"startMs": 1000, "endMs": 4000, "mode": "overwrite"}
    assert _trim(c, rec, body, version=rec["version"]).status_code == 200
    entry = c.get(f"{API}/trash", params={"kind": "recording"}).json()[0]
    # the session goes to the Trash: its old audio can't come back on its own
    gone = c.delete(
        f"{API}/sessions/{key}",
        params={"scope": "this"},
        headers={"If-Match": f'"{cls["version"]}"'},
    )
    assert gone.status_code == 200, gone.text
    out = c.post(
        f"{API}/trash/{entry['id']}/restore", headers={"If-Match": f'"{entry["version"]}"'}
    )
    assert_problem(out, 409, "session_unavailable")


def test_trim_windows_merged_separate_and_errors(
    owner_client: TestClient, tmp_path: Path, tmp_data_dir: Path
) -> None:
    c = owner_client
    key = make_session(c)
    rec = _import_real(c, key, tmp_path, 10.0)
    windows = [{"startMs": 5000, "endMs": 8000}, {"startMs": 1000, "endMs": 3000}]

    # merged: one recording, the windows joined (2 s + 3 s)
    r = _trim(c, rec, {"ranges": windows, "mode": "new", "name": "Joined"})
    assert r.status_code == 201, r.text
    body = r.json()
    check(body, "TrimResult", spec="025")
    assert len(body["recordings"]) == 1 and abs(body["recording"]["durationMs"] - 5000) <= 150

    # separate: one per window, numbered in time order
    r = _trim(c, rec, {"ranges": windows, "mode": "new", "name": "Part", "combine": "separate"})
    assert r.status_code == 201, r.text
    parts = r.json()["recordings"]
    assert [p["name"] for p in parts] == ["Part 1", "Part 2"]
    assert abs(parts[0]["durationMs"] - 2000) <= 100 and abs(parts[1]["durationMs"] - 3000) <= 100
    names = sorted(x["name"] for x in c.get(f"{API}/sessions/{key}/recordings").json())
    assert names == sorted([rec["name"], "Joined", "Part 1", "Part 2"])

    # a taken name stops the whole save: nothing half-created
    again = _trim(c, rec, {"ranges": windows, "mode": "new", "name": "Part", "combine": "separate"})
    assert_problem(again, 409, "name_taken")
    assert len(c.get(f"{API}/sessions/{key}/recordings").json()) == 4
    assert len(list(audios_dir(tmp_data_dir).iterdir())) == 4

    # bad windows
    overlap = {"ranges": [{"startMs": 1000, "endMs": 4000}, {"startMs": 3000, "endMs": 6000}]}
    assert_problem(_trim(c, rec, {**overlap, "mode": "new", "name": "X"}), 422, "invalid_range")
    both = {"startMs": 0, "endMs": 1000, "ranges": windows, "mode": "new", "name": "X"}
    assert_problem(_trim(c, rec, both), 422, "invalid_range")
    assert_problem(_trim(c, rec, {"mode": "new", "name": "X"}), 422, "invalid_range")

    # overwrite takes the merged result only
    sep = {"ranges": windows, "mode": "overwrite", "combine": "separate"}
    assert_problem(_trim(c, rec, sep, version=rec["version"]), 422, "overwrite_needs_merge")
    ok = _trim(c, rec, {"ranges": windows, "mode": "overwrite"}, version=rec["version"])
    assert ok.status_code == 200, ok.text
    assert abs(ok.json()["recording"]["durationMs"] - 5000) <= 150
