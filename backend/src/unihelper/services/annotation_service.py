"""Annotations of a document (007 FR-025–FR-036, research R7).

They live in the sidecar `<Name>.annotations.json` next to the untouched PDF (Constitution II).
Every batch of operations reads the sidecar from disk under a per-document lock, merges with
`domain.annotations.apply_ops`, writes it atomically and records each op's result so a retried
batch gets the same answer instead of being applied twice.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from pydantic import ValidationError
from sqlalchemy import CursorResult, delete, select
from sqlalchemy.orm import Session

from unihelper.api.errors import ApiError, field_error
from unihelper.db.engine import on_rollback
from unihelper.domain import annotations as domain
from unihelper.models import AnnotationOp, User
from unihelper.models.base import new_id
from unihelper.schemas.documents import Annotation, ViewerAnnotations
from unihelper.schemas.documents import AnnotationOp as AnnotationOpIn
from unihelper.services.document_service import document_file_lock, get_owned, pdf_parts
from unihelper.storage.storage_service import StorageService

log = logging.getLogger("unihelper.annotations")
OPS_KEPT_FOR = timedelta(days=30)


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _api_view(a: dict[str, Any] | None) -> dict[str, Any] | None:
    """An annotation as the API returns it, or None when a hand-edited entry isn't valid (it
    stays in the file untouched; the app just can't show it)."""
    if a is None:
        return None
    try:
        return Annotation.model_validate(a).model_dump(by_alias=True, exclude_none=True)
    except ValidationError:
        return None


def _response_result(r: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"opId": r["opId"], "status": r["status"]}
    for key in ("annotation", "copy"):
        view = _api_view(r.get(key))
        if view is not None:
            out[key] = view
    return out


def _read_model(storage: StorageService, sidecar: list[str]) -> tuple[dict[str, Any] | None, bool]:
    """(model, unreadable): model is None when there is no sidecar yet or it can't be read."""
    data = storage.read_bytes(sidecar)
    if data is None:
        return None, False
    model = domain.parse(data)
    return model, model is None


def list_annotations(
    db: Session, storage: StorageService, user: User, document_id: str
) -> dict[str, Any]:
    d = get_owned(db, user, document_id)
    parts, _ = pdf_parts(db, user, d)
    model, _unreadable = _read_model(storage, storage.sidecar_parts(parts))
    items = [] if model is None else model.get("annotations", [])
    return {"annotations": [v for v in map(_api_view, items) if v is not None]}


def apply(
    db: Session, storage: StorageService, user: User, document_id: str, ops: list[AnnotationOpIn]
) -> dict[str, Any]:
    """Apply a batch as a whole (FR-028/FR-036): ops already applied return their recorded result;
    the others are merged into the sidecar in one atomic write."""
    d = get_owned(db, user, document_id)
    for op in ops:
        if (
            op.annotation is not None
            and d.page_count is not None
            and op.annotation.page > d.page_count
        ):
            msg = f"This document has {d.page_count} pages."
            raise ApiError(
                422,
                "validation_failed",
                msg,
                errors=[field_error("/ops/annotation/page", "page_out_of_range", msg)],
            )
    with document_file_lock(d.id):
        op_ids = [op.op_id for op in ops]
        recorded = {
            row.op_id: json.loads(row.result_json)
            for row in db.scalars(select(AnnotationOp).where(AnnotationOp.op_id.in_(op_ids)))
            if row.document_id == d.id
        }
        fresh: list[AnnotationOpIn] = []
        seen: set[str] = set(recorded)
        for op in ops:
            if op.op_id not in seen:
                seen.add(op.op_id)
                fresh.append(op)
        notice = None
        if fresh:
            parts, _ = pdf_parts(db, user, d)
            sidecar = storage.sidecar_parts(parts)
            model, unreadable = _read_model(storage, sidecar)
            old_bytes = storage.read_bytes(sidecar)
            if unreadable:
                stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
                storage.move_aside(sidecar, f"unreadable-{stamp}")
                notice = "unreadable_file_moved"
                old_bytes = None
                log.warning("unreadable annotation file of document %s moved aside", d.id)
            if model is None:
                model = domain.empty_model(d.file_name, d.sha256)
            model["document"] = {
                **model.get("document", {}),
                "fileName": d.file_name,
                "sha256": d.sha256,
            }
            wire = [
                {
                    "opId": op.op_id,
                    "kind": op.kind,
                    "id": op.id,
                    "baseRev": op.base_rev,
                    "annotation": None
                    if op.annotation is None
                    else op.annotation.model_dump(by_alias=True, exclude_none=True),
                }
                for op in fresh
            ]
            now = _now()
            try:
                new_model, results = domain.apply_ops(model, wire, now, new_id)
            except domain.TooManyAnnotations:
                raise ApiError(
                    413,
                    "too_many_annotations",
                    "This document has too many annotations to save more "
                    f"(at most {domain.MAX_ANNOTATIONS:,} and 10 MB).",
                ) from None
            storage.write_text_atomic(sidecar, domain.dumps(new_model))
            on_rollback(db, lambda: _restore(storage, sidecar, old_bytes))
            for r in results:
                result = _response_result(r)
                recorded[r["opId"]] = result
                db.add(
                    AnnotationOp(op_id=r["opId"], document_id=d.id, result_json=json.dumps(result))
                )
            db.flush()
            db.commit()  # visible before the lock is released
    return {"results": [recorded[op.op_id] for op in ops], "notice": notice}


