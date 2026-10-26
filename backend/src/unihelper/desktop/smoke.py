"""Post-build smoke test of the desktop backend (research R4, quickstart "Build").

    python -m unihelper.desktop.smoke <dist dir or executable>

Starts the built `unihelper-backend` like the Electron app does (temporary folders, handshake on
stdin), verifies its identity, checks migrations reached head, asks it to shut down and checks it
exits; then starts it again and checks that closing stdin stops it too. Exits non-zero on any
failure. The helpers are reused by the integration tests with `python -m unihelper.desktop.serve`.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

START_TIMEOUT = 60.0
STOP_TIMEOUT = 5.0
TEMP_CLEANUP_TIMEOUT = 10.0
TEMP_CLEANUP_RETRY_DELAY = 0.2


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@dataclass
class Launched:
    proc: subprocess.Popen[bytes]
    port: int
    launch_token: str
    client_secret: str
    data_dir: Path
    files_dir: Path

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base, headers={"X-UniHelper-Client": self.client_secret}, timeout=10
        )


def launch(
    cmd: list[str], root: Path, port: int | None = None, extra_env: dict[str, str] | None = None
) -> Launched:
    data_dir, files_dir = root / "backend", root / "Documents" / "UniHelperProMax"
    files_dir.mkdir(parents=True, exist_ok=True)
    port = port or free_port()
    env = {
        **os.environ,
        "UNIHELPER_DESKTOP": "1",
        "UNIHELPER_PORT": str(port),
        "UNIHELPER_DATA_DIR": str(data_dir),
        "UNIHELPER_FILES_DIR": str(files_dir),
        "UNIHELPER_KEY_STORE": "file",
        "UNIHELPER_KEY_FILE": str(root / "keys" / "master.key"),
        "UNIHELPER_DESKTOP_USER": "smoke",
        **(extra_env or {}),
    }
    token, secret = secrets.token_hex(32), secrets.token_hex(32)
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, env=env)
    assert proc.stdin is not None
    proc.stdin.write((json.dumps({"launchToken": token, "clientSecret": secret}) + "\n").encode())
    proc.stdin.flush()
    return Launched(proc, port, token, secret, data_dir, files_dir)


def wait_identity(app: Launched, timeout: float = START_TIMEOUT) -> dict[str, object]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if app.proc.poll() is not None:
            raise RuntimeError(f"backend exited early with {app.proc.returncode}")
        nonce = secrets.token_hex(16)
        try:
            r = httpx.get(f"{app.base}/api/v1/desktop/identity", params={"nonce": nonce}, timeout=2)
        except httpx.HTTPError:
            time.sleep(0.2)
            continue
        if r.status_code == 200:
            body: dict[str, object] = r.json()
            expected = hmac.new(
                bytes.fromhex(app.launch_token), bytes.fromhex(nonce), hashlib.sha256
            )
            if body.get("proof") != expected.hexdigest():
                raise RuntimeError("identity proof mismatch: another program answers on this port")
            return body
        time.sleep(0.2)
    raise RuntimeError("backend did not become ready in time")


def wait_exit(app: Launched, timeout: float = STOP_TIMEOUT) -> int:
    try:
        return app.proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        app.proc.kill()
        app.proc.wait()
        raise RuntimeError(f"backend did not exit within {timeout:.0f} s") from None
    finally:
        stdin = app.proc.stdin
        if stdin is not None and not stdin.closed:
            stdin.close()


def shutdown(app: Launched) -> int:
    with app.client() as c:
        r = c.post(
            "/api/v1/desktop/shutdown", headers={"Authorization": f"Bearer {app.launch_token}"}
        )
        if r.status_code != 202:
            raise RuntimeError(f"shutdown answered {r.status_code}")
    return wait_exit(app)


def close_stdin(app: Launched) -> int:
    assert app.proc.stdin is not None
    app.proc.stdin.close()
    return wait_exit(app)


def migrations_at_head(app: Launched) -> bool:
    from alembic.script import ScriptDirectory

    from unihelper.db.migrate import alembic_config

    db = app.data_dir / "unihelper.sqlite3"
    with sqlite3.connect(db) as conn:
        current = conn.execute("SELECT version_num FROM alembic_version").fetchone()[0]
    head = ScriptDirectory.from_config(alembic_config(f"sqlite:///{db}")).get_current_head()
    return bool(current == head)


def cleanup_temp_dir(path: Path) -> None:
    deadline = time.monotonic() + TEMP_CLEANUP_TIMEOUT
    while True:
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except PermissionError as exc:
            if time.monotonic() >= deadline:
                print(
                    f"smoke: warning: could not remove temp dir {path} ({exc})",
                    file=sys.stderr,
                )
                return
            time.sleep(TEMP_CLEANUP_RETRY_DELAY)


def _command(target: Path) -> list[str]:
    if target.is_dir():
        exe = target / ("unihelper-backend.exe" if sys.platform == "win32" else "unihelper-backend")
    else:
        exe = target
    if not exe.is_file():
        raise SystemExit(f"no backend executable at {exe}")
    return [str(exe)]


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1:
        print(__doc__)
        return 2
    cmd = _command(Path(args[0]))
    root = Path(tempfile.mkdtemp(prefix="uh-smoke-"))
    app: Launched | None = None
    again: Launched | None = None
    try:
        app = launch(cmd, root)
        identity = wait_identity(app)
        with app.client() as c:
            health = c.get("/api/v1/health").json()
        if health.get("mode") != "desktop":
            raise RuntimeError(f"unexpected health {health}")
        if not migrations_at_head(app):
            raise RuntimeError("migrations did not reach head")
        code = shutdown(app)
        if code != 0:
            raise RuntimeError(f"shutdown exit status {code}")
        version = identity["version"]
        print(f"smoke: identity ok (version {version}), migrations at head, shutdown ok")
        again = launch(cmd, root)
        wait_identity(again)
        code = close_stdin(again)
        if code != 0:
            raise RuntimeError(f"stdin-close exit status {code}")
        print("smoke: closing stdin stopped the backend")
        return 0
    except Exception as exc:
        print(f"smoke FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        for launched in (again, app):
            if launched is not None and launched.proc.poll() is None:
                launched.proc.kill()
                launched.proc.wait()
        cleanup_temp_dir(root)


if __name__ == "__main__":
    sys.exit(main())
