"""016 US3 (FR-019): backups from older schema revisions restore and upgrade; backups from newer
versions are refused and change nothing."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.contract import backup_helpers as bh
from tests.contract.notes_helpers import API, create_note, make_session
from unihelper.backup import manifest as mf

pytestmark = pytest.mark.integration
FIXTURE = Path(__file__).parents[1] / "fixtures" / "backups" / "rev0014-minimal.zip"


def _relabel(data: bytes, *, drop: tuple[str, ...] = (), **over: object) -> bytes:
    """`data` relabelled with `over`, without the data files of the tables in `drop`."""
    paths = {f"data/{t}.jsonl" for t in drop}
    files = {n: b for n, b in bh.zip_files(data).items() if n not in paths}
    manifest = json.loads(files["manifest.json"]) | over
    manifest["entries"] = [e for e in manifest["entries"] if e["path"] not in paths]
    return bh.rebuild(files, manifest)


def test_a_backup_from_an_older_revision_is_upgraded(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    """0014 only added users.data_epoch, which isn't in a backup, 0015 only added document_hides
    and 0017 only added the time tracking tables, so a head backup without those tables' data,
    labelled 0013, is a genuine 0013 backup: restoring it runs the 0013 → head migrations."""
    bh.inline_jobs(app)
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture 1", "upgrade me")
    _job, data = bh.make_backup(c)
    dropped = ("document_hides", "time_tags", "time_timers", "time_entries")
    older = _relabel(data, drop=dropped, schemaRevision="0013", appVersion="1.0.0")
    job = bh.upload(c, older)
    assert job["summary"]["willUpgrade"] is True and job["summary"]["appVersion"] == "1.0.0"
    assert bh.restore(c, older)["phase"] == "done"
    assert c.get(f"{API}/notes/{note['id']}").json()["content"] == "upgrade me"


def test_the_committed_old_backup_still_restores(app: FastAPI, owner_client: TestClient) -> None:
    bh.inline_jobs(app)
    data = FIXTURE.read_bytes()
    manifest = json.loads(bh.zip_files(data)["manifest.json"])
    assert manifest["schemaRevision"] in mf.known_revisions()
    job = bh.restore(owner_client, data)
    assert job["phase"] == "done", job
    assert job["summary"]["willUpgrade"] is (manifest["schemaRevision"] != mf.head_revision())
    sessions = owner_client.get(f"{API}/classes").json()
    assert sessions, "the restored class is listed"


@pytest.mark.parametrize("over", [{"schemaRevision": "9999"}, {"formatVersion": 2}])
def test_a_newer_backup_is_refused(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path, over: dict[str, object]
) -> None:
    bh.inline_jobs(app)
    c = owner_client
    create_note(c, make_session(c), "Lecture 1", "keep me")
    _job, data = bh.make_backup(c)
    before = bh.tree(tmp_data_dir / "files" / "owner")
    job = bh.upload(c, _relabel(data, appVersion="9.9.9", **over))
    assert job["phase"] == "failed"
    assert job["error"]["code"] == "backup_too_new" and job["error"]["appVersion"] == "9.9.9"
    assert bh.tree(tmp_data_dir / "files" / "owner") == before
