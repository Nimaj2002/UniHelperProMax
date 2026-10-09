"""007 US6: annotation saving against the real API, SQLite and a temp file system (T037)."""

from __future__ import annotations

import hashlib
import json
import random
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests import pdf_fixtures as fx
from tests.contract.document_helpers import API, documents_dir, make_session, upload_pdf

pytestmark = pytest.mark.integration

COLORS = ["yellow", "green", "blue", "pink", "orange", "purple"]


def _doc(c: TestClient) -> dict[str, Any]:
    r = upload_pdf(c, make_session(c), "Lecture 5.pdf", fx.text_pdf(5))
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()
    return body


def _post(c: TestClient, doc_id: str, ops: list[dict[str, Any]]) -> dict[str, Any]:
    r = c.post(f"{API}/documents/{doc_id}/annotations/ops", json={"ops": ops})
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def _listed(c: TestClient, doc_id: str) -> dict[str, dict[str, Any]]:
    items = c.get(f"{API}/documents/{doc_id}/annotations").json()["annotations"]
    return {a["id"]: a for a in items}


def test_random_ops_never_touch_the_pdf(owner_client: TestClient, tmp_data_dir: Path) -> None:
    """SC-010: 200 random operations (creates, edits, recolours, undo-style inverses, deletes)."""
    c = owner_client
    doc = _doc(c)
    pdf = documents_dir(tmp_data_dir) / "Lecture 5.pdf"
    before = hashlib.sha256(pdf.read_bytes()).hexdigest()
    rnd = random.Random(7)
    expected: dict[str, dict[str, Any]] = {}  # id -> last known server annotation
    for n in range(200):
        op_id = f"op-rand-{n:05d}"
        if expected and rnd.random() < 0.3:
            target = rnd.choice(list(expected))
            result = _post(
                c,
                doc["id"],
                [
                    {
                        "opId": op_id,
                        "kind": "delete",
                        "id": target,
                        "baseRev": expected[target]["rev"],
                    }
                ],
            )
            assert result["results"][0]["status"] == "ok"
            del expected[target]
        elif expected and rnd.random() < 0.5:
            target = rnd.choice(list(expected))
            current = expected[target]
            edited = {
                k: v for k, v in current.items() if k not in ("rev", "createdAt", "updatedAt")
            }
            edited["color"] = rnd.choice(COLORS)
            result = _post(
                c,
                doc["id"],
                [
                    {
                        "opId": op_id,
                        "kind": "upsert",
                        "annotation": edited,
                        "baseRev": current["rev"],
                    }
                ],
            )
            assert result["results"][0]["status"] == "ok"
            expected[target] = result["results"][0]["annotation"]
        else:
            new = {
                "id": f"a{n}",
                "type": "comment",
                "page": rnd.randint(1, 5),
                "color": rnd.choice(COLORS),
                "anchor": [rnd.uniform(0, 600), rnd.uniform(0, 800)],
                "text": f"note {n}",
            }
            result = _post(
                c,
                doc["id"],
                [{"opId": op_id, "kind": "upsert", "annotation": new, "baseRev": None}],
            )
            expected[new["id"]] = result["results"][0]["annotation"]
    listed = _listed(c, doc["id"])
    assert {k: (v["color"], v["rev"]) for k, v in listed.items()} == {
        k: (v["color"], v["rev"]) for k, v in expected.items()
    }
    assert hashlib.sha256(pdf.read_bytes()).hexdigest() == before


def test_two_windows_editing_one_comment_keep_both(
    owner_client: TestClient, tmp_data_dir: Path
) -> None:
    c = owner_client
    doc = _doc(c)
    comment = {
        "id": "c1",
        "type": "comment",
        "page": 2,
        "color": "purple",
        "anchor": [300, 200],
        "text": "start",
    }
    _post(
        c,
        doc["id"],
        [{"opId": "op-create-1", "kind": "upsert", "annotation": comment, "baseRev": None}],
    )
    _post(
        c,
        doc["id"],
        [
            {
                "opId": "op-window-a",
                "kind": "upsert",
                "annotation": {**comment, "text": "A"},
                "baseRev": 1,
            }
        ],
    )
    result = _post(
        c,
        doc["id"],
        [
            {
                "opId": "op-window-b",
                "kind": "upsert",
                "annotation": {**comment, "text": "B"},
                "baseRev": 1,
            }
        ],
    )
    assert result["results"][0]["status"] == "kept_both"
    sidecar = json.loads(
        (documents_dir(tmp_data_dir) / "Lecture 5.annotations.json").read_text(encoding="utf-8")
    )
    assert sorted(a["text"] for a in sidecar["annotations"]) == [
        "A",
        "B",
    ]  # one file, both versions


