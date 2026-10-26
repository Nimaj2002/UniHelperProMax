"""Regenerate the committed backup fixtures (016 T054). Run from backend/:

    uv run python -m tests.fixtures.backups.make_fixtures

`rev0014-minimal.zip` is a backup made at schema revision 0014: one semester, one course, one
class session with a note and a PDF. Keep it as is when later migrations land — restoring it
proves old backups still upgrade (tests/integration/test_restore_upgrade.py).
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from tests.conftest import OWNER
from tests.contract.backup_helpers import inline_jobs, make_backup
from tests.contract.notes_helpers import API, create_note, make_session
from tests.pdf_fixtures import text_pdf
from unihelper.config import Settings
from unihelper.main import create_app

HERE = Path(__file__).parent


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        app = create_app(
            Settings(data_dir=Path(tmp) / "data", transcription_autorun=False, key_store="file",
                     key_file=Path(tmp) / "keys" / "master.key")
        )
        with TestClient(app) as c:
            assert c.post(f"{API}/setup/owner", json=OWNER).status_code == 201
            c.headers["X-CSRF-Token"] = c.cookies.get("uh_csrf") or ""
            inline_jobs(app)
            key = make_session(c)
            create_note(c, key, "Week 1", "# Week 1\n\nIntroduction.")
            r = c.post(f"{API}/sessions/{key}/documents/import", params={"fileName": "intro.pdf"},
                       content=text_pdf(1), headers={"Content-Type": "application/octet-stream"})
            assert r.status_code == 201, r.text
            _job, data = make_backup(c)
    (HERE / "rev0014-minimal.zip").write_bytes(data)
    print(f"wrote {HERE / 'rev0014-minimal.zip'} ({len(data)} bytes)")


if __name__ == "__main__":
    main()
