"""007 US6: annotation endpoints (contracts/openapi.yaml, contracts/annotation-file.md)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from tests import pdf_fixtures as fx
from tests.conftest import assert_problem
from tests.contract.document_helpers import API, documents_dir, make_session, upload_pdf
from tests.contract.openapi_check import check


def _doc(c: TestClient, name: str = "Lecture 5.pdf", data: bytes | None = None) -> dict[str, Any]:
    r = upload_pdf(c, make_session(c), name, data or fx.text_pdf(3))
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    return body


def _ops(c: TestClient, doc_id: str, ops: list[dict[str, Any]]) -> Any:
    return c.post(f"{API}/documents/{doc_id}/annotations/ops", json={"ops": ops})


FOUR = [
    {
        "id": "a-highlight",
        "type": "highlight",
        "page": 1,
        "color": "yellow",
        "rects": [[72, 700, 300, 720]],
        "quoted": "Lecture notes",
    },
    {
        "id": "a-ink",
        "type": "ink",
        "page": 1,
        "color": "blue",
        "width": 2,
        "strokes": [[[100, 400], [110, 410], [120, 400]]],
    },
    {
        "id": "a-textbox",
        "type": "textbox",
        "page": 2,
        "color": "orange",
        "box": [400, 700, 520, 730],
        "text": "exam!",
    },
    {
        "id": "a-comment",
        "type": "comment",
        "page": 3,
        "color": "purple",
        "anchor": [300, 200],
        "text": "why O(log n)?",
    },
]


def _upserts(items: list[dict[str, Any]], prefix: str = "op") -> list[dict[str, Any]]:
    return [
        {"opId": f"{prefix}-{i:06d}", "kind": "upsert", "annotation": a, "baseRev": None}
        for i, a in enumerate(items)
    ]


def test_empty_set_then_four_types(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    doc = _doc(c)
    empty = c.get(f"{API}/documents/{doc['id']}/annotations")
    assert empty.status_code == 200 and empty.json() == {"annotations": []}
    check(empty.json(), "AnnotationSet", spec="007")

    r = _ops(c, doc["id"], _upserts(FOUR))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["notice"] is None and [x["status"] for x in body["results"]] == ["ok"] * 4
    for result in body["results"]:
        check(result, "AnnotationOpResult", spec="007")
        assert result["annotation"]["rev"] == 1

    folder = documents_dir(tmp_data_dir)
    assert sorted(p.name for p in folder.iterdir()) == [
        "Lecture 5.annotations.json",
        "Lecture 5.pdf",
    ]
    sidecar = json.loads((folder / "Lecture 5.annotations.json").read_text(encoding="utf-8"))
    assert sidecar["format"] == "unihelper-annotations" and sidecar["version"] == 1
    pdf_hash = hashlib.sha256((folder / "Lecture 5.pdf").read_bytes()).hexdigest()
    assert sidecar["document"] == {"fileName": "Lecture 5.pdf", "sha256": pdf_hash}
    assert [a["id"] for a in sidecar["annotations"]] == [a["id"] for a in FOUR]
    assert sidecar["annotations"][0]["colorHex"] == sidecar["palette"]["yellow"]

    listed = c.get(f"{API}/documents/{doc['id']}/annotations").json()["annotations"]
    assert [(a["id"], a["rev"]) for a in listed] == [(a["id"], 1) for a in FOUR]
    assert c.get(f"{API}/documents/{doc['id']}").json()["annotationCount"] == 4


def test_replayed_ops_return_the_same_results(owner_client: TestClient) -> None:
    c = owner_client
    doc = _doc(c)
    ops = _upserts(FOUR[:2])
    first = _ops(c, doc["id"], ops).json()
    again = _ops(c, doc["id"], ops).json()  # the response was lost; the client retries
    assert again["results"] == first["results"]
    assert len(c.get(f"{API}/documents/{doc['id']}/annotations").json()["annotations"]) == 2

    # a batch mixing an applied op and a new one applies only the new one
    edit = {
        "opId": "op-edit-0001",
        "kind": "upsert",
        "annotation": {**FOUR[0], "color": "green"},
        "baseRev": 1,
    }
    mixed = _ops(c, doc["id"], [ops[0], edit]).json()
    assert mixed["results"][0] == first["results"][0]
    assert mixed["results"][1]["annotation"]["rev"] == 2


def test_conflicts_keep_both_and_changed(owner_client: TestClient) -> None:
    c = owner_client
    doc = _doc(c)
    _ops(c, doc["id"], _upserts([FOUR[3]]))
    a_win = {
        "opId": "op-window-a",
        "kind": "upsert",
        "annotation": {**FOUR[3], "text": "from A"},
        "baseRev": 1,
    }
    b_win = {
        "opId": "op-window-b",
        "kind": "upsert",
        "annotation": {**FOUR[3], "text": "from B"},
        "baseRev": 1,
    }
    assert _ops(c, doc["id"], [a_win]).json()["results"][0]["status"] == "ok"
    kept = _ops(c, doc["id"], [b_win]).json()["results"][0]
    assert kept["status"] == "kept_both"
    assert kept["annotation"]["text"] == "from A" and kept["copy"]["text"] == "from B"
    assert kept["copy"]["conflictOf"] == FOUR[3]["id"]
    texts = sorted(
        a["text"] for a in c.get(f"{API}/documents/{doc['id']}/annotations").json()["annotations"]
    )
    assert texts == ["from A", "from B"]

    stale = {"opId": "op-stale-del", "kind": "delete", "id": FOUR[3]["id"], "baseRev": 1}
    assert _ops(c, doc["id"], [stale]).json()["results"][0]["status"] == "kept_changed"


def test_invalid_ops_are_refused(owner_client: TestClient) -> None:
    c = owner_client
    doc = _doc(c)

    def bad(annotation: dict[str, Any]) -> None:
        assert_problem(_ops(c, doc["id"], _upserts([annotation], "bad")), 422, "validation_failed")

    bad({**FOUR[3], "page": 0})
    bad({**FOUR[3], "color": "black"})
    bad({**FOUR[3], "text": "x" * 10001})
    bad({**FOUR[0], "rects": [[1, 2, 3]]})
    bad({**FOUR[1], "width": 100})
    assert_problem(
        _ops(c, doc["id"], [{"opId": "short", "kind": "delete", "id": "x"}]),
        422,
        "validation_failed",
    )
    assert_problem(
        _ops(c, doc["id"], [{"opId": "op-no-ann-1", "kind": "upsert"}]), 422, "validation_failed"
    )
    assert_problem(
        c.post(f"{API}/documents/{doc['id']}/annotations/ops", json={"ops": []}),
        422,
        "validation_failed",
    )
    # a page past the end of the document
    pages = c.patch(
        f"{API}/documents/{doc['id']}", json={"pageCount": 3}, headers={"If-Match": '"1"'}
    )
    assert pages.status_code == 200
    bad({**FOUR[3], "page": 4})
    assert c.get(f"{API}/documents/{doc['id']}/annotations").json() == {"annotations": []}


def test_limits_and_foreign_documents(
    owner_client: TestClient, make_member: Any, monkeypatch: Any
) -> None:
    from unihelper.domain import annotations as domain

    c = owner_client
    doc = _doc(c)
    monkeypatch.setattr(domain, "MAX_ANNOTATIONS", 3)
    assert_problem(_ops(c, doc["id"], _upserts(FOUR)), 413, "too_many_annotations")
    assert c.get(f"{API}/documents/{doc['id']}/annotations").json() == {"annotations": []}

    other = make_member()
    assert_problem(other.get(f"{API}/documents/{doc['id']}/annotations"), 404, "not_found")
    assert_problem(_ops(other, doc["id"], _upserts(FOUR[:1])), 404, "not_found")
