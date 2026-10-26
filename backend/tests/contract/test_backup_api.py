"""016 contracts/backup-api.md: every /backup operation, its success case and its error codes."""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract import backup_helpers as bh
from tests.contract.notes_helpers import API, create_note, make_session
from tests.contract.openapi_check import check
from tests.contract.recording_helpers import start
from tests.contract.transcription_helpers import configure, finished_recording, transcribe
from unihelper.storage import backup_fs

pytestmark = pytest.mark.contract
SPEC = "016"


@pytest.fixture
def c(app: FastAPI, owner_client: TestClient) -> TestClient:
    bh.inline_jobs(app)
    return owner_client


def _uid(app: FastAPI, username: str = "owner") -> str:
    from unihelper.models import User

    with app.state.sessionmaker() as db:
        return db.query(User).filter_by(username=username).one().id  # type: ignore[no-any-return]


def _fake_job(app: FastAPI, uid: str, kind: str, phase: str):  # type: ignore[no-untyped-def]
    jobs = app.state.backup_jobs
    with jobs._mutex:
        return jobs._new(uid, kind, phase)


def _small_backup(c: TestClient) -> bytes:
    create_note(c, make_session(c), "Lecture 1", "hello")
    return bh.make_backup(c)[1]


# ---- backup --------------------------------------------------------------------------------


def test_export_download_and_epoch_header(c: TestClient, tmp_data_dir: Path) -> None:
    create_note(c, make_session(c), "Lecture 1", "hello")
    r = c.post(f"{API}/backup/exports")
    assert r.status_code == 202
    check(r.json(), "BackupJob", spec=SPEC)
    job = c.get(f"{API}/backup/jobs/{r.json()['id']}").json()
    check(job, "BackupJob", spec=SPEC)
    assert job["phase"] == "ready" and job["kind"] == "export"
    assert job["fileName"].startswith("UniHelperProMax-backup-") and job["size"] > 0
    f = c.get(f"{API}/backup/exports/{job['id']}/file")
    assert f.status_code == 200
    assert f.headers["content-type"] == "application/zip"
    assert f.headers["content-disposition"] == f'attachment; filename="{job["fileName"]}"'
    assert int(f.headers["content-length"]) == job["size"] == len(f.content)
    again = c.get(f"{API}/backup/exports/{job['id']}/file")  # "Download again"
    assert again.status_code == 200
    uid, epoch = c.get(f"{API}/settings/transcription").headers["x-data-epoch"].split(".")
    assert uid and epoch == "0"


