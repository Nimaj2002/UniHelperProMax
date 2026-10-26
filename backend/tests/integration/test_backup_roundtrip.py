"""016 US2: backup → restore round trips (SC-002, FR-013, FR-014, FR-016, FR-021)."""

from __future__ import annotations

import io
import json
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import OWNER
from tests.contract import backup_helpers as bh
from tests.contract.notes_helpers import API, create_note
from unihelper.backup.tables import COLUMN_OVERRIDES, INCLUDED, account_where
from unihelper.config import Settings
from unihelper.main import create_app

pytestmark = pytest.mark.integration


def _rows(db_path: Path, uid: str) -> dict[str, list[str]]:
    """Every included row of the account, with user_id and blanked columns normalised."""
    db = sqlite3.connect(db_path)
    out: dict[str, list[str]] = {}
    for table in INCLUDED:
        cur = db.execute(f"SELECT * FROM {table} WHERE {account_where(table)}", {"uid": uid})
        names = [d[0] for d in cur.description]
        rows = []
        for values in cur:
            row = dict(zip(names, values, strict=True))
            row.pop("user_id", None)
            row.update({k: v for k, v in COLUMN_OVERRIDES.get(table, {}).items() if k in row})
            rows.append(json.dumps(row, sort_keys=True, default=str))
        out[table] = sorted(rows)
    db.close()
    return out


def _uid(db_path: Path, username: str) -> str:
    db = sqlite3.connect(db_path)
    try:
        return db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()[0]
    finally:
        db.close()


def _second_web_app(tmp_path: Path, key_file: Path) -> FastAPI:
    return create_app(
        Settings(data_dir=tmp_path / "data-2", transcription_autorun=False, key_store="file",
                 key_file=key_file)
    )


def test_restore_into_an_empty_installation(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path, tmp_path: Path, key_file: Path
) -> None:
    bh.inline_jobs(app)
    bh.seed_everything(owner_client, tmp_data_dir / "files")
    _job, data = bh.make_backup(owner_client)
    db1 = tmp_data_dir / "unihelper.sqlite3"
    rows_before = _rows(db1, _uid(db1, "owner"))

    app2 = _second_web_app(tmp_path, key_file)
    with TestClient(app2) as c2:
        assert c2.post(f"{API}/setup/owner", json=OWNER).status_code == 201
        c2.headers["X-CSRF-Token"] = c2.cookies.get("uh_csrf") or ""
        bh.inline_jobs(app2)
        epoch = c2.get(f"{API}/settings/transcription").headers["x-data-epoch"]
        job = bh.restore(c2, data)
        assert job["phase"] == "done", job
        assert c2.get(f"{API}/settings/transcription").headers["x-data-epoch"] != epoch

        data2 = tmp_path / "data-2"
        uid2 = _uid(data2 / "unihelper.sqlite3", "owner")
        assert _rows(data2 / "unihelper.sqlite3", uid2) == rows_before
        assert bh.tree(data2 / "files" / "owner") == bh.tree(tmp_data_dir / "files" / "owner")
        settings = c2.get(f"{API}/settings/transcription").json()
        provider = next(
            p for p in settings["providers"] if p["providerId"] == "openai-compatible"
        )
        assert provider["secret"]["configured"] is False
        endpoints = c2.get(f"{API}/ai/endpoints").json()
        assert endpoints and all(e["key"]["configured"] is False for e in endpoints)
        db = sqlite3.connect(data2 / "unihelper.sqlite3")
        assert db.execute("SELECT COUNT(*) FROM secrets").fetchone()[0] == 0
        assert db.execute(
            "SELECT data_epoch FROM users WHERE id = ?", (uid2,)
        ).fetchone()[0] == 1
        db.close()
        # the restored data works: notes open
        notes = sorted((data2 / "files" / "owner").rglob("*.md"))
        assert notes and notes[0].read_text().startswith("# Hello")


def test_a_web_backup_restores_in_the_desktop_app(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path, desktop_app: FastAPI,
    desktop_client: TestClient, tmp_path: Path,
) -> None:
    bh.inline_jobs(app)
    bh.seed_everything(owner_client, tmp_data_dir / "files")
    _job, data = bh.make_backup(owner_client)
    bh.inline_jobs(desktop_app)
    job = bh.restore(desktop_client, data)
    assert job["phase"] == "done", job
    files = tmp_path / "Documents" / "UniHelperProMax"
    (desktop_folder,) = [p for p in files.iterdir() if not p.name.startswith(".")]
    assert bh.tree(desktop_folder) == bh.tree(tmp_data_dir / "files" / "owner")
    safety = desktop_client.get(f"{API}/backup/safety").json()
    assert safety["path"] and Path(safety["path"]).is_file()  # desktop: the full path


def test_restore_replaces_existing_data_and_keeps_one_safety_backup(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    bh.inline_jobs(app)
    c = owner_client
    seeded = bh.seed_everything(c, tmp_data_dir / "files")
    _job, data = bh.make_backup(c)
    seeded["extra"].unlink()  # not in the backup any more after this…
    later = create_note(c, seeded["sessionKey"], "Written later", "after the backup")
    hand = seeded["extra"].parent / "hand-added.txt"
    hand.write_text("added after the backup")

    job = bh.upload(c, data)
    assert job["summary"]["filesNotInBackup"] == 2  # the later note and hand-added.txt
    assert bh.restore(c, data)["phase"] == "done"

    assert not hand.exists() and seeded["extra"].exists()
    notes = c.get(f"{API}/sessions/{seeded['sessionKey']}/notes").json()
    assert later["id"] not in {n["id"] for n in notes}
    safety_dir = tmp_data_dir / "backups" / "safety"
    (first,) = list(safety_dir.rglob("safety-*.zip"))
    with zipfile.ZipFile(first) as zf:
        names = zf.namelist()
    assert any(n.endswith("hand-added.txt") for n in names)
    assert any(n.endswith("Written later.md") for n in names)

    # a second restore replaces the safety backup, keeping exactly one
    import time

    time.sleep(1.1)  # safety file names have one-second resolution
    assert bh.restore(c, data)["phase"] == "done"
    (second,) = list(safety_dir.rglob("safety-*.zip"))
    assert second != first
    with zipfile.ZipFile(second) as zf:
        assert not any(n.endswith("hand-added.txt") for n in zf.namelist())


def _summary(job: dict[str, Any]) -> dict[str, Any]:
    return job["summary"]  # type: ignore[no-any-return]


def test_restoring_the_safety_backup_undoes_a_restore(
    app: FastAPI, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    bh.inline_jobs(app)
    c = owner_client
    seeded = bh.seed_everything(c, tmp_data_dir / "files")
    _job, data = bh.make_backup(c)
    later = create_note(c, seeded["sessionKey"], "Written later", "keep me")
    assert bh.restore(c, data)["phase"] == "done"
    safety = c.get(f"{API}/backup/safety/file").content
    job = bh.upload(c, safety)
    assert _summary(job)["safetyBackup"]["replaces"] is not None
    assert bh.restore(c, safety)["phase"] == "done"
    notes = c.get(f"{API}/sessions/{seeded['sessionKey']}/notes").json()
    assert later["id"] in {n["id"] for n in notes}
    with zipfile.ZipFile(io.BytesIO(safety)) as zf:
        assert json.loads(zf.read("manifest.json"))["kind"] == "unihelper-backup"