def test_hand_edits_between_requests_are_kept(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    doc = _doc(c)
    _post(
        c,
        doc["id"],
        [
            {
                "opId": "op-create-1",
                "kind": "upsert",
                "annotation": {
                    "id": "c1",
                    "type": "comment",
                    "page": 1,
                    "color": "blue",
                    "anchor": [1, 2],
                    "text": "app",
                },
                "baseRev": None,
            }
        ],
    )
    path = documents_dir(tmp_data_dir) / "Lecture 5.annotations.json"
    model = json.loads(path.read_text(encoding="utf-8"))
    model["annotations"].append(
        {
            "id": "by-hand",
            "type": "comment",
            "page": 1,
            "color": "green",
            "anchor": [5, 5],
            "text": "typed in an editor",
            "rev": 1,
        }
    )
    model["annotations"][0]["text"] = "fixed a typo by hand"
    model["myNotes"] = "kept"
    path.write_text(json.dumps(model), encoding="utf-8")

    _post(
        c,
        doc["id"],
        [
            {
                "opId": "op-create-2",
                "kind": "upsert",
                "annotation": {
                    "id": "c2",
                    "type": "comment",
                    "page": 1,
                    "color": "pink",
                    "anchor": [9, 9],
                    "text": "later",
                },
                "baseRev": None,
            }
        ],
    )
    after = json.loads(path.read_text(encoding="utf-8"))
    texts = {a["id"]: a["text"] for a in after["annotations"]}
    assert texts == {"c1": "fixed a typo by hand", "by-hand": "typed in an editor", "c2": "later"}
    assert after["myNotes"] == "kept"


def test_unreadable_sidecar_is_moved_aside(owner_client: TestClient, tmp_data_dir: Path) -> None:
    c = owner_client
    doc = _doc(c)
    folder = documents_dir(tmp_data_dir)
    (folder / "Lecture 5.annotations.json").write_text("{ this is not json", encoding="utf-8")
    assert c.get(f"{API}/documents/{doc['id']}/annotations").json() == {"annotations": []}
    result = _post(
        c,
        doc["id"],
        [
            {
                "opId": "op-create-1",
                "kind": "upsert",
                "annotation": {
                    "id": "c1",
                    "type": "comment",
                    "page": 1,
                    "color": "blue",
                    "anchor": [1, 2],
                    "text": "new",
                },
                "baseRev": None,
            }
        ],
    )
    assert result["notice"] == "unreadable_file_moved"
    names = sorted(p.name for p in folder.iterdir())
    moved = [n for n in names if n.startswith("Lecture 5.annotations.unreadable-")]
    assert len(moved) == 1 and re.fullmatch(
        r"Lecture 5\.annotations\.unreadable-\d{8}-\d{6}\.json", moved[0]
    )
    assert (folder / moved[0]).read_text(encoding="utf-8") == "{ this is not json"
    assert list(_listed(c, doc["id"])) == ["c1"]


def test_concurrent_requests_lose_nothing(owner_client: TestClient) -> None:
    c = owner_client
    doc = _doc(c)

    def create(n: int) -> int:
        a = {
            "id": f"t{n}",
            "type": "comment",
            "page": 1,
            "color": "yellow",
            "anchor": [n, n],
            "text": str(n),
        }
        r = c.post(
            f"{API}/documents/{doc['id']}/annotations/ops",
            json={
                "ops": [
                    {
                        "opId": f"op-thread-{n:04d}",
                        "kind": "upsert",
                        "annotation": a,
                        "baseRev": None,
                    }
                ]
            },
        )
        return r.status_code

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert list(pool.map(create, range(16))) == [200] * 16
    assert sorted(_listed(c, doc["id"])) == sorted(f"t{n}" for n in range(16))
