"""014 T110: POST /sessions/{key}/chat-uploads and GET /chat-files/{uploadId}."""

from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.chat_helpers import API, make_session
from tests.contract.openapi_check import check
from tests.integration.test_chat_attachments import PNG, upload
from tests.pdf_fixtures import text_pdf

pytestmark = pytest.mark.contract


def test_uploads(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    key = make_session(c)
    r = upload(c, key, "pic.png", PNG)
    assert r.status_code == 201
    check(r.json(), "ChatUpload", spec="014")
    pdf = upload(c, key, "doc.pdf", text_pdf())
    assert pdf.json()["kind"] == "pdf"
    assert_problem(upload(c, key, "x.bin", b"\x00\x01\x02"), 415, "unsupported_type")
    assert_problem(upload(c, key, "big.png", PNG + bytes(25 * 1024 * 1024)), 413, "file_too_large")

    image = c.get(f"{API}/chat-files/{r.json()['id']}")
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    assert image.headers["content-disposition"].startswith("inline")
    document = c.get(f"{API}/chat-files/{pdf.json()['id']}")
    assert document.headers["content-disposition"].startswith("attachment")
    assert_problem(make_member().get(f"{API}/chat-files/{r.json()['id']}"), 404, "not_found")
    assert_problem(c.get(f"{API}/chat-files/nope"), 404, "not_found")
