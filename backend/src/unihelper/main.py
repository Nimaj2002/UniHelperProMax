"""Application factory: /api/v1 routers, error handlers, migrations, optional SPA serving."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from unihelper.api.deps import csrf_protect
from unihelper.api.errors import install_error_handlers, problem_response
from unihelper.api.v1 import (
    admin,
    auth,
    classes,
    health,
    hierarchy,
    notes,
    sessions,
    setup,
    timeline,
    workspace,
)
from unihelper.config import Settings, load_settings
from unihelper.db.engine import make_engine, make_sessionmaker
from unihelper.db.migrate import upgrade_to_head
from unihelper.services.login_throttle import LoginThrottle
from unihelper.storage.storage_service import StorageService

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
        sessions,
        notes,
        timeline,
        workspace,
    ):
        api.include_router(module.router)
    return api


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        # always upgrade: a no-op when the schema is already at head
        upgrade_to_head(app.state.engine)
        settings.files_root.mkdir(parents=True, exist_ok=True)
        yield
        app.state.engine.dispose()

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
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
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
