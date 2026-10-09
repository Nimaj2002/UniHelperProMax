"""Documents API (007): upload, list, read, rename, delete, reading position."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests import pdf_fixtures as fx
from tests.conftest import assert_problem
from tests.contract.document_helpers import API, documents_dir, make_session, upload_pdf
from tests.contract.import_helpers import staged_files
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract


def _ok(r: Any) -> dict[str, Any]:
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    check(body, "Document", spec="007")
    return body


# ---- US1: upload and list (T012) ------------------------------------------------------------


def test_upload_and_list(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    data = fx.text_pdf(3)
    doc = _ok(upload_pdf(c, key, "CS201 Lecture 5.pdf", data))
    assert doc["name"] == "CS201 Lecture 5" and doc["fileName"] == "CS201 Lecture 5.pdf"
    assert doc["originalFileName"] == "CS201 Lecture 5.pdf"
    assert doc["size"] == len(data) and doc["encrypted"] is False and doc["pageCount"] is None
    assert doc["annotationCount"] == 0 and doc["missing"] is False and doc["version"] == 1
    stored = documents_dir(tmp_data_dir) / "CS201 Lecture 5.pdf"
    assert hashlib.sha256(stored.read_bytes()).hexdigest() == hashlib.sha256(data).hexdigest()

    second = _ok(upload_pdf(c, key, "handout.pdf", fx.text_pdf(1)))
    listed = c.get(f"{API}/sessions/{key}/documents").json()
    check(listed, "Document", many=True, spec="007")
    assert [d["id"] for d in listed] == [second["id"], doc["id"]]  # newest first


def test_encrypted_pdf_is_flagged(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    assert _ok(upload_pdf(c, key, "secret.pdf", fx.encrypted_pdf()))["encrypted"] is True


def test_name_clash_and_hand_copied_files(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    first = _ok(upload_pdf(c, key, "slides.pdf", fx.text_pdf(1)))
    second = _ok(upload_pdf(c, key, "SLIDES.PDF", fx.text_pdf(2)))
    assert (first["name"], second["name"]) == ("slides", "SLIDES (2)")
    again = c.get(f"{API}/documents/{first['id']}").json()
    assert again["version"] == first["version"] and again["fileName"] == "slides.pdf"

    hand = documents_dir(tmp_data_dir) / "notes.pdf"
    hand.write_bytes(b"theirs")
    (documents_dir(tmp_data_dir) / "paper.annotations.json").write_text("{}")
    a = _ok(upload_pdf(c, key, "notes.pdf", fx.text_pdf(1)))
    b = _ok(upload_pdf(c, key, "paper.pdf", fx.text_pdf(1)))
    assert a["fileName"] == "notes (2).pdf" and hand.read_bytes() == b"theirs"
    assert b["fileName"] == "paper (2).pdf"  # a stray sidecar is never adopted either


def _other_course_session(c: TestClient) -> str:
    """A session of another course (MATH 101) in the same semester as `make_session`'s CS 201."""
    from tests.contract.test_classes_sessions_read import new_class_body

    body = new_class_body()
    body["course"]["new"]["name"] = "MATH 101"
    return f"{c.post(f'{API}/classes', json=body).json()['lineageId']}:2026-09-28"


def test_upcoming_session_and_foreign_session(
    owner_client: TestClient, make_member: Any, tmp_data_dir: Path
) -> None:
    from tests.contract.test_classes_sessions_read import new_class_body

    c = owner_client
    cls = c.post(f"{API}/classes", json=new_class_body()).json()
    key = f"{cls['lineageId']}:2026-10-28"
    doc = _ok(upload_pdf(c, key, "prep.pdf", fx.text_pdf(1)))
    assert (documents_dir(tmp_data_dir, "2026-10-28") / doc["fileName"]).exists()
    other = make_member()
    assert_problem(upload_pdf(other, key, "x.pdf", fx.text_pdf(1)), 404, "not_found")
    assert_problem(other.get(f"{API}/documents/{doc['id']}"), 404, "not_found")
    assert c.get(f"{API}/sessions/{_other_course_session(c)}/documents").json() == []
    assert staged_files(tmp_data_dir) == []


