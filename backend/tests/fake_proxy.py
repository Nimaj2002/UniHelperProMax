"""A tiny HTTP forward proxy for tests (021): relays absolute-URI requests, counts them, and can
demand Basic credentials. Plain http only — enough to prove a client really goes through it."""

from __future__ import annotations

import base64
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


class FakeProxy:
    def __init__(self, credentials: tuple[str, str] | None = None) -> None:
        self.requests: list[str] = []
        expected = (
            "Basic " + base64.b64encode(":".join(credentials).encode()).decode()
            if credentials
            else None
        )
        proxy = self

        class Handler(BaseHTTPRequestHandler):
            def _relay(self) -> None:
                if expected and self.headers.get("Proxy-Authorization") != expected:
                    self.send_response(407)
                    self.send_header("Proxy-Authenticate", 'Basic realm="test"')
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                proxy.requests.append(self.path)
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else None
                headers = {
                    k: v
                    for k, v in self.headers.items()
                    if k.lower() not in ("proxy-authorization", "host", "connection")
                }
                req = urllib.request.Request(self.path, body, headers, method=self.command)
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(req, timeout=10) as upstream:
                    data = upstream.read()
                    self.send_response(upstream.status)
                    for k, v in upstream.headers.items():
                        if k.lower() not in ("transfer-encoding", "connection", "content-length"):
                            self.send_header(k, v)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)

            do_GET = do_POST = _relay

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