def _restore(storage: StorageService, sidecar: list[str], old: bytes | None) -> None:
    """Undo a sidecar write whose op records didn't commit (keeps file and rows in step)."""
    path = storage.absolute_path(sidecar)
    if old is None:
        path.unlink(missing_ok=True)
    else:
        storage.write_text_atomic(sidecar, old.decode("utf-8"))


def prune_applied_ops(db: Session) -> int:
    """Forget op results older than 30 days (startup; research R7)."""
    cutoff = (datetime.now(UTC) - OPS_KEPT_FOR).isoformat(timespec="seconds")
    result = cast(
        CursorResult[Any], db.execute(delete(AnnotationOp).where(AnnotationOp.applied_at < cutoff))
    )
    db.commit()
    return int(result.rowcount or 0)


# ---- the PDF viewer's annotations (EmbedPDF) -----------------------------------------------
# Kept in the same sidecar under "viewer", so rename, delete and trash carry them along.

VIEWER_MAX_BYTES = 25 * 1024 * 1024  # stamps and signatures travel as embedded images


def get_viewer(
    db: Session, storage: StorageService, user: User, document_id: str
) -> dict[str, Any]:
    d = get_owned(db, user, document_id)
    parts, _ = pdf_parts(db, user, d)
    model, _unreadable = _read_model(storage, storage.sidecar_parts(parts))
    viewer = (model or {}).get("viewer") or {}
    items = viewer.get("items") if isinstance(viewer, dict) else None
    removed = viewer.get("removed") if isinstance(viewer, dict) else None
    return {
        "items": items if isinstance(items, list) else [],
        "removed": removed if isinstance(removed, list) else [],
    }


def put_viewer(
    db: Session, storage: StorageService, user: User, document_id: str, body: ViewerAnnotations
) -> dict[str, Any]:
    d = get_owned(db, user, document_id)
    viewer = {"items": body.items, "removed": body.removed, "updatedAt": _now()}
    with document_file_lock(d.id):
        parts, _ = pdf_parts(db, user, d)
        sidecar = storage.sidecar_parts(parts)
        model, unreadable = _read_model(storage, sidecar)
        if unreadable:
            stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
            storage.move_aside(sidecar, f"unreadable-{stamp}")
            log.warning("unreadable annotation file of document %s moved aside", d.id)
        if model is None:
            model = domain.empty_model(d.file_name, d.sha256)
        model["document"] = {
            **model.get("document", {}),
            "fileName": d.file_name,
            "sha256": d.sha256,
        }
        model["viewer"] = viewer
        text = domain.dumps(model)
        if len(text.encode("utf-8")) > VIEWER_MAX_BYTES:
            raise ApiError(
                413,
                "too_many_annotations",
                "This document's annotations are too large to save (at most 25 MB).",
            )
        storage.write_text_atomic(sidecar, text)
    return {"items": body.items, "removed": body.removed}
