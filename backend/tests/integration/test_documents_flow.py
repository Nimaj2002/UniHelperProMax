"""007 document flows against the real API, SQLite and a temp file system."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests import pdf_fixtures as fx
from tests.contract.document_helpers import API, documents_dir, make_session, upload_pdf
from tests.contract.import_helpers import staged_files

pytestmark = pytest.mark.integration


def test_upload_then_list(app: Any, owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    files = {"a.pdf": fx.text_pdf(2), "b.pdf": fx.image_only_pdf(1), "c.pdf": fx.linked_pdf()}
    for name, data in files.items():
        r = upload_pdf(c, key, name, data)
        assert r.status_code == 201, r.text
        assert staged_files(tmp_data_dir) == []
    for name, data in files.items():
        stored = (documents_dir(tmp_data_dir) / name).read_bytes()
        assert hashlib.sha256(stored).digest() == hashlib.sha256(data).digest()
    assert len(c.get(f"{API}/sessions/{key}/documents").json()) == 3


def test_disconnect_mid_upload_leaves_nothing(
    app: Any, owner_client: TestClient, tmp_data_dir: Path
) -> None:
    from tests.integration.test_import_flow import _asgi_upload

    c = owner_client
    key = make_session(c)
    assert upload_pdf(c, key, "seed.pdf", fx.text_pdf(1)).status_code == 201
    data = fx.text_pdf(40)
    sent = _asgi_upload(
        app,
        c,
        key,
        [data[: len(data) // 2]],
        total=len(data),
        path_suffix="documents/import",
        file_name="big.pdf",
    )
    start = next(m for m in sent if m["type"] == "http.response.start")
    assert start["status"] == 400
    assert sorted(p.name for p in documents_dir(tmp_data_dir).iterdir()) == ["seed.pdf"]
    assert staged_files(tmp_data_dir) == []


def test_hiding_in_another_session_keeps_the_pdf(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    """017 US1: hiding a course PDF in a session that doesn't own it changes nothing of the PDF."""
    from tests.contract.test_annotations import FOUR, _upserts

    c = owner_client
    monday = make_session(c)
    wednesday = monday.replace("2026-09-28", "2026-09-30")
    r = upload_pdf(c, monday, "Lecture 5.pdf", fx.text_pdf(3))
    assert r.status_code == 201, r.text
    doc = r.json()
    ops = c.post(f"{API}/documents/{doc['id']}/annotations/ops", json={"ops": _upserts(FOUR[:1])})
    assert ops.status_code == 200, ops.text
    assert c.put(f"{API}/documents/{doc['id']}/position", json={"page": 2}).status_code == 200
    folder = documents_dir(tmp_data_dir)
    files = {p.name: p.read_bytes() for p in folder.iterdir()}
    assert set(files) == {"Lecture 5.pdf", "Lecture 5.annotations.json"}

    assert c.put(f"{API}/sessions/{wednesday}/documents/{doc['id']}/hidden").status_code == 204

    assert {p.name: p.read_bytes() for p in folder.iterdir()} == files
    assert c.get(f"{API}/documents/{doc['id']}/file").content == fx.text_pdf(3)
    assert c.get(f"{API}/documents/{doc['id']}/position").json() == {"page": 2}
    annotations = c.get(f"{API}/documents/{doc['id']}/annotations").json()["annotations"]
    assert [a["id"] for a in annotations] == [FOUR[0]["id"]]
    assert [d["id"] for d in c.get(f"{API}/sessions/{monday}/documents").json()] == [doc["id"]]
