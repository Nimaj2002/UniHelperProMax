"""007 research R7: the per-annotation merge of a batch of operations (pure)."""

from __future__ import annotations

import itertools
import json
from typing import Any

import pytest

from unihelper.domain import annotations as ann

NOW = "2026-10-08T10:00:00.000Z"
LATER = "2026-10-08T10:05:00.000Z"


def ids() -> Any:
    counter = itertools.count(1)
    return lambda: f"copy-{next(counter)}"


def comment(id_: str = "c1", text: str = "why O(log n)?", **extra: Any) -> dict[str, Any]:
    return {
        "id": id_,
        "type": "comment",
        "page": 2,
        "color": "purple",
        "anchor": [300, 200],
        "text": text,
        **extra,
    }


def upsert(a: dict[str, Any], base: int | None = None, op: str = "op-00001") -> dict[str, Any]:
    return {"opId": op, "kind": "upsert", "annotation": a, "baseRev": base}


def delete(id_: str, base: int | None, op: str = "op-00009") -> dict[str, Any]:
    return {"opId": op, "kind": "delete", "id": id_, "baseRev": base}


def model(*items: dict[str, Any]) -> dict[str, Any]:
    m = ann.empty_model("Lecture 5.pdf", "ab" * 32)
    m["annotations"] = [dict(i) for i in items]
    return m


def test_insert_sets_rev_times_and_colour_hex() -> None:
    m, results = ann.apply_ops(model(), [upsert(comment())], NOW, ids())
    [a] = m["annotations"]
    assert a["rev"] == 1 and a["createdAt"] == NOW and a["updatedAt"] == NOW
    assert a["colorHex"] == ann.PALETTE["purple"]
    assert results == [{"opId": "op-00001", "status": "ok", "annotation": a}]
    assert m["format"] == "unihelper-annotations" and m["version"] == 1
    assert m["document"] == {"fileName": "Lecture 5.pdf", "sha256": "ab" * 32}
    assert m["palette"] == ann.PALETTE


def test_server_owned_fields_from_the_client_are_ignored() -> None:
    sneaky = comment(rev=99, createdAt="1999", colorHex="#000000")
    m, _ = ann.apply_ops(model(), [upsert(sneaky)], NOW, ids())
    a = m["annotations"][0]
    assert a["rev"] == 1 and a["createdAt"] == NOW and a["colorHex"] == ann.PALETTE["purple"]


def test_replace_when_base_rev_matches() -> None:
    m, _ = ann.apply_ops(model(), [upsert(comment())], NOW, ids())
    m, results = ann.apply_ops(
        m,
        [upsert(comment(text="because it's balanced", color="blue"), base=1, op="op-00002")],
        LATER,
        ids(),
    )
    [a] = m["annotations"]
    assert (
        a["text"] == "because it's balanced"
        and a["color"] == "blue"
        and a["colorHex"] == ann.PALETTE["blue"]
    )
    assert a["rev"] == 2 and a["createdAt"] == NOW and a["updatedAt"] == LATER
    assert results[0]["status"] == "ok"


def test_stale_edit_keeps_both_versions() -> None:
    stored = {**comment(text="changed in window B"), "rev": 2, "createdAt": NOW, "updatedAt": NOW}
    m, results = ann.apply_ops(
        model(stored), [upsert(comment(text="edited in window A"), base=1)], LATER, ids()
    )
    kept, copy = m["annotations"]
    assert kept == stored  # untouched
    assert (
        copy["id"] == "copy-1"
        and copy["conflictOf"] == "c1"
        and copy["text"] == "edited in window A"
    )
    assert copy["rev"] == 1 and copy["page"] == 2
    assert results == [
        {"opId": "op-00001", "status": "kept_both", "annotation": kept, "copy": copy}
    ]


def test_delete_with_matching_rev_removes() -> None:
    stored = {**comment(), "rev": 3, "createdAt": NOW, "updatedAt": NOW}
    m, results = ann.apply_ops(model(stored), [delete("c1", 3)], LATER, ids())
    assert m["annotations"] == [] and results == [{"opId": "op-00009", "status": "ok"}]


def test_stale_delete_keeps_the_changed_annotation() -> None:
    stored = {**comment(text="newer"), "rev": 4, "createdAt": NOW, "updatedAt": NOW}
    m, results = ann.apply_ops(model(stored), [delete("c1", 3)], LATER, ids())
    assert m["annotations"] == [stored]
    assert results == [{"opId": "op-00009", "status": "kept_changed", "annotation": stored}]


def test_delete_of_a_missing_annotation_is_ok() -> None:
    m, results = ann.apply_ops(model(), [delete("gone", 2)], LATER, ids())
    assert m["annotations"] == [] and results[0]["status"] == "ok"


def test_unknown_fields_are_preserved() -> None:
    stored = {**comment(), "rev": 1, "createdAt": NOW, "updatedAt": NOW, "myTag": "exam"}
    m = model(stored)
    m["exportedBy"] = "someone's script"
    m, _ = ann.apply_ops(m, [upsert(comment(text="edited"), base=1)], LATER, ids())
    assert m["exportedBy"] == "someone's script"
    assert m["annotations"][0]["myTag"] == "exam" and m["annotations"][0]["text"] == "edited"


def test_a_batch_applies_in_order() -> None:
    hl = {
        "id": "h1",
        "type": "highlight",
        "page": 1,
        "color": "yellow",
        "rects": [[72, 540, 310, 552]],
        "quoted": "tree",
    }
    ops = [
        upsert(hl, op="op-1aaaaaa"),
        upsert({**hl, "color": "green"}, base=1, op="op-2aaaaaa"),
        delete("h1", 2, op="op-3aaaaaa"),
    ]
    m, results = ann.apply_ops(model(), ops, NOW, ids())
    assert m["annotations"] == [] and [r["status"] for r in results] == ["ok", "ok", "ok"]


def test_limits() -> None:
    many = [{**comment(f"c{i}"), "rev": 1} for i in range(ann.MAX_ANNOTATIONS)]
    with pytest.raises(ann.TooManyAnnotations):
        ann.apply_ops(model(*many), [upsert(comment("one-more"))], NOW, ids())
    big = comment(text="x" * 9000)
    huge = [{**big, "id": f"b{i}", "rev": 1} for i in range(ann.MAX_BYTES // 9000)]
    with pytest.raises(ann.TooManyAnnotations):
        ann.apply_ops(model(*huge), [upsert(comment("b-last", text="x" * 9000))], NOW, ids())


def test_parse_and_dump_round_trip() -> None:
    m, _ = ann.apply_ops(model(), [upsert(comment())], NOW, ids())
    text = ann.dumps(m)
    assert json.loads(text) == m
    assert ann.parse(text.encode()) == m
    assert ann.parse(b"{ not json") is None
    assert ann.parse(b'{"format": "something-else"}') is None
    assert ann.parse(b'["a list"]') is None


def test_palette_matches_the_frontend() -> None:
    from pathlib import Path

    palette = Path(__file__).parents[3] / "frontend" / "src" / "styles" / "annotation-palette.json"
    colors = json.loads(palette.read_text(encoding="utf-8"))["colors"]
    assert {c["id"]: c["fill"] for c in colors} == ann.PALETTE
