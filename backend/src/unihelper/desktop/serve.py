"""Desktop entry point: `unihelper-backend` (PyInstaller) or `python -m unihelper.desktop.serve`.

Reads the per-launch handshake from stdin, watches stdin for EOF (the Electron app exited or
crashed: stop), checks the folders and the port, runs uvicorn on 127.0.0.1:<UNIHELPER_PORT> and
maps every startup failure to an exit status plus `startup-error.json` (research R5,
contracts/backend-desktop-mode.md §1–§2). Also usable without desktop mode: it then serves on
UNIHELPER_HOST/UNIHELPER_PORT like `uvicorn unihelper.main:app`.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import sqlite3
import sys
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn

from unihelper.config import Settings, load_settings
from unihelper.desktop import handshake, lifecycle
from unihelper.desktop.lifecycle import request_shutdown
from unihelper.desktop.startup_errors import StartupError, write_startup_error

log = logging.getLogger("unihelper.desktop")

GRACE_SECONDS = 5.0
__all__ = ["main", "request_shutdown"]


def _hard_exit_later() -> None:
    def _kill() -> None:
        time.sleep(GRACE_SECONDS)
        log.error("graceful shutdown took longer than %.0f s; exiting", GRACE_SECONDS)
        os._exit(0)

    threading.Thread(target=_kill, name="hard-exit", daemon=True).start()


def _watch_stdin() -> None:
    """EOF on stdin means the app that started us is gone: the portable orphan guard."""

    def _watch() -> None:
        try:
            while sys.stdin.read(4096):
                pass
        except (OSError, ValueError):
            pass
        log.info("stdin closed; shutting down")
        request_shutdown()
        _hard_exit_later()

    threading.Thread(target=_watch, name="stdin-watchdog", daemon=True).start()


def _install_signal_handlers() -> None:
    def _on_signal(signum: int, _frame: Any) -> None:
        log.info("signal %s; shutting down", signum)
        request_shutdown()
        _hard_exit_later()

    for name in ("SIGTERM", "SIGINT", "SIGBREAK", "SIGHUP"):
        sig = getattr(signal, name, None)
        if sig is not None:
            try:
                signal.signal(sig, _on_signal)
            except (OSError, ValueError):  # pragma: no cover - not in the main thread
                pass
    if sys.platform == "win32":  # pragma: no cover - Windows only
        _install_windows_console_handler()


def _install_windows_console_handler() -> None:  # pragma: no cover - Windows only
    """CTRL_CLOSE / CTRL_LOGOFF / CTRL_SHUTDOWN give a process a few seconds to stop."""
    import ctypes
    from ctypes import wintypes

    handler_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)  # type: ignore[attr-defined]

    def _handler(event: int) -> bool:
        if event in (2, 5, 6):  # CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT
            request_shutdown()
            deadline = time.monotonic() + GRACE_SECONDS
            while lifecycle.server is not None and not lifecycle.stopped.is_set():
                if time.monotonic() > deadline:
                    break
                time.sleep(0.1)
            return True
        return False

    global _console_handler
    _console_handler = handler_type(_handler)  # keep a reference: ctypes callbacks are GC'd
    ctypes.windll.kernel32.SetConsoleCtrlHandler(_console_handler, True)  # type: ignore[attr-defined]


_console_handler: Any = None


def _log_file() -> str | None:
    return os.environ.get("UNIHELPER_LOG_FILE") or None


def _fail(settings: Settings, kind: StartupError, message: str, **details: Any) -> int:
    log.error("startup failed: %s (%s)", kind.code, message)
    return write_startup_error(settings.data_dir, kind, message, details, _log_file())


def _preflight(settings: Settings) -> int | None:
    try:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.data_dir / ".write-test"
        probe.write_bytes(b"ok")
        probe.unlink()
    except OSError as exc:
        return _fail(
            settings,
            StartupError.DATA_DIR_UNWRITABLE,
            f"The folder {settings.data_dir} can't be written.",
            path=str(settings.data_dir),
            reason=type(exc).__name__,
        )
    if settings.desktop and not settings.files_root.is_dir():
        return _fail(
            settings,
            StartupError.FILES_DIR_MISSING,
            f"The folder {settings.files_root} can't be found.",
            path=str(settings.files_root),
        )
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        # the same options uvicorn uses, so connections of the previous run still in TIME_WAIT
        # don't make a free port look busy
        if sys.platform == "win32":  # pragma: no cover - Windows only
            s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)  # type: ignore[attr-defined]
        else:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((settings.host, settings.port))
        except OSError:
            return _fail(
                settings,
                StartupError.PORT_IN_USE,
                f"Port {settings.port} is already in use.",
                port=settings.port,
            )
    return None


def _latest_backup(settings: Settings) -> str | None:
    backups = sorted(settings.backups_dir.glob("unihelper-*.sqlite3"))
    return str(backups[-1]) if backups else None


def _map_startup_error(settings: Settings, exc: BaseException) -> int:
    from unihelper.db import migrate
    from unihelper.single_process import AnotherServerRunning

    if isinstance(exc, AnotherServerRunning):
        return _fail(
            settings,
            StartupError.ANOTHER_SERVER,
            "Another UniHelperProMax server is using this data.",
            lockFile=str(settings.data_dir / "server.lock"),
        )
    if isinstance(exc, FileNotFoundError) and Path(str(exc)) == settings.files_root:
        return _fail(
            settings,
            StartupError.FILES_DIR_MISSING,
            f"The folder {settings.files_root} can't be found.",
            path=str(settings.files_root),
        )
    handled = getattr(migrate, "startup_error_for", None)
    if handled is not None:
        mapped = handled(exc)
        if mapped is not None:
            error, message, details = mapped
            return _fail(settings, error, message, **details)
    if _is_damaged_database(exc):
        return _fail(
            settings,
            StartupError.DATABASE_DAMAGED,
            "The database is damaged.",
            path=str(settings.db_path),
            latestBackup=_latest_backup(settings),
        )
    return _fail(
        settings, StartupError.UNEXPECTED, "The app could not start.", error=type(exc).__name__
    )


def _is_damaged_database(exc: BaseException) -> bool:
    seen: BaseException | None = exc
    while seen is not None:
        if isinstance(seen, sqlite3.DatabaseError) and not isinstance(
            seen, sqlite3.OperationalError
        ):
            return True
        text = str(seen).lower()
        if "file is not a database" in text or "database disk image is malformed" in text:
            return True
        seen = seen.__cause__ or seen.__context__
    return False


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = load_settings()
    if settings.desktop:
        try:
            handshake.set_current(handshake.read_handshake(sys.stdin))
        except handshake.HandshakeError as exc:
            return _fail(settings, StartupError.HANDSHAKE_FAILED, str(exc))
        _watch_stdin()
    stale = settings.data_dir / "startup-error.json"
    try:
        stale.unlink(missing_ok=True)
    except OSError:
        pass
    _install_signal_handlers()
    failed = _preflight(settings)
    if failed is not None:
        return failed

    from unihelper.main import create_app

    try:
        app = create_app(settings)
    except Exception as exc:  # e.g. Settings.check() refused the folders
        return _map_startup_error(settings, exc)
    config = uvicorn.Config(
        app,
        host=settings.host,
        port=settings.port,
        workers=1,
        lifespan="on",
        log_level="info",
        access_log=False,
        server_header=False,
    )
    server = lifecycle.server = uvicorn.Server(config)
    if lifecycle.stopping.is_set():  # EOF or a signal arrived before uvicorn existed
        server.should_exit = True
    try:
        server.run()
    except SystemExit:  # uvicorn exits when it can't bind (a race after the preflight)
        if not server.started:
            return _fail(
                settings,
                StartupError.PORT_IN_USE,
                f"Port {settings.port} is already in use.",
                port=settings.port,
            )
        raise
    finally:
        lifecycle.stopped.set()
    startup_error = getattr(app.state, "startup_error", None)
    if startup_error is not None:
        return _map_startup_error(settings, startup_error)
    if not server.started and not lifecycle.stopping.is_set():
        return _fail(
            settings,
            StartupError.PORT_IN_USE,
            f"Port {settings.port} is already in use.",
            port=settings.port,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
