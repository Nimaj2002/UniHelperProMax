"""014 T109: pictures, PDFs and audio reach each style in its own format; what a model can't take
is refused with a reason, never dropped or truncated (FR-052–FR-057)."""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests import fake_llm
from tests.audio_fixtures import wav
from tests.conftest import assert_problem
from tests.contract.chat_helpers import (
    API,
    create_endpoint,
    make_session,
    model_ref,
    wait_idle,
)
from tests.contract.document_helpers import upload_pdf
from tests.contract.import_helpers import import_audio
from tests.pdf_fixtures import image_only_pdf, text_pdf
from tests.webm_fixture import make_webm

pytestmark = pytest.mark.integration
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
GIF = b"GIF89a" + b"\x00" * 32
ALL = {"images": True, "pdf": True, "audio": True}
NO_PDF = {"images": True, "pdf": False, "audio": False}


def upload(c: TestClient, key: str, name: str, data: bytes) -> Any:
    return c.post(
        f"{API}/sessions/{key}/chat-uploads",
        params={"fileName": name},
        content=data,
        headers={"Content-Type": "application/octet-stream"},
    )


def uploaded(c: TestClient, key: str, name: str, data: bytes) -> dict[str, Any]:
    r = upload(c, key, name, data)
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def send(
    c: TestClient, key: str, ep: dict[str, Any], *items: dict[str, Any], text: str = "Look"
) -> Any:
    return c.post(
        f"{API}/sessions/{key}/chats",
        json={"text": text, "model": model_ref(ep), "attachments": list(items)},
    )


def last_parts(style: str) -> list[Any]:
    body = fake_llm.STATE["last"]["body"]
    if style == "gemini":
        return body["contents"][-1]["parts"]  # type: ignore[no-any-return]
    content = body["messages"][-1]["content"]
    return content if isinstance(content, list) else [content]