def test_export_errors(app: FastAPI, c: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    uid = _uid(app)
    running = _fake_job(app, uid, "export", "writing")
    body = assert_problem(c.post(f"{API}/backup/exports"), 409, "backup_busy")
    assert body["jobId"] == running.id
    nf = assert_problem(c.get(f"{API}/backup/exports/{running.id}/file"), 404, "not_found")
    assert nf
    running.phase = "cancelled"
    _fake_job(app, "someone-1", "export", "writing")
    _fake_job(app, "someone-2", "export", "writing")
    assert_problem(c.post(f"{API}/backup/exports"), 503, "backup_capacity")
    for j in list(app.state.backup_jobs._jobs.values()):
        j.phase = "cancelled"
    monkeypatch.setattr(backup_fs, "free_bytes", lambda _p: 0)
    body = assert_problem(c.post(f"{API}/backup/exports"), 507, "insufficient_storage")
    assert body["freeBytes"] == 0 and body["neededBytes"] > 0


def test_jobs_belong_to_their_account(
    c: TestClient, make_member: Callable[..., TestClient]
) -> None:
    job, _data = bh.make_backup(c)
    other = make_member()
    assert_problem(other.get(f"{API}/backup/jobs/{job['id']}"), 404, "not_found")
    assert_problem(other.delete(f"{API}/backup/jobs/{job['id']}"), 404, "not_found")
    assert_problem(other.get(f"{API}/backup/exports/{job['id']}/file"), 404, "not_found")


def test_cancel_export(app: FastAPI, c: TestClient, tmp_data_dir: Path) -> None:
    job, _data = bh.make_backup(c)
    assert c.delete(f"{API}/backup/jobs/{job['id']}").status_code == 204
    assert c.get(f"{API}/backup/jobs/{job['id']}").json()["phase"] == "cancelled"
    assert_problem(c.get(f"{API}/backup/exports/{job['id']}/file"), 404, "not_found")
    assert not any((tmp_data_dir / "backups" / "exports").rglob("*.zip"))
    running = _fake_job(app, _uid(app), "export", "writing")
    assert c.delete(f"{API}/backup/jobs/{running.id}").status_code == 204
    assert running.cancel.is_set()


# ---- restore -------------------------------------------------------------------------------


def test_restore_upload_and_confirm(c: TestClient) -> None:
    data = _small_backup(c)
    r = c.post(f"{API}/backup/restores", content=data,
               headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 202
    check(r.json(), "BackupJob", spec=SPEC)
    job = c.get(f"{API}/backup/jobs/{r.json()['id']}").json()
    check(job, "BackupJob", spec=SPEC)
    assert job["phase"] == "awaiting_confirmation"
    assert job["summary"]["counts"]["notes"] == 1 and job["summary"]["willUpgrade"] is False
    done = c.post(f"{API}/backup/restores/{job['id']}/confirm", json={"confirm": True})
    assert done.status_code == 202
    check(done.json(), "BackupJob", spec=SPEC)
    assert c.get(f"{API}/backup/jobs/{job['id']}").json()["phase"] == "done"
    assert_problem(
        c.post(f"{API}/backup/restores/{job['id']}/confirm", json={"confirm": True}),
        409, "not_awaiting_confirmation",
    )
    assert_problem(
        c.post(f"{API}/backup/restores/unknown/confirm", json={"confirm": True}), 404, "not_found"
    )


def test_restore_upload_errors(
    app: FastAPI, c: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unihelper.api.v1 import backup as backup_api

    assert_problem(
        c.post(f"{API}/backup/restores", content=iter([b"abc"]),
               headers={"Content-Type": "application/octet-stream"}),
        411, "length_required",
    )
    monkeypatch.setattr(backup_api, "MAX_RESTORE_BYTES", 2)
    body = assert_problem(
        c.post(f"{API}/backup/restores", content=b"abc",
               headers={"Content-Type": "application/octet-stream"}),
        413, "file_too_large",
    )
    assert body["maxBytes"] == 2
    monkeypatch.undo()
    running = _fake_job(app, _uid(app), "export", "writing")
    assert_problem(
        c.post(f"{API}/backup/restores", content=b"abc",
               headers={"Content-Type": "application/octet-stream"}),
        409, "backup_busy",
    )
    running.phase = "cancelled"
    monkeypatch.setattr("unihelper.storage.storage_service.StorageService.free_bytes",
                        lambda _self: 0)
    assert_problem(
        c.post(f"{API}/backup/restores", content=b"abc",
               headers={"Content-Type": "application/octet-stream"}),
        507, "insufficient_storage",
    )


def _failed_code(c: TestClient, data: bytes) -> str:
    job = bh.upload(c, data)
    assert job["phase"] == "failed", job
    check(job, "BackupJob", spec=SPEC)
    return job["error"]["code"]  # type: ignore[no-any-return]


def test_validation_failures_change_nothing(
    app: FastAPI, c: TestClient, tmp_data_dir: Path, make_member: Callable[..., TestClient]
) -> None:
    data = _small_backup(c)
    before = bh.tree(tmp_data_dir / "files" / "owner")
    files = bh.zip_files(data)
    manifest = json.loads(files["manifest.json"])

    assert _failed_code(c, b"definitely not a zip") == "not_a_backup"

    note = next(n for n in files if n.endswith(".md"))
    damaged = dict(files)
    damaged[note] = files[note].replace(b"hello", b"HELLO")
    assert _failed_code(c, bh.rebuild(damaged)) == "backup_damaged"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for n, d in files.items():
            zf.writestr(n, d)
        info = zipfile.ZipInfo("x")
        info.filename = "files/../evil.txt"
        zf.writestr(info, b"evil")
    assert _failed_code(c, buf.getvalue()) == "backup_unsafe"

    app.state.backup_jobs.windows_names = True
    reserved = dict(files)
    reserved["files/CON.txt"] = b"x"
    manifest_r = dict(manifest)
    manifest_r["entries"] = manifest["entries"] + [
        {"path": "files/CON.txt", "size": 1,
         "sha256": "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881"}
    ]
    assert _failed_code(c, bh.rebuild(reserved, manifest_r)) == "backup_names_invalid"
    app.state.backup_jobs.windows_names = None

    newer = dict(manifest, schemaRevision="9999", appVersion="9.0.0")
    job = bh.upload(c, bh.rebuild(files, newer))
    assert job["error"]["code"] == "backup_too_new" and job["error"]["appVersion"] == "9.0.0"

    member = make_member()
    assert _failed_code(member, data) == "backup_ids_in_use"

    assert bh.tree(tmp_data_dir / "files" / "owner") == before
    assert not list((tmp_data_dir / "files" / ".uploads").glob("*.part"))


def test_confirm_is_blocked_by_running_work(
    app: FastAPI, c: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    data = _small_backup(c)
    job = bh.upload(c, data)
    url = f"{API}/backup/restores/{job['id']}/confirm"
    key = make_session(c)
    rec = start(c, key)  # recording, never stopped
    body = assert_problem(c.post(url, json={"confirm": True}), 409, "restore_blocked")
    assert body["reasons"] == ["recording_in_progress"]
    assert body["items"][0]["name"] == rec["name"]
    c.post(f"{API}/recordings/{rec['id']}/stop", json={})

    configure(app)
    done = finished_recording(c, key)
    queued = transcribe(c, done["id"], newNoteName="Transcript")
    assert queued.status_code in (201, 202), queued.text
    body = assert_problem(c.post(url, json={"confirm": True}), 409, "restore_blocked")
    assert body["reasons"] == ["transcription_running"]
    with app.state.sessionmaker() as db:
        from unihelper.models import TranscriptionJob

        for tj in db.query(TranscriptionJob).all():
            tj.status = "cancelled"
        db.commit()

    monkeypatch.setattr(app.state.chat_runs, "active", lambda uid=None: [object()])
    body = assert_problem(c.post(url, json={"confirm": True}), 409, "restore_blocked")
    assert body["reasons"] == ["chat_answer_running"]
    monkeypatch.undo()

    other = _fake_job(app, _uid(app), "export", "writing")
    body = assert_problem(c.post(url, json={"confirm": True}), 409, "restore_blocked")
    assert body["reasons"] == ["job_running"]
    other.phase = "cancelled"

    elsewhere = _fake_job(app, "someone-else", "restore", "staging")
    assert_problem(c.post(url, json={"confirm": True}), 503, "restore_capacity")
    elsewhere.phase = "done"

    monkeypatch.setattr(backup_fs, "free_bytes", lambda _p: 0)
    body = assert_problem(c.post(url, json={"confirm": True}), 507, "insufficient_storage")
    assert body["where"] == "backups"
    monkeypatch.undo()
    assert c.get(f"{API}/backup/jobs/{job['id']}").json()["phase"] == "awaiting_confirmation"


def test_cancel_restore(app: FastAPI, c: TestClient, tmp_data_dir: Path) -> None:
    job = bh.upload(c, _small_backup(c))
    assert c.delete(f"{API}/backup/jobs/{job['id']}").status_code == 204
    assert c.get(f"{API}/backup/jobs/{job['id']}").json()["phase"] == "cancelled"
    assert not list((tmp_data_dir / "files" / ".uploads").glob("*.part"))
    running = _fake_job(app, _uid(app), "restore", "staging")
    assert_problem(c.delete(f"{API}/backup/jobs/{running.id}"), 409, "restore_running")
    running.phase = "done"


def test_account_is_locked_during_a_restore(app: FastAPI, c: TestClient) -> None:
    uid = _uid(app)
    job = _fake_job(app, uid, "restore", "staging")
    app.state.account_locks.lock(uid, job.id)
    try:
        body = assert_problem(c.get(f"{API}/settings/transcription"), 423, "restore_in_progress")
        assert body["jobId"] == job.id
        assert_problem(c.post(f"{API}/backup/exports"), 423, "restore_in_progress")
        assert c.get(f"{API}/backup/jobs/{job.id}").status_code == 200
        assert c.get(f"{API}/auth/me").status_code == 200
    finally:
        app.state.account_locks.unlock(uid)
        job.phase = "done"
    assert c.get(f"{API}/settings/transcription").status_code == 200


# ---- safety backup -------------------------------------------------------------------------


def test_safety_backup(c: TestClient) -> None:
    assert c.get(f"{API}/backup/safety").status_code == 204
    assert_problem(c.get(f"{API}/backup/safety/file"), 404, "not_found")
    bh.restore(c, _small_backup(c))
    r = c.get(f"{API}/backup/safety")
    assert r.status_code == 200
    check(r.json(), "SafetyBackup", spec=SPEC)
    assert r.json()["path"] is None  # web: a server path means nothing to the student
    f = c.get(f"{API}/backup/safety/file")
    assert f.status_code == 200 and f.headers["content-type"] == "application/zip"
    assert "UniHelperProMax-safety-backup-" in f.headers["content-disposition"]
    assert len(f.content) == r.json()["size"]
