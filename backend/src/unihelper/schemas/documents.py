"""007 request/response models (contracts/openapi.yaml)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import Field, model_validator

from unihelper.schemas.common import ApiModel

AnnotationType = Literal["highlight", "ink", "textbox", "comment"]
AnnotationColor = Literal["yellow", "green", "blue", "pink", "orange", "purple"]
# PDF page space (points, unrotated, origin bottom-left; contracts/annotation-file.md)
Rect = Annotated[list[float], Field(min_length=4, max_length=4)]  # [x1, y1, x2, y2]
Point = Annotated[list[float], Field(min_length=2, max_length=2)]  # [x, y]
Stroke = Annotated[list[Point], Field(min_length=1, max_length=5000)]


class Document(ApiModel):
    id: str
    session_key: str
    name: str
    file_name: str
    original_file_name: str
    size: int
    encrypted: bool
    page_count: int | None
    uploaded_at: str
    annotation_count: int
    missing: bool
    version: int


class DocumentPatch(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    page_count: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _one_change(self) -> DocumentPatch:
        if self.name is None and self.page_count is None:
            raise ValueError("Send a name or a page count.")
        return self


class Position(ApiModel):
    page: int | None


class PositionPut(ApiModel):
    page: int = Field(ge=1)


class Annotation(ApiModel):
    id: str = Field(min_length=1, max_length=64)
    type: AnnotationType
    page: int = Field(ge=1)
    color: AnnotationColor
    rects: list[Rect] | None = Field(default=None, max_length=500)
    quoted: str | None = Field(default=None, max_length=2000)
    strokes: list[Stroke] | None = Field(default=None, max_length=1000)
    width: float | None = Field(default=None, ge=0.5, le=24)
    box: Rect | None = None
    anchor: Point | None = None
    text: str | None = Field(default=None, max_length=10000)
    rev: int | None = Field(default=None, ge=1)
    conflict_of: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class AnnotationSet(ApiModel):
    annotations: list[Annotation]


class AnnotationOp(ApiModel):
    op_id: str = Field(min_length=8, max_length=64)
    kind: Literal["upsert", "delete"]
    annotation: Annotation | None = None
    id: str | None = None
    base_rev: int | None = None

    @model_validator(mode="after")
    def _shape(self) -> AnnotationOp:
        if self.kind == "upsert" and self.annotation is None:
            raise ValueError("An upsert needs an annotation.")
        if self.kind == "delete" and not self.id:
            raise ValueError("A delete needs an id.")
        return self


class AnnotationOpsRequest(ApiModel):
    ops: list[AnnotationOp] = Field(min_length=1, max_length=200)


class AnnotationOpResult(ApiModel):
    op_id: str
    status: Literal["ok", "kept_both", "kept_changed"]
    annotation: Annotation | None = None
    # the incoming version kept as a copy (kept_both); "copy" on the wire
    conflict_copy: Annotation | None = Field(default=None, alias="copy")


class AnnotationOpsResponse(ApiModel):
    results: list[AnnotationOpResult]
    notice: str | None = None


class ViewerAnnotations(ApiModel):
    """The PDF viewer's (EmbedPDF) own annotations, kept as it exports them: `items` are the
    annotations made or changed in the app, `removed` the PDF's own annotations taken away
    (by page, type and position, since the PDF may not give them stable ids)."""

    items: list[dict[str, Any]] = Field(default_factory=list, max_length=10_000)
    removed: list[str] = Field(default_factory=list, max_length=10_000)
