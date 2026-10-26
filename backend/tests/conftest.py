"""Shared fixtures: an app on a temp data dir (real SQLite + temp storage root)."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from unihelper.config import Settings
from unihelper.main import create_app
from unihelper.models import User
from unihelper.services import auth_service

OWNER = {"username": "owner", "password": "owner-password-1", "timezone": "Europe/Istanbul"}


@pytest.fixture
def anyio_backend() -> str:
    """Async tests (`@pytest.mark.anyio`) run on asyncio, like the app."""
    return "asyncio"


@pytest.fixture
def tmp_data_dir(tmp_path: Path) -> Path:
    return tmp_path / "data"


# 014 T130: every API key a test uses; the run fails if one shows up in a log record or in a chat
# file written anywhere under the test temp folders (SC-005)
TEST_KEYS: set[str] = set()
LEAKS: list[str] = []


def register_test_key(key: str) -> str:
    TEST_KEYS.add(key)
    return key


class _KeyLeakHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            text = record.getMessage()
        except Exception:  # pragma: no cover - a broken record is not a leak
            return
        for key in TEST_KEYS:
            if key in text:
                LEAKS.append(f"log record {record.name}: {text[:80]}")


def pytest_configure(config: pytest.Config) -> None:
    handler = _KeyLeakHandler(level=logging.DEBUG)
    logging.getLogger().addHandler(handler)


def _chat_file_leaks(session: pytest.Session) -> list[str]:
    factory = getattr(session.config, "_tmp_path_factory", None)
    if factory is None or not TEST_KEYS:
        return []
    base = factory.getbasetemp()
    hits = []
    for path in base.rglob("chats/**/*"):
        if path.is_file():
            data = path.read_bytes()
            hits += [f"{path}: key found" for key in TEST_KEYS if key.encode() in data]
    return hits


# (METHOD, route template) of every successful (2xx) request the suite makes — checked by the
# coverage guard in pytest_sessionfinish
EXERCISED: set[tuple[str, str]] = set()


def _record_routes(app):  # type: ignore[no-untyped-def]
    @app.middleware("http")
    async def record(request, call_next):  # type: ignore[no-untyped-def]
        response = await call_next(request)
        # only successful calls count: every operation needs a test that exercises it for real
        path = request.url.path
        if path.startswith("/api/v1") and 200 <= response.status_code < 300:
            EXERCISED.add((request.method, path.removeprefix("/api/v1")))
        return response

    return app


@pytest.fixture
def key_file(tmp_path: Path) -> Path:
    """014: the secret store's master key lives in a file outside the data folder."""
    return tmp_path / "keys" / "master.key"


@pytest.fixture
def app(tmp_data_dir: Path, key_file: Path):  # type: ignore[no-untyped-def]
    # transcription jobs run only when a test asks (tests/contract/transcription_helpers.run_jobs);
    # provider HTTP goes to the in-process fake transcriber, AI chat HTTP to the fake LLM (014)
    import httpx

    from tests import fake_llm, fake_transcriber
    from tests.streaming_asgi import StreamingASGITransport

    application = create_app(
        Settings(
            data_dir=tmp_data_dir,
            transcription_autorun=False,
            key_store="file",
            key_file=key_file,
        )
    )
    application.state.ai_transport = StreamingASGITransport(fake_llm.app)
    fake_llm.reset()
    worker = application.state.transcription_worker
    worker.transport = httpx.ASGITransport(app=fake_transcriber.app)
    worker.retry_delays = (0, 0, 0)
    fake_transcriber.app.state.calls.clear()
    fake_transcriber.app.state.required_key = None
    fake_transcriber.app.state.fail_once_done.clear()
    return _record_routes(application)


