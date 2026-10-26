"""016 FR-015, SC-004: a restore that fails or is cut off at any step leaves the account's data
entirely as it was, or entirely as in the backup — never a mix — including after a crash and
startup recovery."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.contract import backup_helpers as bh
from tests.contract.notes_helpers import API, create_note
from unihelper.backup import recovery, restore
from unihelper.backup.writer import Account
from unihelper.storage import backup_fs

pytestmark = pytest.mark.integration


class Crash(BaseException):
    """The process stopping: nothing after it runs."""


def _state(tmp_data_dir: Path) -> tuple[dict[str, bytes], int, int]:
    db = sqlite3.connect(tmp_data_dir / "unihelper.sqlite3")
    try:
        notes = db.execute("SELECT COUNT(*) FROM notes").fetchone()[0]
        epoch = db.execute("SELECT data_epoch FROM users WHERE username = 'owner'").fetchone()[0]
    finally:
        db.close()
    return bh.tree(tmp_data_dir / "files" / "owner"), notes, epoch


def _leftovers(tmp_data_dir: Path) -> list[str]:
    files = [p.name for p in (tmp_data_dir / "files").glob(".restore-*")]
    backups = tmp_data_dir / "backups"
    return files + [p.name for p in backups.glob("restore-*")]


@pytest.fixture
def setup(app: FastAPI, owner_client: TestClient, tmp_data_dir: Path) -> dict[str, Any]:
    """A backup, then more data written after it: `old` is now, `new` is the backup."""
    bh.inline_jobs(app)
    c = owner_client
    seeded = bh.seed_everything(c, tmp_data_dir / "files")
    _job, data = bh.make_backup(c)
    new = _state(tmp_data_dir)
    create_note(c, seeded["sessionKey"], "Written later", "after the backup")
    (seeded["extra"].parent / "later.txt").write_text("later")
    return {"c": c, "data": data, "old": _state(tmp_data_dir), "new": new}


@pytest.mark.parametrize("step", ["make_safety_backup", "build_scratch_db", "stage_files",
                                  "replace_rows"])
def test_a_failing_step_puts_everything_back(
    setup: dict[str, Any], tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch, step: str
) -> None:
    def fail(*_a: Any, **_k: Any) -> None:
        raise OSError("disk went away")

    monkeypatch.setattr(restore, step, fail)
    job = bh.restore(setup["c"], setup["data"])
    assert job["phase"] == "rolled_back", job
    assert job["error"]["code"] == "restore_failed"
    assert _state(tmp_data_dir) == setup["old"]
    assert _leftovers(tmp_data_dir) == []
    # the account works again right away
    assert setup["c"].get(f"{API}/settings/transcription").status_code == 200


def test_files_in_use_rolls_back(
    setup: dict[str, Any], tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real = backup_fs._replace_with_retry
    calls = {"n": 0}

    def flaky(src: Path, dst: Path, attempts: int = 5) -> None:
        calls["n"] += 1
        if calls["n"] == 2:  # the restored folder can't be moved in
            raise PermissionError(13, "in use", str(src))
        real(src, dst, attempts)

    monkeypatch.setattr(backup_fs, "_replace_with_retry", flaky)
    job = bh.restore(setup["c"], setup["data"])
    assert job["phase"] == "rolled_back" and job["error"]["code"] == "files_in_use"
    assert _state(tmp_data_dir) == setup["old"]
    assert _leftovers(tmp_data_dir) == []


def _crash_run(app: FastAPI, setup: dict[str, Any], monkeypatch: pytest.MonkeyPatch,
               at: str) -> None:
    """Run a restore that stops dead at `at` (no rollback, no cleanup)."""
    c = setup["c"]
    job = bh.upload(c, setup["data"])
    upload = app.state.backup_jobs._jobs[job["id"]].path
    from unihelper.models import User

    with app.state.sessionmaker() as db:
        user = db.query(User).filter_by(username="owner").one()
        account = Account(user.id, user.username, user.timezone)
    if at == "before_commit":
        def crash(*_a: Any, **_k: Any) -> None:
            raise Crash()

        monkeypatch.setattr(restore, "replace_rows", crash)
        monkeypatch.setattr(restore, "_discard", lambda _p: None)
        monkeypatch.setattr(backup_fs, "unswap_dirs", lambda *_a: None)

    def set_phase(phase: str) -> None:
        if at == "after_commit" and phase == "cleanup":
            raise Crash()

    with pytest.raises(Crash):
        restore.run_restore(app.state.backup_jobs.ctx, account, job["id"], upload, set_phase,
                            lambda _d, _t: None)
    monkeypatch.undo()


def test_crash_before_the_commit_recovers_the_old_data(
    app: FastAPI, setup: dict[str, Any], tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _crash_run(app, setup, monkeypatch, "before_commit")
    assert list((tmp_data_dir / "backups").glob("restore-*.journal.json"))
    recovery.recover_restores(app.state.settings)
    assert _state(tmp_data_dir) == setup["old"]
    assert _leftovers(tmp_data_dir) == []


def test_crash_after_the_commit_keeps_the_restored_data(
    app: FastAPI, setup: dict[str, Any], tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _crash_run(app, setup, monkeypatch, "after_commit")
    recovery.recover_restores(app.state.settings)
    files, notes, epoch = _state(tmp_data_dir)
    new_files, new_notes, new_epoch = setup["new"]
    assert (files, notes, epoch) == (new_files, new_notes, new_epoch + 1)
    assert _leftovers(tmp_data_dir) == []


def test_startup_removes_orphan_working_folders(app: FastAPI, tmp_data_dir: Path) -> None:
    orphan = tmp_data_dir / "files" / ".restore-0000"
    (orphan / "x").mkdir(parents=True)
    scratch = tmp_data_dir / "backups" / "restore-0000.sqlite3"
    scratch.parent.mkdir(parents=True, exist_ok=True)
    scratch.write_bytes(b"")
    recovery.recover_restores(app.state.settings)
    assert not orphan.exists() and not scratch.exists()
