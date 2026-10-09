"""Session documents and the PDF reader's data (007, contracts/openapi.yaml)."""

from __future__ import annotations

from typing import Annotated, Any

import anyio
from fastapi import APIRouter, Query, Request, Response, status
from fastapi.responses import FileResponse, JSONResponse

from unihelper.api import uploads
from unihelper.api.deps import CurrentUser, DbSession, IfMatch, Storage
from unihelper.api.errors import ApiError
from unihelper.models.document import MAX_DOCUMENT_BYTES
from unihelper.schemas.documents import (
    AnnotationOpsRequest,
    AnnotationOpsResponse,
    AnnotationSet,
    Document,
    DocumentPatch,
    Position,
    PositionPut,
)
from unihelper.services import annotation_service
from unihelper.services import document_service as svc
from unihelper.services import session_folder_service as sfs

router = APIRouter(tags=["documents"])

WHAT = "PDFs"


@router.get("/sessions/{session_key}/documents", response_model=list[Document])
def list_documents(session_key: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return svc.list_documents(db, storage, user, session_key)


@router.post(
    "/sessions/{session_key}/documents/import",
    response_model=Document,
    status_code=status.HTTP_201_CREATED,
)
async def import_document(
    session_key: str,
    request: Request,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
    file_name: Annotated[str, Query(alias="fileName", min_length=1, max_length=255)],
) -> Any:
    """Stream one PDF into staging, check it, then move it into the session's documents/ folder
    (FR-001–FR-008). Anything that can be refused is refused before the body is read."""
    if not file_name.lower().endswith(".pdf"):
        raise ApiError(415, "unsupported_type", "Only PDF files can be added here.")
    length = uploads.declared_length(request, MAX_DOCUMENT_BYTES, WHAT)
    if length == 0:
        raise ApiError(422, "unreadable_pdf", f"{file_name} couldn't be read as a PDF.")
    await anyio.to_thread.run_sync(sfs.resolve, db, user, session_key)  # 404 before the body
    staged = await uploads.receive_upload(request, storage, length, MAX_DOCUMENT_BYTES, WHAT)
    try:
        return await anyio.to_thread.run_sync(
            svc.import_document, db, storage, user, session_key, staged, file_name
        )
    except BaseException:
        await anyio.to_thread.run_sync(storage.discard_upload, staged.path)
        raise


@router.get("/documents/{document_id}", response_model=Document)
def get_document(document_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return svc.get_document(db, storage, user, document_id)


@router.patch("/documents/{document_id}", response_model=Document)
def patch_document(
    document_id: str,
    body: DocumentPatch,
    version: IfMatch,
    user: CurrentUser,
    db: DbSession,
    storage: Storage,
) -> Any:
    if body.name is not None:
        return svc.rename_document(db, storage, user, document_id, version, body.name)
    assert body.page_count is not None
    return svc.set_page_count(db, storage, user, document_id, version, body.page_count)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: str, version: IfMatch, user: CurrentUser, db: DbSession, storage: Storage
) -> Response:
    svc.delete_document(db, storage, user, document_id, version)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documents/{document_id}/file", response_class=FileResponse)
def get_file(document_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    """The PDF exactly as uploaded; Range requests give progressive loading (research R2)."""
    path, d = svc.file_path(db, storage, user, document_id)
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=d.file_name,
        content_disposition_type="inline",
        headers={
            "ETag": f'"{d.sha256}"',
            "Cache-Control": "private, max-age=0, must-revalidate",
        },
    )


@router.get("/documents/{document_id}/position", response_model=Position)
def get_position(document_id: str, user: CurrentUser, db: DbSession) -> Any:
    return svc.get_position(db, user, document_id)


@router.put("/documents/{document_id}/position", response_model=Position)
def put_position(document_id: str, body: PositionPut, user: CurrentUser, db: DbSession) -> Any:
    return svc.put_position(db, user, document_id, body.page)


@router.get(
    "/documents/{document_id}/annotations", response_model=AnnotationSet, tags=["annotations"]
)
def list_annotations(document_id: str, user: CurrentUser, db: DbSession, storage: Storage) -> Any:
    return annotation_service.list_annotations(db, storage, user, document_id)


@router.post(
    "/documents/{document_id}/annotations/ops",
    response_model=AnnotationOpsResponse,
    tags=["annotations"],
)
def apply_annotation_ops(
    document_id: str, body: AnnotationOpsRequest, user: CurrentUser, db: DbSession, storage: Storage
) -> Any:
    """Merged per annotation; idempotent by opId (research R7). The service already shapes the
    body (absent fields omitted, `notice` always present), so it is returned as is."""
    return JSONResponse(annotation_service.apply(db, storage, user, document_id, body.ops))
