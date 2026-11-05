"""016 US1: a backup holds every row and file of the account and nothing else, never a key
(FR-002, FR-002a, FR-008, FR-016, SC-006), and the logs never name a key or note text (FR-024)."""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Callable
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.conftest import register_test_key
from tests.contract import backup_helpers as bh
from tests.contract.notes_helpers import create_note, make_session
from tests.contract.recording_helpers import put_chunk, start
from tests.webm_fixture import make_webm
from unihelper.backup.tables import INCLUDED

pytestmark = pytest.mark.integration


def test_backup_holds_everything_but_keys(
    app: FastAPI,
    owner_client: TestClient,
    make_member: Callable[..., TestClient],
    tmp_data_dir: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    bh.inline_jobs(app)
    c = owner_client
    files_root = tmp_data_dir / "files"
    seeded = bh.seed_everything(c, files_root)
    proxy_password = register_test_key("proxy-backup-pass-1234")  # 021
    r = c.put(
        "/api/v1/settings/proxy",
        json={"scheme": "socks5", "host": "p.example", "port": 1080, "password": proxy_password},
    )
    assert r.status_code == 200, r.text
    other = make_member()
    create_note(other, make_session(other), "Member note", "not the owner's")
    owner_root = files_root / "owner"
    (owner_root / ".notes.md.tmp-0a1b2c3d").write_text("half written")
    live = start(c, seeded["sessionKey"])  # still recording: left out
    assert put_chunk(c, live["id"], 0, make_webm(seconds=1)).status_code == 200

    _job, data = bh.make_backup(c)
    files = bh.zip_files(data)
    manifest = json.loads(files["manifest.json"])

    # every file of the account folder, byte for byte, except temp files and the live recording
    expected = {
        rel: content for rel, content in bh.tree(owner_root).items()
        if ".tmp-" not in rel and live["fileName"] not in rel
    }
    got = {n.removeprefix("files/"): d for n, d in files.items() if n.startswith("files/")}
    assert got == expected
    assert any(rel.endswith("extra.txt") for rel in got)
    assert manifest["excluded"] == [{"reason": "recording_in_progress", "name": live["name"]}]

    # every included table, exactly the account's rows
    db = sqlite3.connect(tmp_data_dir / "unihelper.sqlite3")
    uid = db.execute("SELECT id FROM users WHERE username = 'owner'").fetchone()[0]
    for table in INCLUDED:
        assert f"data/{table}.jsonl" in files, table
        rows = [json.loads(line) for line in files[f"data/{table}.jsonl"].splitlines()]
        assert all(r.get("user_id", uid) == uid for r in rows), table
    recordings = [json.loads(x) for x in files["data/recordings.jsonl"].splitlines()]
    assert live["id"] not in {r["id"] for r in recordings} and len(recordings) == 1
    providers = [json.loads(x) for x in files["data/provider_configs.jsonl"].splitlines()]
    assert providers and all(p["secret"] is None and p["secret_id"] is None for p in providers)
    endpoints = [json.loads(x) for x in files["data/ai_endpoints.jsonl"].splitlines()]
    assert endpoints and all(e["secret_id"] is None for e in endpoints)
    assert {k["kind"] for k in manifest["keysLeftOut"]} == {
        "transcription_provider", "ai_endpoint", "proxy"
    }
    assert "data/proxy_settings.jsonl" in files
    assert "Member note" not in data.decode("latin-1")

    # no key, in plaintext or encrypted, anywhere in the backup bytes (SC-006)
    for key in (bh.TRANSCRIPTION_KEY, bh.AI_KEY, proxy_password):
        assert key.encode() not in data
    for (ciphertext,) in db.execute("SELECT ciphertext FROM secrets"):
        assert bytes(ciphertext) not in data
    db.close()

    # restore it, and check the logs of both runs (FR-024)
    assert c.post(f"/api/v1/recordings/{live['id']}/stop", json={}).status_code == 200
    assert bh.restore(c, data)["phase"] == "done"
    text = "\n".join(r.getMessage() for r in caplog.records)
    for secret in (bh.TRANSCRIPTION_KEY, bh.AI_KEY, "Some notes."):
        assert secret not in text
