"""Request admission (research R8, contracts/backend-desktop-mode.md §3).

Desktop mode: the Host must be the app's own address (blocks DNS rebinding), every request must
carry the client secret the Electron main process adds (blocks other local programs and the
user's browser), and an Origin, when present, must be the app's own. During a data-folder move
mutating requests get 503.

Web mode: a Host allow-list only when UNIHELPER_ALLOWED_HOSTS is set, so the web and Docker
versions behave exactly as before unless their operator opts in.
"""

from __future__ import annotations

import threading
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response

from unihelper.api.errors import problem_response
from unihelper.config import Settings
from unihelper.desktop import handshake

CLIENT_HEADER = "X-UniHelper-Client"
IDENTITY_PATH = "/api/v1/desktop/identity"
DESKTOP_PREFIX = "/api/v1/desktop/"
MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

maintenance = threading.Event()  # set while the data folder is being moved (US4)


def _host_allowed(host: str, allowed: tuple[str, ...]) -> bool:
    name = host.rsplit(":", 1)[0] if not host.endswith("]") else host
    return host in allowed or name in allowed


def install(app: FastAPI, settings: Settings) -> None:
    """Register as the outermost middleware: call after every other middleware."""
    own_host = f"{settings.host}:{settings.port}"
    own_origin = f"http://{own_host}"

    @app.middleware("http")
    async def admission(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        host = request.headers.get("host", "")
        if settings.desktop:
            if host != own_host:
                return problem_response(421, "misdirected_request", "Unknown host.")
            exempt = request.method == "GET" and request.url.path == IDENTITY_PATH
            hs = handshake.current()
            if not exempt and (
                hs is None or not hs.check_client(request.headers.get(CLIENT_HEADER))
            ):
                return problem_response(
                    403, "not_from_app", "This request did not come from the app."
                )
            origin = request.headers.get("origin")
            if origin is not None and origin != own_origin:
                return problem_response(403, "bad_origin", "This request came from another site.")
            if (
                maintenance.is_set()
                and request.method in MUTATING
                and not request.url.path.startswith(DESKTOP_PREFIX)
            ):
                return problem_response(
                    503, "maintenance", "Your data folder is being moved. Try again in a moment."
                )
        elif settings.allowed_hosts and not _host_allowed(host, settings.allowed_hosts):
            return problem_response(421, "misdirected_request", "Unknown host.")
        return await call_next(request)