def pytest_sessionfinish(session: pytest.Session, exitstatus: int) -> None:
    """Constitution VI: every contract operation must be exercised by the suite. Only enforced
    on full runs (no -k / file selection), so focused runs stay usable."""
    import re

    from tests.contract.openapi_check import contract_operations

    leaks = LEAKS + _chat_file_leaks(session)
    if leaks:
        print("\nAPI keys leaked:\n  " + "\n  ".join(leaks[:20]))
        session.exitstatus = 1
    if session.config.option.keyword or session.config.args not in ([], ["tests"]):
        return
    if exitstatus != 0 or not EXERCISED:
        return

    def covered(op: str) -> bool:
        method, template = op.split(" ", 1)
        rx = re.compile("^" + re.sub(r"\{[^}]+\}", "[^/]+", template) + "$")
        return any(m == method and rx.match(p) for m, p in EXERCISED)

    missing = sorted(op for op in contract_operations() if not covered(op))
    if missing:
        print("\nContract operations never exercised by tests:\n  " + "\n  ".join(missing))
        session.exitstatus = 1


def _attach_csrf(client: TestClient) -> TestClient:
    token = client.cookies.get("uh_csrf")
    if token:
        client.headers["X-CSRF-Token"] = token
    return client


@pytest.fixture
def client(app) -> Iterator[TestClient]:  # type: ignore[no-untyped-def]
    with TestClient(app) as c:
        yield c


@pytest.fixture
def owner_client(client: TestClient) -> TestClient:
    r = client.post("/api/v1/setup/owner", json=OWNER)
    assert r.status_code == 201, r.text
    return _attach_csrf(client)


@pytest.fixture
def make_member(app, owner_client: TestClient) -> Callable[..., TestClient]:  # type: ignore[no-untyped-def]
    """Create a member directly through the models (independent of account_service) and
    return a separate signed-in client for them."""

    def _make(
        username: str = "member",
        password: str = "member-password-1",
        must_change_password: bool = False,
        timezone: str = "Europe/Istanbul",
    ) -> TestClient:
        factory = app.state.sessionmaker
        with factory() as db:
            db.add(
                User(
                    username=username,
                    password_hash=auth_service.hash_password(password),
                    role="member",
                    timezone=timezone,
                    must_change_password=must_change_password,
                )
            )
            db.commit()
        app.state.storage.ensure_dir([username])
        c = TestClient(app)
        r = c.post("/api/v1/auth/login", json={"username": username, "password": password})
        assert r.status_code == 200, r.text
        return _attach_csrf(c)

    return _make


def assert_problem(response, status: int, code: str) -> dict:  # type: ignore[no-untyped-def,type-arg]
    assert response.status_code == status, response.text
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["code"] == code, body
    assert body["status"] == status
    return body  # type: ignore[no-any-return]


# ---- 015: desktop mode ------------------------------------------------------------------------

DESKTOP_PORT = 47813
DESKTOP_HOST = f"127.0.0.1:{DESKTOP_PORT}"
LAUNCH_TOKEN = "a" * 64
CLIENT_SECRET = "b" * 64


@pytest.fixture
def desktop_handshake():  # type: ignore[no-untyped-def]
    from unihelper.desktop import handshake

    hs = handshake.Handshake(launch_token=LAUNCH_TOKEN, client_secret=CLIENT_SECRET)
    handshake.set_for_tests(hs)
    yield hs
    handshake.set_for_tests(None)


@pytest.fixture
def desktop_app(tmp_path: Path, key_file: Path, desktop_handshake):  # type: ignore[no-untyped-def]
    """The app in desktop mode: separate backend data and files folders, a known handshake."""
    files = tmp_path / "Documents" / "UniHelperProMax"
    files.mkdir(parents=True)
    application = create_app(
        Settings(
            data_dir=tmp_path / "backend",
            files_dir=files,
            transcription_autorun=False,
            key_store="file",
            key_file=key_file,
            desktop=True,
            desktop_user="Test Student",
            port=DESKTOP_PORT,
        )
    )
    return _record_routes(application)


@pytest.fixture
def desktop_client(desktop_app) -> Iterator[TestClient]:  # type: ignore[no-untyped-def]
    """Requests as the app window sends them: own Host and the client-secret header."""
    with TestClient(
        desktop_app,
        base_url=f"http://{DESKTOP_HOST}",
        headers={"X-UniHelper-Client": CLIENT_SECRET},
    ) as c:
        yield c
