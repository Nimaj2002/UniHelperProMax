from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check
from tests.contract.recording_helpers import API, make_session, start, stop, upload_all
from tests.webm_fixture import chunks, make_webm

pytestmark = pytest.mark.contract
AUDIOS = Path("files/owner/2026/Fall 2026/CS 201/2026-09-28/audios")


def finished(c: TestClient, key: str) -> dict[str, Any]:
    rec = start(c, key)
    upload_all(c, rec["id"], chunks(make_webm(2), 2))
    return stop(c, rec["id"]).json()  # type: ignore[no-any-return]


def im(v: int) -> dict[str, str]:
    return {"If-Match": f'"{v}"'}


def test_rename(
    owner_client: TestClient, tmp_data_dir: Path, app: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    c = owner_client
    key = make_session(c)
    a = finished(c, key)
    b = finished(c, key)
    r = c.patch(
        f"{API}/recordings/{a['id']}",
        json={"name": "Guest lecture — Prof. Kaya"},
        headers=im(a["version"]),
    )
    assert r.status_code == 200
    check(r.json(), "Recording", spec="003")
    assert r.json()["fileName"] == "Guest lecture — Prof. Kaya.webm"
    assert (tmp_data_dir / AUDIOS / "Guest lecture — Prof. Kaya.webm").exists()
    assert not (tmp_data_dir / AUDIOS / a["fileName"]).exists()
    assert_problem(
        c.patch(
            f"{API}/recordings/{b['id']}",
            json={"name": "guest LECTURE — prof. kaya"},
            headers=im(b["version"]),
        ),
        409,
        "name_taken",
    )
    assert_problem(
        c.patch(f"{API}/recordings/{b['id']}", json={"name": "x"}, headers=im(99)),
        412,
        "version_conflict",
    )
    # rollback restores the file name
    from unihelper.services import recording_service

    real = recording_service.view
    calls = {"n": 0}

    def boom(*args: Any, **kw: Any) -> Any:
        calls["n"] += 1
        raise RuntimeError("simulated failure after rename")

    monkeypatch.setattr(recording_service, "view", boom)
    quiet = TestClient(app, raise_server_exceptions=False, cookies=dict(c.cookies))
    quiet.headers["X-CSRF-Token"] = c.headers["X-CSRF-Token"]
    assert (
        quiet.patch(
            f"{API}/recordings/{b['id']}", json={"name": "Renamed"}, headers=im(b["version"])
        ).status_code
        == 500
    )
    monkeypatch.setattr(recording_service, "view", real)
    assert (tmp_data_dir / AUDIOS / b["fileName"]).exists()
    assert not (tmp_data_dir / AUDIOS / "Renamed.webm").exists()


def test_in_progress_cannot_be_renamed_or_deleted(owner_client: TestClient) -> None:
    c = owner_client
    rec = start(c, make_session(c))
    assert_problem(
        c.patch(f"{API}/recordings/{rec['id']}", json={"name": "x"}, headers=im(rec["version"])),
        409,
        "recording_in_progress",
    )
    assert_problem(
        c.delete(f"{API}/recordings/{rec['id']}", headers=im(rec["version"])),
        409,
        "recording_in_progress",
    )


def test_delete(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    a = finished(c, key)
    b = finished(c, key)
    assert_problem(c.delete(f"{API}/recordings/{a['id']}", headers=im(99)), 412, "version_conflict")
    assert c.delete(f"{API}/recordings/{a['id']}", headers=im(a["version"])).status_code == 204
    assert not (tmp_data_dir / AUDIOS / a["fileName"]).exists()
    assert (tmp_data_dir / AUDIOS / b["fileName"]).exists()
    assert [r["id"] for r in c.get(f"{API}/sessions/{key}/recordings").json()] == [b["id"]]
    # a recording whose file vanished can still be removed
    (tmp_data_dir / AUDIOS / b["fileName"]).unlink()
    assert c.delete(f"{API}/recordings/{b['id']}", headers=im(b["version"])).status_code == 204
