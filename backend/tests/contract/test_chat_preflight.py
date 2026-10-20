"""014 T117: POST /chats/preflight, and sends over the model's limit refused (FR-055/056)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.ai_helpers import model
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    make_session,
    model_ref,
    start_chat,
    wait_idle,
)
from tests.contract.document_helpers import upload_pdf
from tests.contract.notes_helpers import create_note
from tests.contract.openapi_check import check
from tests.integration.test_chat_attachments import PNG, uploaded
from tests.pdf_fixtures import image_only_pdf, text_pdf

pytestmark = pytest.mark.contract


def test_preflight(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture", "x" * 4000)
    pdf = upload_pdf(c, key, "slides.pdf", text_pdf()).json()
    scan = upload_pdf(c, key, "scan.pdf", image_only_pdf()).json()
    image = uploaded(c, key, "a.png", PNG)
    ep = create_endpoint(c, "openai", caps={"images": True, "pdf": False, "audio": False})
    body = {
        "sessionKey": key,
        "model": model_ref(ep),
        "text": "y" * 400,
        "attachments": [
            {"kind": "note", "ref": note["id"]},
            {"kind": "document", "ref": pdf["id"]},
            {"kind": "document", "ref": scan["id"]},
            {"kind": "upload", "ref": image["id"]},
        ],
    }
    r = c.post(f"{API}/chats/preflight", json=body)
    assert r.status_code == 200, r.text
    check(r.json(), "PreflightResult", spec="014")
    items = {i["ref"]: i for i in r.json()["items"]}
    assert items[note["id"]]["accepted"] and items[note["id"]]["estimatedTokens"] == 1000
    assert items[pdf["id"]]["reasonCode"] == "no_pdf" and items[pdf["id"]]["textFallbackAvailable"]
    assert items[pdf["id"]]["pdfHasText"] is True
    assert items[scan["id"]]["reasonCode"] == "no_text" and items[scan["id"]]["pdfHasText"] is False
    assert items[image["id"]]["accepted"] and items[image["id"]]["estimatedTokens"] == 1600
    result = r.json()
    assert result["estimatedTokens"] >= 100 + 1000 + 1600
    assert result["contextLimit"] is None and result["overLimit"] is False
    assert result["limits"]["maxAttachments"] == 10 and result["locality"] == "local"
    assert result["privacyAckRequired"] is False


def test_context_limit(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    r = c.post(
        f"{API}/ai/endpoints",
        json={
            "name": "Tiny",
            "style": "openai",
            "baseUrl": "http://fake/v1",
            "models": [model("echo", contextLimit=100)],
        },
    )
    ep = r.json()
    pre = c.post(
        f"{API}/chats/preflight",
        json={"sessionKey": key, "model": model_ref(ep), "text": "z" * 800},
    ).json()
    assert pre["overLimit"] is True and pre["contextLimit"] == 100
    assert_problem(
        c.post(f"{API}/sessions/{key}/chats", json={"text": "z" * 800, "model": model_ref(ep)}),
        409,
        "context_exceeded",
    )
    ok = start_chat(c, key, model_ref(ep), "short")
    wait_idle(c)
    with_chat = c.post(
        f"{API}/chats/preflight",
        json={"sessionKey": key, "chatId": ok["chat"]["id"], "model": model_ref(ep), "text": ""},
    ).json()
    assert with_chat["estimatedTokens"] > 0
