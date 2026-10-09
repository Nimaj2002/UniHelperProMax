"""Annotation sidecar files and the per-annotation merge (007 FR-025–FR-036, research R7).

The sidecar `<Name>.annotations.json` (contracts/annotation-file.md) is the source of truth: the
service reads it from disk, applies a batch of operations with `apply_ops` and writes it back.
Everything here is pure, so each merge rule is unit-tested.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

FORMAT = "unihelper-annotations"
VERSION = 1
MAX_ANNOTATIONS = 10_000
MAX_BYTES = 10 * 1024 * 1024

# Same colours as frontend/src/styles/annotation-palette.json (`fill`), checked by a unit test.
PALETTE: dict[str, str] = {
    "yellow": "#fde047",
    "green": "#86efac",
    "blue": "#93c5fd",
    "pink": "#f9a8d4",
    "orange": "#fdba74",
    "purple": "#c4b5fd",
}

# set by the server, never taken from a client
_SERVER_FIELDS = ("rev", "createdAt", "updatedAt", "colorHex")


class TooManyAnnotations(Exception):
    """The sidecar would exceed 10,000 annotations or 10 MB."""


def empty_model(file_name: str, sha256: str) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "version": VERSION,
        "document": {"fileName": file_name, "sha256": sha256},
        "palette": dict(PALETTE),
        "annotations": [],
    }


def parse(data: bytes) -> dict[str, Any] | None:
    """A sidecar's model, or None when it isn't one we can read (it is then moved aside)."""
    try:
        model = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return None
    if not isinstance(model, dict) or model.get("format") != FORMAT:
        return None
    items = model.get("annotations", [])
    if not isinstance(items, list) or not all(isinstance(a, dict) and "id" in a for a in items):
        return None
    return model


def dumps(model: dict[str, Any]) -> str:
    return json.dumps(model, ensure_ascii=False, indent=2) + "\n"


def _stamp(a: dict[str, Any], rev: int, created: str, now: str) -> dict[str, Any]:
    clean = {k: v for k, v in a.items() if k not in _SERVER_FIELDS}
    clean.update(rev=rev, createdAt=created, updatedAt=now)
    if clean.get("color") in PALETTE:
        clean["colorHex"] = PALETTE[clean["color"]]
    return clean


def apply_ops(
    model: dict[str, Any], ops: list[dict[str, Any]], now: str, new_id: Callable[[], str]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Apply `ops` (wire form: opId, kind, annotation | id, baseRev) in order.

    - upsert of a new id → inserted with rev 1;
    - upsert with `baseRev` == stored rev → replaced, rev + 1 (unknown stored fields kept);
    - upsert of an annotation changed meanwhile → stored kept, incoming added as a copy with
      `conflictOf` (`kept_both`, FR-036);
    - delete with matching rev → removed; of one changed meanwhile → kept (`kept_changed`);
      of a missing id → ok.
    Raises TooManyAnnotations when the result would break the limits.
    """
    items: list[dict[str, Any]] = [dict(a) for a in model.get("annotations", [])]
    index = {a["id"]: i for i, a in enumerate(items)}
    results: list[dict[str, Any]] = []
    for op in ops:
        op_id = op["opId"]
        if op["kind"] == "upsert":
            incoming = op["annotation"]
            i = index.get(incoming["id"])
            if i is None:
                created = _stamp(incoming, 1, now, now)
                index[created["id"]] = len(items)
                items.append(created)
                results.append({"opId": op_id, "status": "ok", "annotation": created})
            elif op.get("baseRev") == items[i].get("rev"):
                stored = items[i]
                merged = {**stored, **_stamp(incoming, 0, "", now)}
                merged.update(
                    rev=int(stored.get("rev") or 0) + 1, createdAt=stored.get("createdAt", now)
                )
                items[i] = merged
                results.append({"opId": op_id, "status": "ok", "annotation": merged})
            else:
                copy = _stamp(
                    {**incoming, "id": new_id(), "conflictOf": incoming["id"]}, 1, now, now
                )
                index[copy["id"]] = len(items)
                items.append(copy)
                results.append(
                    {"opId": op_id, "status": "kept_both", "annotation": items[i], "copy": copy}
                )
        else:
            i = index.get(op["id"])
            if i is None:
                results.append({"opId": op_id, "status": "ok"})
            elif op.get("baseRev") == items[i].get("rev"):
                items.pop(i)
                index = {a["id"]: j for j, a in enumerate(items)}
                results.append({"opId": op_id, "status": "ok"})
            else:
                results.append({"opId": op_id, "status": "kept_changed", "annotation": items[i]})
    new_model = {**model, "annotations": items}
    if len(items) > MAX_ANNOTATIONS or len(dumps(new_model).encode("utf-8")) > MAX_BYTES:
        raise TooManyAnnotations
    return new_model, results
