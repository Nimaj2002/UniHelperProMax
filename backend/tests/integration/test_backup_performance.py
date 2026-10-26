"""016 SC-003 / FR-023: 1 GB of audio backs up in under 2 minutes and restores in under 3, with
flat memory. Slow (writes several GB), so it runs only with UNIHELPER_SLOW_TESTS=1."""

from __future__ import annotations

import gc
import os
import time
import tracemalloc
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.contract import backup_helpers as bh
from tests.contract.notes_helpers import API, create_note, make_session

pytestmark = [
    pytest.mark.integration,
    pytest.mark.slow,
    pytest.mark.skipif(not os.environ.get("UNIHELPER_SLOW_TESTS"), reason="slow: set "
                       "UNIHELPER_SLOW_TESTS=1"),
]
MB = 1024 * 1024


def _grown_mb(baseline: int) -> float:
    """Peak Python allocations above `baseline` since the last reset. (The test client itself
    buffers a whole upload body, so the process's RSS can't tell the server's use apart.)"""
    return (tracemalloc.get_traced_memory()[1] - baseline) / MB


def _reset() -> int:
    gc.collect()
    tracemalloc.reset_peak()
    return tracemalloc.get_traced_memory()[0]


def test_one_gigabyte(app: FastAPI, owner_client: TestClient, tmp_data_dir: Path) -> None:
    bh.inline_jobs(app)
    c = owner_client
    create_note(c, make_session(c), "Lecture 1", "notes")
    (session,) = list((tmp_data_dir / "files" / "owner").rglob("2026-09-28"))
    audios = session / "audios"
    audios.mkdir(exist_ok=True)
    block = os.urandom(MB)
    for i in range(16):  # 16 × 64 MB of incompressible "audio"
        with open(audios / f"lecture-{i:02}.webm", "wb") as fh:
            for _ in range(64):
                fh.write(block)
    tracemalloc.start()
    baseline = _reset()
    start = time.monotonic()
    r = c.post(f"{API}/backup/exports")
    job = c.get(f"{API}/backup/jobs/{r.json()['id']}").json()
    backup_s = time.monotonic() - start
    assert job["phase"] == "ready" and backup_s < 120, backup_s
    assert _grown_mb(baseline) < 200, f"backup used {_grown_mb(baseline):.0f} MB"
    export = tmp_data_dir / "backups" / "exports"
    (zip_path,) = list(export.rglob("*.zip"))

    start = time.monotonic()
    with open(zip_path, "rb") as fh:
        up = c.post(f"{API}/backup/restores", content=fh,
                    headers={"Content-Type": "application/octet-stream",
                             "Content-Length": str(zip_path.stat().st_size)})
    assert up.status_code == 202, up.text
    job_id = up.json()["id"]
    del up  # holds the client's buffered copy of the upload body
    baseline = _reset()
    confirm = c.post(f"{API}/backup/restores/{job_id}/confirm", json={"confirm": True})
    assert confirm.status_code == 202
    restore_s = time.monotonic() - start
    assert c.get(f"{API}/backup/jobs/{job_id}").json()["phase"] == "done"
    assert restore_s < 180, restore_s
    assert _grown_mb(baseline) < 200, f"restore used {_grown_mb(baseline):.0f} MB"
    tracemalloc.stop()
