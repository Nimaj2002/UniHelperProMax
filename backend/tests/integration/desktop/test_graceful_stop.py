"""015 T021: graceful stop — shutdown request, stdin EOF and recordings in progress (FR-009)."""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import pytest

from unihelper.desktop import smoke

pytestmark = pytest.mark.integration

SERVE = [sys.executable, "-m", "unihelper.desktop.serve"]


def _wal_empty(data_dir: Path) -> bool:
    wal = data_dir / "unihelper.sqlite3-wal"
    return not wal.exists() or wal.stat().st_size == 0


def _integrity(data_dir: Path) -> str:
    with sqlite3.connect(data_dir / "unihelper.sqlite3") as conn:
        return str(conn.execute("PRAGMA integrity_check").fetchone()[0])


def test_shutdown_request_finalizes_an_active_recording(tmp_path: Path) -> None:
    from tests.contract import notes_helpers
    from tests.webm_fixture import chunks, make_webm

    app = smoke.launch(SERVE, tmp_path)
    try:
        smoke.wait_identity(app)
        with app.client() as c:
            key = notes_helpers.make_session(c)  # type: ignore[arg-type]  # httpx client, same API
            rec = c.post(
                f"/api/v1/sessions/{key}/recordings", json={"mimeType": "audio/webm"}
            ).json()
            for seq, part in enumerate(chunks(make_webm(4.0), 3)):
                r = c.put(
                    f"/api/v1/recordings/{rec['id']}/chunks/{seq}",
                    content=part,
                    headers={"Content-Type": "application/octet-stream"},
                )
                assert r.status_code in (200, 204), r.text
        assert smoke.shutdown(app) == 0
    finally:
        if app.proc.poll() is None:
            app.proc.kill()
    assert _wal_empty(app.data_dir) and _integrity(app.data_dir) == "ok"
    with sqlite3.connect(app.data_dir / "unihelper.sqlite3") as conn:
        status, size = conn.execute("SELECT status, size FROM recordings").fetchone()
    assert status == "interrupted" and size > 0  # finalized, still accepts late chunks (003)
    audio = list(app.files_dir.rglob("*.webm"))
    assert len(audio) == 1 and audio[0].stat().st_size == size


def test_closing_stdin_stops_the_backend(tmp_path: Path) -> None:
    app = smoke.launch(SERVE, tmp_path)
    try:
        smoke.wait_identity(app)
        assert smoke.close_stdin(app) == 0
    finally:
        if app.proc.poll() is None:
            app.proc.kill()
    assert _wal_empty(app.data_dir) and _integrity(app.data_dir) == "ok"
    assert not (app.data_dir / "startup-error.json").exists()