def test_documents_are_shared_by_the_course_sessions(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    monday = make_session(c)
    wednesday = monday.replace("2026-09-28", "2026-09-30")
    doc = _ok(upload_pdf(c, monday, "syllabus.pdf", fx.text_pdf(1)))
    assert doc["sessionKey"] == monday

    # listed in another session of the course (which has no folder yet), stored where uploaded
    listed = c.get(f"{API}/sessions/{wednesday}/documents").json()
    assert [(d["id"], d["sessionKey"]) for d in listed] == [(doc["id"], monday)]
    assert (documents_dir(tmp_data_dir) / "syllabus.pdf").exists()

    # names are unique across the course
    again = _ok(upload_pdf(c, wednesday, "Syllabus.pdf", fx.text_pdf(1)))
    assert again["name"] == "Syllabus (2)" and again["sessionKey"] == wednesday
    assert (documents_dir(tmp_data_dir, "2026-09-30") / "Syllabus (2).pdf").exists()
    r = c.patch(
        f"{API}/documents/{again['id']}",
        json={"name": "SYLLABUS"},
        headers={"If-Match": f'"{again["version"]}"'},
    )
    assert_problem(r, 409, "name_taken")
    assert [d["id"] for d in c.get(f"{API}/sessions/{monday}/documents").json()] == [
        again["id"],
        doc["id"],
    ]

    # a shared document stays open as a tab in another session
    tabs = {"tabs": [{"kind": "document", "id": doc["id"]}], "active": None}
    assert c.put(f"{API}/workspace/{wednesday}", json=tabs).status_code == 200
    state = c.get(f"{API}/workspace/{wednesday}").json()
    assert state["tabs"] == [{"kind": "document", "id": doc["id"]}]

    # another class of the course, at other times, lists them too
    from tests.contract.test_classes_sessions_read import new_class_body

    course_id = c.get(f"{API}/sessions/{monday}").json()["courseId"]
    lab = c.post(
        f"{API}/classes",
        json=new_class_body(
            course={"id": course_id},
            title="Lab",
            startTime="14:00",
            endTime="15:00",
            recurrence={"freq": "weekly", "byWeekday": ["FR"], "end": {"kind": "semester_end"}},
        ),
    ).json()
    friday = f"{lab['lineageId']}:2026-10-02"
    assert {d["id"] for d in c.get(f"{API}/sessions/{friday}/documents").json()} == {
        doc["id"],
        again["id"],
    }

    # another course doesn't see them
    assert c.get(f"{API}/sessions/{_other_course_session(c)}/documents").json() == []


# ---- US2: refusals (T018): each leaves no row, no file, no staging file ------------------------


def _nothing_kept(c: TestClient, key: str, tmp_data_dir: Path) -> None:
    assert [d["name"] for d in c.get(f"{API}/sessions/{key}/documents").json()] == ["seed"]
    assert sorted(p.name for p in documents_dir(tmp_data_dir).iterdir()) == ["seed.pdf"]
    assert staged_files(tmp_data_dir) == []


@pytest.fixture
def seeded(owner_client: TestClient) -> tuple[TestClient, str]:
    key = make_session(owner_client)
    _ok(upload_pdf(owner_client, key, "seed.pdf", fx.text_pdf(1)))
    return owner_client, key


@pytest.mark.parametrize("name", ["slides.pptx", "slides.pdf.exe", "slides"])
def test_unsupported_type(seeded: tuple[TestClient, str], tmp_data_dir: Path, name: str) -> None:
    c, key = seeded
    assert_problem(upload_pdf(c, key, name, fx.text_pdf(1)), 415, "unsupported_type")
    _nothing_kept(c, key, tmp_data_dir)


def test_length_required(seeded: tuple[TestClient, str], tmp_data_dir: Path) -> None:
    c, key = seeded

    def chunked() -> Any:
        yield fx.text_pdf(1)

    r = c.post(
        f"{API}/sessions/{key}/documents/import",
        params={"fileName": "a.pdf"},
        content=chunked(),
        headers={"Content-Type": "application/octet-stream"},
    )
    assert_problem(r, 411, "length_required")
    _nothing_kept(c, key, tmp_data_dir)


def test_too_large_declared_and_streamed(
    app: Any, seeded: tuple[TestClient, str], tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.integration.test_import_flow import _asgi_upload
    from unihelper.api.v1 import documents as route

    c, key = seeded
    big = upload_pdf(c, key, "huge.pdf", b"x" * 10, headers={"Content-Length": str(209715201)})
    assert assert_problem(big, 413, "file_too_large")["maxBytes"] == 209715200
    _nothing_kept(c, key, tmp_data_dir)

    monkeypatch.setattr(route, "MAX_DOCUMENT_BYTES", 1000)
    sent = _asgi_upload(
        app, c, key, [bytes(600), bytes(600)], total=900, disconnect=False,
        path_suffix="documents/import", file_name="a.pdf",
    )  # fmt: skip
    assert next(m for m in sent if m["type"] == "http.response.start")["status"] == 413
    _nothing_kept(c, key, tmp_data_dir)


def test_incomplete_upload(app: Any, seeded: tuple[TestClient, str], tmp_data_dir: Path) -> None:
    from tests.integration.test_import_flow import _asgi_upload

    c, key = seeded
    data = fx.text_pdf(3)
    sent = _asgi_upload(
        app, c, key, [data[:300]], total=len(data), disconnect=False,
        path_suffix="documents/import", file_name="a.pdf",
    )  # fmt: skip
    assert next(m for m in sent if m["type"] == "http.response.start")["status"] == 422
    assert (
        b"incomplete_upload" in next(m for m in sent if m["type"] == "http.response.body")["body"]
    )
    _nothing_kept(c, key, tmp_data_dir)


@pytest.mark.parametrize(
    "data",
    [fx.fake_pdf(), fx.truncated(fx.text_pdf(3)), b"\x89PNG\r\n\x1a\n" + bytes(4096)],
    ids=["no-trailer", "truncated", "png"],
)
def test_unreadable_pdf(seeded: tuple[TestClient, str], tmp_data_dir: Path, data: bytes) -> None:
    c, key = seeded
    body = assert_problem(upload_pdf(c, key, "slides.pdf", data), 422, "unreadable_pdf")
    assert "slides.pdf" in body["title"]
    _nothing_kept(c, key, tmp_data_dir)


def test_insufficient_storage(
    seeded: tuple[TestClient, str], tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from unihelper.storage.storage_service import StorageService

    c, key = seeded
    monkeypatch.setattr(StorageService, "free_bytes", lambda self: 1024)
    assert_problem(upload_pdf(c, key, "a.pdf", fx.text_pdf(1)), 507, "insufficient_storage")
    _nothing_kept(c, key, tmp_data_dir)


# ---- US3: reading (T021) -------------------------------------------------------------------


def test_file_streams_with_ranges(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    data = fx.text_pdf(5)
    doc = _ok(upload_pdf(c, key, "slides.pdf", data))
    whole = c.get(f"{API}/documents/{doc['id']}/file")
    assert whole.status_code == 200 and whole.content == data
    assert whole.headers["content-type"] == "application/pdf"
    assert whole.headers["accept-ranges"] == "bytes"
    assert whole.headers["etag"] == f'"{hashlib.sha256(data).hexdigest()}"'
    assert "inline" in whole.headers["content-disposition"]
    part = c.get(f"{API}/documents/{doc['id']}/file", headers={"Range": "bytes=0-1023"})
    assert part.status_code == 206 and part.content == data[:1024]

    (documents_dir(tmp_data_dir) / "slides.pdf").unlink()
    assert_problem(c.get(f"{API}/documents/{doc['id']}/file"), 404, "file_missing")
    assert c.get(f"{API}/documents/{doc['id']}").json()["missing"] is True


def test_page_count_reported_by_the_reader(owner_client: TestClient) -> None:
    c = owner_client
    key = make_session(c)
    doc = _ok(upload_pdf(c, key, "slides.pdf", fx.text_pdf(5)))
    r = c.patch(f"{API}/documents/{doc['id']}", json={"pageCount": 5}, headers={"If-Match": '"1"'})
    assert r.status_code == 200, r.text
    check(r.json(), "Document", spec="007")
    assert r.json()["pageCount"] == 5 and r.json()["version"] == 1
    assert_problem(
        c.patch(f"{API}/documents/{doc['id']}", json={"pageCount": 0}, headers={"If-Match": '"1"'}),
        422,
        "validation_failed",
    )
    assert_problem(
        c.patch(f"{API}/documents/{doc['id']}", json={}, headers={"If-Match": '"1"'}),
        422,
        "validation_failed",
    )


# ---- US4: reading position (T029) ---------------------------------------------------------------


def test_reading_position(owner_client: TestClient, make_member: Any) -> None:
    c = owner_client
    key = make_session(c)
    doc = _ok(upload_pdf(c, key, "book.pdf", fx.text_pdf(30)))
    url = f"{API}/documents/{doc['id']}/position"

    never = c.get(url)
    assert never.status_code == 200 and never.json() == {"page": None}  # never opened

    saved = c.put(url, json={"page": 27})
    assert saved.status_code == 200 and saved.json() == {"page": 27}
    assert c.get(url).json() == {"page": 27}
    assert c.put(url, json={"page": 3}).json() == {"page": 3}  # upsert
    assert c.get(url).json() == {"page": 3}

    assert_problem(c.put(url, json={"page": 0}), 422, "validation_failed")
    assert_problem(c.put(url, json={}), 422, "validation_failed")
    assert c.get(url).json() == {"page": 3}

    # positions are per user; documents belong to their owner, so others can't read or set one
    other = make_member()
    assert_problem(other.get(url), 404, "not_found")
    assert_problem(other.put(url, json={"page": 5}), 404, "not_found")
    assert_problem(c.get(f"{API}/documents/nope/position"), 404, "not_found")
    assert c.get(url).json() == {"page": 3}


# ---- US7: rename and delete (T047) ----------------------------------------------------------


def _annotate(c: TestClient, doc_id: str) -> None:
    op = {
        "opId": "op-rename-0001",
        "kind": "upsert",
        "baseRev": None,
        "annotation": {
            "id": "c1",
            "type": "comment",
            "page": 1,
            "color": "blue",
            "anchor": [10, 10],
            "text": "keep me",
        },
    }
    r = c.post(f"{API}/documents/{doc_id}/annotations/ops", json={"ops": [op]})
    assert r.status_code == 200, r.text


def test_rename_moves_pdf_and_sidecar(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    doc = _ok(upload_pdf(c, key, "Lecture 5.pdf", fx.text_pdf(2)))
    _ok(upload_pdf(c, key, "Handout.pdf", fx.text_pdf(1)))
    _annotate(c, doc["id"])
    folder = documents_dir(tmp_data_dir)

    r = c.patch(
        f"{API}/documents/{doc['id']}",
        json={"name": "Trees"},
        headers={"If-Match": f'"{doc["version"]}"'},
    )
    assert r.status_code == 200, r.text
    renamed = r.json()
    check(renamed, "Document", spec="007")
    assert renamed["name"] == "Trees" and renamed["fileName"] == "Trees.pdf"
    assert renamed["version"] == doc["version"] + 1 and renamed["annotationCount"] == 1
    assert sorted(p.name for p in folder.iterdir()) == [
        "Handout.pdf",
        "Trees.annotations.json",
        "Trees.pdf",
    ]
    sidecar = json.loads((folder / "Trees.annotations.json").read_text(encoding="utf-8"))
    assert sidecar["document"]["fileName"] == "Trees.pdf"
    texts = [
        a["text"] for a in c.get(f"{API}/documents/{doc['id']}/annotations").json()["annotations"]
    ]
    assert texts == ["keep me"]

    v = renamed["version"]
    assert_problem(
        c.patch(
            f"{API}/documents/{doc['id']}", json={"name": "handout"}, headers={"If-Match": f'"{v}"'}
        ),
        409,
        "name_taken",
    )
    assert_problem(
        c.patch(
            f"{API}/documents/{doc['id']}", json={"name": "   "}, headers={"If-Match": f'"{v}"'}
        ),
        422,
        "name_required",
    )
    assert_problem(
        c.patch(
            f"{API}/documents/{doc['id']}", json={"name": "x" * 121}, headers={"If-Match": f'"{v}"'}
        ),
        422,
        "validation_failed",
    )
    assert_problem(
        c.patch(f"{API}/documents/{doc['id']}", json={"name": "Old"}, headers={"If-Match": '"1"'}),
        412,
        "version_conflict",
    )
    assert sorted(p.name for p in folder.iterdir()) == [
        "Handout.pdf",
        "Trees.annotations.json",
        "Trees.pdf",
    ]


def test_delete_removes_pdf_and_sidecar(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    key = make_session(c)
    doc = _ok(upload_pdf(c, key, "Lecture 5.pdf", fx.text_pdf(2)))
    keep = _ok(upload_pdf(c, key, "Handout.pdf", fx.text_pdf(1)))
    _annotate(c, doc["id"])
    c.put(f"{API}/documents/{doc['id']}/position", json={"page": 2})
    folder = documents_dir(tmp_data_dir)

    assert_problem(
        c.delete(f"{API}/documents/{doc['id']}", headers={"If-Match": '"7"'}),
        412,
        "version_conflict",
    )
    assert (folder / "Lecture 5.pdf").exists()

    r = c.delete(f"{API}/documents/{doc['id']}", headers={"If-Match": f'"{doc["version"]}"'})
    assert r.status_code == 204, r.text
    assert sorted(p.name for p in folder.iterdir()) == ["Handout.pdf"]
    assert [d["id"] for d in c.get(f"{API}/sessions/{key}/documents").json()] == [keep["id"]]
    assert_problem(c.get(f"{API}/documents/{doc['id']}"), 404, "not_found")
    assert_problem(c.get(f"{API}/documents/{doc['id']}/position"), 404, "not_found")
    assert_problem(
        c.delete(f"{API}/documents/{doc['id']}", headers={"If-Match": '"1"'}), 404, "not_found"
    )
