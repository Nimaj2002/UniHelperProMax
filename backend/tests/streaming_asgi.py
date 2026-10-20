"""An httpx transport that calls an ASGI app in-process and *streams* its response.

`httpx.ASGITransport` buffers the whole body before returning, so a streamed answer would arrive
at once and closing the response could never reach the app. Here the app runs in its own task:
body chunks are handed over as they are sent, and closing the response tells the app the client
went away (`http.disconnect`) and cancels it — like a real connection being closed (014 T004)."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from typing import Any

import httpx

_END = object()


class _Stream(httpx.AsyncByteStream):
    def __init__(
        self, queue: asyncio.Queue[Any], task: asyncio.Task[None], gone: asyncio.Event
    ) -> None:
        self._queue = queue
        self._task = task
        self._gone = gone

    async def __aiter__(self) -> AsyncIterator[bytes]:
        while True:
            item = await self._queue.get()
            if item is _END:
                return
            if isinstance(item, BaseException):
                raise item
            yield item

    async def aclose(self) -> None:
        self._gone.set()
        if not self._task.done():
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task


class StreamingASGITransport(httpx.AsyncBaseTransport):
    def __init__(self, app: Any) -> None:
        self.app = app

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        body = await request.aread()
        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": request.method,
            "headers": [(k.lower(), v) for (k, v) in request.headers.raw],
            "scheme": request.url.scheme,
            "path": request.url.path,
            "raw_path": request.url.raw_path.split(b"?")[0],
            "query_string": request.url.query,
            "server": (request.url.host, request.url.port),
            "client": ("127.0.0.1", 123),
            "root_path": "",
        }
        queue: asyncio.Queue[Any] = asyncio.Queue()
        started: asyncio.Future[tuple[int, list[tuple[bytes, bytes]]]] = (
            asyncio.get_running_loop().create_future()
        )
        gone = asyncio.Event()
        sent_body = False

        async def receive() -> dict[str, Any]:
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": body, "more_body": False}
            await gone.wait()
            return {"type": "http.disconnect"}

        async def send(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                started.set_result((message["status"], message.get("headers", [])))
            elif message["type"] == "http.response.body":
                chunk = message.get("body", b"")
                if chunk:
                    await queue.put(chunk)
                if not message.get("more_body", False):
                    await queue.put(_END)

        async def run() -> None:
            try:
                await self.app(scope, receive, send)
            except asyncio.CancelledError:
                raise
            except BaseException as exc:  # surfaced to the reader
                if not started.done():
                    started.set_exception(exc)
                else:
                    await queue.put(exc)
            finally:
                await queue.put(_END)

        task = asyncio.create_task(run())
        status, headers = await started
        return httpx.Response(
            status, headers=headers, stream=_Stream(queue, task, gone), request=request
        )
