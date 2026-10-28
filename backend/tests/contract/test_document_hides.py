"""Hiding a course PDF in one session (017): it leaves that session's and later sessions' lists,
never the PDF, its file, earlier sessions or the session it was uploaded to."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests import pdf_fixtures as fx
from tests.conftest import assert_problem
from tests.contract.document_helpers import API, documents_dir, make_session, upload_pdf
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract


def _upload(c: TestClient, key: str, name: str) -> dict[str, Any]:
    r = upload_pdf(c, key, name, fx.text_pdf(1))
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    return body


def _listed(c: TestClient, key: str) -> list[str]:
    r = c.get(f"{API}/sessions/{key}/documents")
    assert r.status_code == 200, r.text
    for d in r.json():
        check(d, "Document", spec="007")
    return [d["id"] for d in r.json()]


def _hide(c: TestClient, key: str, doc_id: str) -> Any:
    return c.put(f"{API}/sessions/{key}/documents/{doc_id}/hidden")


@pytest.fixture
def course(owner_client: TestClient) -> tuple[TestClient, str, str, str]:
    """Three sessions of CS 201: 28 Sep (has a folder), 30 Sep and 5 Oct (none yet)."""
    monday = make_session(owner_client)
    return (
        owner_client,
        monday,
        monday.replace("2026-09-28", "2026-09-30"),
        monday.replace("2026-09-28", "2026-10-05"),
    )


# ---- US1: hide in a session that doesn't own the PDF (T006) -----------------------------------


def test_hide_reaches_this_and_later_sessions(
    course: tuple[TestClient, str, str, str], tmp_data_dir: Path
) -> None:
    c, monday, wednesday, later = course
    doc = _upload(c, monday, "slides.pdf")
    pdf = documents_dir(tmp_data_dir) / "slides.pdf"
    before = pdf.read_bytes()

    r = _hide(c, wednesday, doc["id"])
    assert r.status_code == 204, r.text
    assert _hide(c, wednesday, doc["id"]).status_code == 204  # idempotent

    assert _listed(c, wednesday) == []
    assert _listed(c, later) == []
    assert _listed(c, monday) == [doc["id"]]
    assert pdf.read_bytes() == before
    assert c.get(f"{API}/documents/{doc['id']}").status_code == 200


def test_hide_spares_earlier_sessions_and_the_owner(
    course: tuple[TestClient, str, str, str],
) -> None:
    c, monday, wednesday, later = course
    doc = _upload(c, later, "handout.pdf")  # uploaded to the last session
    assert _hide(c, wednesday, doc["id"]).status_code == 204
    assert _listed(c, monday) == [doc["id"]]
    assert _listed(c, wednesday) == []
    assert _listed(c, later) == [doc["id"]]
    assert _hidden(c, later) == []


def test_hide_creates_the_session_folder(
    course: tuple[TestClient, str, str, str], tmp_data_dir: Path
) -> None:
    c, monday, wednesday, _ = course
    doc = _upload(c, monday, "slides.pdf")
    folder = documents_dir(tmp_data_dir, "2026-09-30").parent
    assert not folder.exists()
    assert _hide(c, wednesday, doc["id"]).status_code == 204
    assert folder.is_dir()


def test_hide_in_the_owning_session_is_refused(course: tuple[TestClient, str, str, str]) -> None:
    c, monday, _, _ = course
    doc = _upload(c, monday, "slides.pdf")
    assert_problem(_hide(c, monday, doc["id"]), 409, "own_session")
    assert _listed(c, monday) == [doc["id"]]


def test_hide_not_found(course: tuple[TestClient, str, str, str], make_member: Any) -> None:
    from tests.contract.test_documents import _other_course_session

    c, monday, wednesday, _ = course
    doc = _upload(c, monday, "slides.pdf")
    assert_problem(_hide(c, wednesday, "nope"), 404, "not_found")
    assert_problem(_hide(c, _other_course_session(c), doc["id"]), 404, "not_found")
    assert_problem(_hide(make_member(), wednesday, doc["id"]), 404, "not_found")
    unknown = wednesday.split(":")[0][:-1] + "x:2026-09-30"
    assert _hide(c, unknown, doc["id"]).status_code == 404


# ---- US2: only the owning session renames or deletes (T017) ------------------------------------


def _delete(c: TestClient, doc: dict[str, Any], **params: str) -> Any:
    return c.delete(
        f"{API}/documents/{doc['id']}",
        params=params,
        headers={"If-Match": f'"{doc["version"]}"'},
    )


def _patch(c: TestClient, doc: dict[str, Any], body: dict[str, Any], **params: str) -> Any:
    return c.patch(
        f"{API}/documents/{doc['id']}",
        json=body,
        params=params,
        headers={"If-Match": f'"{doc["version"]}"'},
    )


def test_delete_from_another_session_is_refused(
    course: tuple[TestClient, str, str, str], tmp_data_dir: Path
) -> None:
    c, monday, wednesday, _ = course
    doc = _upload(c, monday, "slides.pdf")
    assert_problem(_delete(c, doc, fromSession=wednesday), 409, "not_owning_session")
    assert (documents_dir(tmp_data_dir) / "slides.pdf").exists()
    assert _listed(c, monday) == [doc["id"]]

    assert _delete(c, doc, fromSession=monday).status_code == 204
    assert not (documents_dir(tmp_data_dir) / "slides.pdf").exists()


def test_delete_without_from_session_is_unchanged(
    course: tuple[TestClient, str, str, str],
) -> None:
    c, monday, _, _ = course
    doc = _upload(c, monday, "slides.pdf")
    assert _delete(c, doc).status_code == 204
    assert _listed(c, monday) == []


def test_delete_drops_the_hides(course: tuple[TestClient, str, str, str], app: Any) -> None:
    from sqlalchemy import func, select

    from unihelper.models import DocumentHide

    c, monday, wednesday, later = course
    doc = _upload(c, monday, "slides.pdf")
    assert _hide(c, wednesday, doc["id"]).status_code == 204
    assert _hide(c, later, doc["id"]).status_code == 204
    assert _delete(c, doc, fromSession=monday).status_code == 204
    with app.state.sessionmaker() as db:
        assert db.scalar(select(func.count()).select_from(DocumentHide)) == 0
    assert _listed(c, wednesday) == [] and _listed(c, later) == []


def test_rename_only_in_the_owning_session(course: tuple[TestClient, str, str, str]) -> None:
    c, monday, wednesday, _ = course
    doc = _upload(c, monday, "slides.pdf")
    assert_problem(
        _patch(c, doc, {"name": "Week 1"}, fromSession=wednesday), 409, "not_owning_session"
    )
    assert c.get(f"{API}/documents/{doc['id']}").json()["name"] == "slides"
    r = _patch(c, doc, {"name": "Week 1"}, fromSession=monday)
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Week 1"


def test_page_count_ignores_from_session(course: tuple[TestClient, str, str, str]) -> None:
    c, monday, wednesday, _ = course
    doc = _upload(c, monday, "slides.pdf")
    r = _patch(c, doc, {"pageCount": 4}, fromSession=wednesday)
    assert r.status_code == 200, r.text
    assert r.json()["pageCount"] == 4


# ---- US3: bring a hidden PDF back (T024) -------------------------------------------------------


def _hidden(c: TestClient, key: str) -> list[str]:
    r = c.get(f"{API}/sessions/{key}/documents/hidden")
    assert r.status_code == 200, r.text
    for d in r.json():
        check(d, "Document", spec="007")
    return [d["id"] for d in r.json()]


def _show(c: TestClient, key: str, doc_id: str) -> Any:
    return c.delete(f"{API}/sessions/{key}/documents/{doc_id}/hidden")


def test_hidden_list_and_show_again(course: tuple[TestClient, str, str, str]) -> None:
    c, monday, wednesday, later = course
    first = _upload(c, monday, "first.pdf")
    second = _upload(c, monday, "second.pdf")
    assert _hidden(c, wednesday) == []
    assert _hide(c, wednesday, first["id"]).status_code == 204
    assert _hide(c, later, second["id"]).status_code == 204
    assert _hidden(c, wednesday) == [first["id"]]
    assert _hidden(c, later) == [second["id"], first["id"]]  # newest first
    assert _hidden(c, monday) == []

    # shown again from a later session: listed again from where it was removed on
    assert _show(c, later, first["id"]).status_code == 204
    assert _show(c, later, first["id"]).status_code == 204  # idempotent
    assert _listed(c, wednesday) == [second["id"], first["id"]]  # the later hide doesn't reach back
    assert _hidden(c, wednesday) == []
    assert _hidden(c, later) == [second["id"]]


def test_show_never_creates_a_folder(
    course: tuple[TestClient, str, str, str], tmp_data_dir: Path
) -> None:
    c, monday, _, later = course
    doc = _upload(c, monday, "slides.pdf")
    folder = documents_dir(tmp_data_dir, "2026-10-05").parent
    assert _hidden(c, later) == []
    assert _show(c, later, doc["id"]).status_code == 204
    assert not folder.exists()


def test_hidden_not_found(course: tuple[TestClient, str, str, str]) -> None:
    from tests.contract.test_documents import _other_course_session

    c, monday, wednesday, _ = course
    doc = _upload(c, monday, "slides.pdf")
    unknown = wednesday.split(":")[0][:-1] + "x:2026-09-30"
    assert c.get(f"{API}/sessions/{unknown}/documents/hidden").status_code == 404
    assert_problem(_show(c, _other_course_session(c), doc["id"]), 404, "not_found")
    assert_problem(_show(c, wednesday, "nope"), 404, "not_found")
