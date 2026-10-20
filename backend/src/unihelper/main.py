"""Application factory: /api/v1 routers, error handlers, migrations, optional SPA serving."""

from __future__ import annotations

import asyncio
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
    ai,
    auth,
    calendar_io,
    chat_runs,
    chats,
    classes,
    documents,
    events,
    health,
    hierarchy,
    notes,
    recordings,
    secrets,
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
from unihelper.chat.runs import RunRegistry
from unihelper.config import Settings, load_settings
from unihelper.db.engine import make_engine, make_sessionmaker
from unihelper.db.migrate import upgrade_to_head
from unihelper.secrets import store as secret_store
from unihelper.secrets.migrate import migrate_plaintext
from unihelper.services import (
    annotation_service,
    calendar_import_service,
    chat_service,
    task_service,
)
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
        secrets,  # 014
        ai,
        chats,
        chat_runs,
    ):
        api.include_router(module.router)
    for router in tasks.routers:  # 012: /task-columns, /tasks, /quick-notes
        api.include_router(router)
    return api


async def _sweep_chats(app: FastAPI) -> None:
    """014: deleted chats past their Undo window, every 10 minutes (and at startup)."""
    from unihelper.chat import sweep

    while True:
        try:
            await asyncio.to_thread(sweep.run, app.state.sessionmaker, app.state.storage)
        except Exception:
            log.exception("could not clean up deleted chats")
        await asyncio.sleep(600)


def _open_secret_store(app: FastAPI) -> None:
    """014: find the master key, then move any plaintext transcription keys into the encrypted
    store. A lost key leaves the store unreadable (Settings says so); the app still starts."""
    store: secret_store.SecretStore = app.state.secrets
    try:
        with Session(app.state.engine) as db:
            store.open(db)
            db.commit()
    except Exception as exc:
        log.error("could not open the secret store (%s)", type(exc).__name__)
    secret_store.install(store)
    migrate_plaintext(app.state.sessionmaker, store)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    settings.check()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        server_lock = single_process.acquire(settings.data_dir)  # before touching any data
        try:
            # always upgrade: a no-op when the schema is already at head
            upgrade_to_head(app.state.engine)
            settings.files_root.mkdir(parents=True, exist_ok=True)
            _open_secret_store(app)
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
            runs: RunRegistry = app.state.chat_runs  # 014: answers interrupted by a restart
            runs.attach(asyncio.get_running_loop())
            try:
                runs.recover()
            except SQLAlchemyError:
                log.exception("could not recover interrupted chat answers")
            sweeper = asyncio.create_task(_sweep_chats(app))
            worker: TranscriptionWorker = app.state.transcription_worker
            if settings.transcription_autorun:
                await worker.start()
            yield
            sweeper.cancel()
            await runs.shutdown()
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
    app.state.ai_transport = None  # 014: tests route AI provider HTTP to the fake LLM
    app.state.secrets = secret_store.SecretStore(settings)
    app.state.chat_runs = RunRegistry(
        app.state.sessionmaker,
        app.state.storage,
        lambda: app.state.ai_transport,
        chat_service.label_of,
        max_per_user=settings.chat_max_runs_per_user,
        max_total=settings.chat_max_runs_total,
    )
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
                SANDBOX_CSP.get(request.url.path, APP_CSP),
            )
        return response

    if settings.static_dir and settings.static_dir.is_dir():
        _mount_spa(app, settings)
    return app


# the PDF reader (EmbedPDF) compiles PDFium's WebAssembly in a blob: worker and shows
# rendered pages as blob: images
APP_CSP = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
    "worker-src 'self' blob:; img-src 'self' data: blob:; "
    "style-src 'self' 'unsafe-inline'; "
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
)

# 013: the diagram renderer frames (sandboxed, opaque origin) may only be framed by the app.
# The safe one has no network at all; the "allowed" one shows a diagram the user chose to
# allow with all of its own settings, so it may load what the diagram asks for.
SANDBOX_CSP = {
    "/diagram-sandbox.html": (
        "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; "
        "img-src data:; font-src 'self'; base-uri 'none'; frame-ancestors 'self'"
    ),
    "/diagram-sandbox-allowed.html": (
        "default-src 'none'; script-src 'self' 'unsafe-inline'; "
        "style-src 'unsafe-inline' https:; img-src data: https:; font-src 'self' https:; "
        "connect-src https:; base-uri 'none'; frame-ancestors 'self'"
    ),
}


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
