"""Application factory: /api/v1 routers, error handlers, migrations, optional SPA serving."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from unihelper import single_process
from unihelper.api.deps import csrf_protect
from unihelper.api.errors import install_error_handlers, problem_response
from unihelper.api.v1 import (
    admin,
    auth,
    calendar_io,
    classes,
    documents,
    events,
    health,
    hierarchy,
    notes,
    recordings,
    sessions,
    settings,
    setup,
    tasks,
    themes,
    timeline,
    transcription,
    trash,
    workspace,
)
from unihelper.config import Settings, load_settings
from unihelper.db.engine import make_engine, make_sessionmaker
from unihelper.db.migrate import upgrade_to_head
from unihelper.services import annotation_service, calendar_import_service, task_service
from unihelper.services.login_throttle import LoginThrottle
from unihelper.storage.storage_service import StorageService
from unihelper.transcription.worker import TranscriptionWorker

log = logging.getLogger("unihelper")

API_PREFIX = "/api/v1"


def build_api_router() -> APIRouter:
    api = APIRouter(prefix=API_PREFIX, dependencies=[Depends(csrf_protect)])
    for module in (
        health,
        setup,
        auth,
        admin,
        hierarchy,
        classes,
        events,
        sessions,
        notes,
        timeline,
        workspace,
        recordings,
        documents,
        transcription,
        settings,
        themes,
        trash,
        calendar_io,
    ):
        api.include_router(module.router)
    for router in tasks.routers:  # 012: /task-columns, /tasks, /quick-notes
        api.include_router(router)
    return api


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        server_lock = single_process.acquire(settings.data_dir)  # before touching any data
        try:
            # always upgrade: a no-op when the schema is already at head
            upgrade_to_head(app.state.engine)
            settings.files_root.mkdir(parents=True, exist_ok=True)
            try:  # results of annotation ops older than 30 days (007 research R7)
                with Session(app.state.engine) as db:
                    annotation_service.prune_applied_ops(db)
            except SQLAlchemyError:
                log.exception("could not prune old annotation op results")
            try:  # staging files left by an import interrupted by a restart (006)
                app.state.storage.sweep_uploads(timedelta(hours=1))
            except OSError:
                log.exception("could not clean up the import staging folder")
            try:  # calendar previews that expired while the server was down (010 R2)
                with Session(app.state.engine) as db:
                    calendar_import_service.forget_expired(db)
            except SQLAlchemyError:
                log.exception("could not clean up expired calendar import previews")
            try:  # tasks and quick notes deleted more than 24 h ago (012 R6)
                with Session(app.state.engine) as db:
                    task_service.purge_expired(db)
            except SQLAlchemyError:
                log.exception("could not purge deleted tasks")
            worker: TranscriptionWorker = app.state.transcription_worker
            if settings.transcription_autorun:
                await worker.start()
            yield
            await worker.stop()
            app.state.engine.dispose()
        finally:
            server_lock.close()

    app = FastAPI(
        title="UniHelperProMax API",
        version="1.0.0",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    engine = make_engine(settings)
    app.state.settings = settings
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.storage = StorageService(settings.files_root)
    app.state.login_throttle = LoginThrottle()
    app.state.transcription_worker = TranscriptionWorker(
        app.state.sessionmaker,
        app.state.storage,
        concurrency=settings.transcription_concurrency,
    )

    install_error_handlers(app)
    app.include_router(build_api_router())

    @app.middleware("http")
    async def security_headers(request: Request, call_next):  # type: ignore[no-untyped-def]
        response: Response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if not request.url.path.startswith(API_PREFIX):
            response.headers.setdefault(
                "Content-Security-Policy",
                # the PDF reader (EmbedPDF) compiles PDFium's WebAssembly in a blob: worker
                # and shows rendered pages as blob: images
                "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
                "worker-src 'self' blob:; img-src 'self' data: blob:; "
                "style-src 'self' 'unsafe-inline'; "
                "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
            )
        return response

    if settings.static_dir and settings.static_dir.is_dir():
        _mount_spa(app, settings)
    return app


def _mount_spa(app: FastAPI, settings: Settings) -> None:
    static_dir = settings.static_dir
    assert static_dir is not None
    index = static_dir / "index.html"
    assets = static_dir / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> Response:
        if full_path.startswith(API_PREFIX.lstrip("/")):
            return problem_response(404, "not_found", "Resource not found")
        candidate = (static_dir / full_path).resolve()
        if full_path and candidate.is_file() and static_dir.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