def test_uploads_are_checked_and_moved(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    image = uploaded(c, key, "slide 3.png", PNG)
    assert (
        image["kind"] == "image" and image["mime"] == "image/png" and image["name"] == "slide 3.png"
    )
    assert_problem(upload(c, key, "notes.txt", b"plain text"), 415, "unsupported_type")
    assert_problem(
        upload(c, key, "huge.png", PNG + b"\x00" * (25 * 1024 * 1024)), 413, "file_too_large"
    )
    staged = list(tmp_data_dir.rglob("chats/.uploads/*"))
    assert len(staged) == 1
    ep = create_endpoint(c, "openai", caps=ALL)
    r = send(c, key, ep, {"kind": "upload", "ref": image["id"]})
    assert r.status_code == 201, r.text
    wait_idle(c)
    assert list(tmp_data_dir.rglob("chats/.uploads/*")) == []
    moved = list(tmp_data_dir.rglob("chats/*.files/01-slide 3.png"))
    assert len(moved) == 1 and moved[0].read_bytes() == PNG
    got = c.get(f"{API}/chat-files/{image['id']}")
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["content-type"] == "image/png"


@pytest.mark.parametrize("style", ["openai", "anthropic", "gemini"])
def test_parts_per_style(owner_client: TestClient, style: str) -> None:
    c = owner_client
    key = make_session(c)
    image = uploaded(c, key, "a.png", PNG)
    pdf = upload_pdf(c, key, "slides.pdf", text_pdf()).json()
    ep = create_endpoint(c, style, caps={"images": True, "pdf": True, "audio": False})
    r = send(
        c, key, ep, {"kind": "upload", "ref": image["id"]}, {"kind": "document", "ref": pdf["id"]}
    )
    assert r.status_code == 201, r.text
    wait_idle(c)
    parts = last_parts(style)
    b64 = base64.b64encode(PNG).decode()
    if style == "openai":
        assert parts[0]["image_url"]["url"] == f"data:image/png;base64,{b64}"
        assert parts[1]["type"] == "file" and parts[1]["file"]["filename"] == "slides.pdf"
    elif style == "anthropic":
        assert parts[0] == {
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": b64},
        }
        assert parts[1]["type"] == "document"
    else:
        assert parts[0] == {"inline_data": {"mime_type": "image/png", "data": b64}}
        assert parts[1]["inline_data"]["mime_type"] == "application/pdf"


def test_pdf_text_fallback_and_scans(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    pdf = upload_pdf(c, key, "slides.pdf", text_pdf()).json()
    scan = upload_pdf(c, key, "scan.pdf", image_only_pdf()).json()
    ep = create_endpoint(c, "openai", caps=NO_PDF)
    refused = send(c, key, ep, {"kind": "document", "ref": pdf["id"]})
    body = assert_problem(refused, 409, "attachment_not_accepted")
    assert body["unaccepted"][0]["reasonCode"] == "no_pdf"
    ok = send(c, key, ep, {"kind": "document", "ref": pdf["id"], "pdfMode": "text"})
    assert ok.status_code == 201, ok.text
    wait_idle(c)
    assert "--- PDF text: slides ---" in fake_llm.STATE["last"]["body"]["messages"][-1]["content"]
    no_text = send(c, key, ep, {"kind": "document", "ref": scan["id"], "pdfMode": "text"})
    assert (
        assert_problem(no_text, 409, "attachment_not_accepted")["unaccepted"][0]["reasonCode"]
        == "no_text"
    )


def test_audio(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    rec = import_audio(c, key, "lecture.webm", make_webm(3)).json()
    wav_rec = import_audio(c, key, "clip.wav", wav(1500)).json()
    gemini = create_endpoint(c, "gemini", caps=ALL)
    r = send(c, key, gemini, {"kind": "recording", "ref": rec["id"]})
    assert r.status_code == 201, r.text
    wait_idle(c)
    data = base64.b64decode(last_parts("gemini")[0]["inline_data"]["data"])
    assert (
        last_parts("gemini")[0]["inline_data"]["mime_type"] == "audio/ogg" and data[:4] == b"OggS"
    )

    openai = create_endpoint(c, "openai", caps=ALL)
    webm = assert_problem(
        send(c, key, openai, {"kind": "recording", "ref": rec["id"]}),
        409,
        "attachment_not_accepted",
    )
    assert (
        webm["unaccepted"][0]["reasonCode"] == "format"
        and "Transcribe" in webm["unaccepted"][0]["reason"]
    )
    assert send(c, key, openai, {"kind": "recording", "ref": wav_rec["id"]}).status_code == 201
    wait_idle(c)
    assert last_parts("openai")[0]["input_audio"]["format"] == "wav"

    anthropic = create_endpoint(c, "anthropic", caps=ALL)
    no = assert_problem(
        send(c, key, anthropic, {"kind": "recording", "ref": wav_rec["id"]}),
        409,
        "attachment_not_accepted",
    )
    assert no["unaccepted"][0]["reasonCode"] == "no_audio"


def test_formats_limits_and_missing(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    gif = uploaded(c, key, "anim.gif", GIF)
    gemini = create_endpoint(c, "gemini", caps=ALL)
    body = assert_problem(
        send(c, key, gemini, {"kind": "upload", "ref": gif["id"]}), 409, "attachment_not_accepted"
    )
    assert body["unaccepted"][0]["reasonCode"] == "format"
    big = uploaded(c, key, "big.wav", wav(11 * 60 * 1000))  # 11 min of 16 kHz mono ≈ 21 MB
    assert_problem(send(c, key, gemini, {"kind": "upload", "ref": big["id"]}), 413, "too_large")
    pdf = upload_pdf(c, key, "gone.pdf", text_pdf()).json()
    assert (
        c.delete(
            f"{API}/documents/{pdf['id']}", headers={"If-Match": str(pdf["version"])}
        ).status_code
        == 204
    )
    missing = assert_problem(
        send(c, key, gemini, {"kind": "document", "ref": pdf["id"]}), 409, "attachment_not_accepted"
    )
    assert missing["unaccepted"][0]["reasonCode"] == "missing"
