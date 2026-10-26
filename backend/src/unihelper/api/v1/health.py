from __future__ import annotations

from importlib.metadata import PackageNotFoundError, version

from fastapi import APIRouter, Request

router = APIRouter(tags=["meta"])


def app_version(request: Request) -> str:
    configured: str | None = request.app.state.settings.app_version
    if configured:
        return configured
    try:
        return version("unihelper")
    except PackageNotFoundError:  # pragma: no cover - running from an unpacked tree
        return "0.0.0"


@router.get("/health")
def health(request: Request) -> dict[str, str]:
    mode = "desktop" if request.app.state.settings.desktop else "web"
    return {"status": "ok", "version": app_version(request), "mode": mode}
