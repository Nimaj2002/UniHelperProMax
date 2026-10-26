"""The running server, shared by the entry point and the shutdown route.

Kept apart from `serve.py`: run as `python -m unihelper.desktop.serve` that module is
`__main__`, and a route importing `unihelper.desktop.serve` would get a second copy whose server
is None.
"""

from __future__ import annotations

import threading

import uvicorn

server: uvicorn.Server | None = None
stopping = threading.Event()
stopped = threading.Event()


def request_shutdown() -> None:
    """Graceful stop: uvicorn finishes requests, then the app's lifespan shutdown runs."""
    stopping.set()
    if server is not None:
        server.should_exit = True
