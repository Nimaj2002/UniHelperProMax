"""RFC 9457 problem+json errors with stable codes (research R12)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import NoResultFound
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("unihelper.api")

PROBLEM_JSON = "application/problem+json"


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        title: str,
        detail: str | None = None,
        errors: list[dict[str, str]] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(title)
        self.status = status
        self.code = code
        self.title = title
        self.detail = detail
        self.errors = errors
        self.headers = headers


def field_error(field: str, code: str, message: str) -> dict[str, str]:
    return {"field": field, "code": code, "message": message}


def validation_error(field: str, code: str, message: str, status: int = 422) -> ApiError:
    return ApiError(status, code, message, errors=[field_error(field, code, message)])


def not_found(what: str = "Resource") -> ApiError:
    return ApiError(404, "not_found", f"{what} not found")


def problem_response(
    status: int,
    code: str,
    title: str,
    detail: str | None = None,
    errors: list[dict[str, str]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "type": f"/problems/{code}",
        "title": title,
        "status": status,
        "code": code,
    }
    if detail:
        body["detail"] = detail
    if errors:
        body["errors"] = errors
    return JSONResponse(body, status_code=status, media_type=PROBLEM_JSON, headers=headers)


def _pointer(loc: tuple[Any, ...]) -> str:
    parts = list(loc)
    if parts and parts[0] in ("body",):
        parts = parts[1:]
    return "/" + "/".join(str(p) for p in parts)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_req: Request, exc: ApiError) -> JSONResponse:
        return problem_response(
            exc.status, exc.code, exc.title, exc.detail, exc.errors, exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_req: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            field_error(
                _pointer(tuple(e.get("loc", ()))),
                str(e.get("type", "invalid")),
                str(e.get("msg", "Invalid value")),
            )
            for e in exc.errors()
        ]
        return problem_response(422, "validation_failed", "Validation failed", errors=errors)

    @app.exception_handler(NoResultFound)
    async def _no_result(_req: Request, _exc: NoResultFound) -> JSONResponse:
        return problem_response(404, "not_found", "Resource not found")

    @app.exception_handler(StarletteHTTPException)
    async def _http(_req: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        return problem_response(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def _unexpected(_req: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return problem_response(500, "internal_error", "Something went wrong")
