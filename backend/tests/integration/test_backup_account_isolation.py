"""016 research R1: restoring one web account never touches another account, and keeps the
account's identity (user name, password, role) while restoring its time zone."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.contract import backup_helpers as bh
from tests.contract.notes_helpers import API, create_note, make_session

pytestmark = pytest.mark.integration


def _user(db_path: Path, username: str) -> tuple[str, ...]:
    db = sqlite3.connect(db_path)
    try:
        return db.execute(
            "SELECT id, username, password_hash, role, timezone, data_epoch FROM users"
            " WHERE username = ?",
            (username,),
        ).fetchone()
    finally:
        db.close()


def _owned_rows(db_path: Path, uid: str) -> int:
    db = sqlite3.connect(db_path)
    try:
        return sum(
            db.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (uid,)).fetchone()[0]
            for t in ("notes", "courses", "session_folders", "secrets", "themes", "tasks")
        )
    finally:
        db.close()


def test_a_member_restore_leaves_the_owner_alone(
    app: FastAPI,
    owner_client: TestClient,
    make_member: Callable[..., TestClient],
    tmp_data_dir: Path,
) -> None:
    bh.inline_jobs(app)
    db_path = tmp_data_dir / "unihelper.sqlite3"
    bh.seed_everything(owner_client, tmp_data_dir / "files")
    owner_before = _user(db_path, "owner")
    owner_rows = _owned_rows(db_path, owner_before[0])
    owner_files = bh.tree(tmp_data_dir / "files" / "owner")

    member = make_member(timezone="Europe/Istanbul")
    key = make_session(member)
    create_note(member, key, "Member note", "mine")
    _job, data = bh.make_backup(member)
    create_note(member, key, "Later", "after")
    with app.state.sessionmaker() as db:  # change the time zone after the backup
        from unihelper.models import User

        db.query(User).filter_by(username="member").one().timezone = "UTC"
        db.commit()
    member_before = _user(db_path, "member")

    assert bh.restore(member, data)["phase"] == "done"

    member_after = _user(db_path, "member")
    assert member_after[:4] == member_before[:4]  # same id, name, password, role
    assert member_after[4] == "Europe/Istanbul"  # time zone from the backup
    assert member_after[5] == member_before[5] + 1
    assert _user(db_path, "owner") == owner_before
    assert _owned_rows(db_path, owner_before[0]) == owner_rows
    assert bh.tree(tmp_data_dir / "files" / "owner") == owner_files
    assert member.get(f"{API}/auth/me").status_code == 200  # still signed in
    names = {n["name"] for n in member.get(f"{API}/sessions/{key}/notes").json()}
    assert names == {"Member note"}
