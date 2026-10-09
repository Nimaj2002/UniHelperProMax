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
