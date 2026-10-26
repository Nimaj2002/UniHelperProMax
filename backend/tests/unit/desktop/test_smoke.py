from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

import pytest

from unihelper.desktop import smoke

pytestmark = pytest.mark.unit


class _FakeStdin:
    def __init__(self) -> None:
        self.closed = False
        self.close_calls = 0

    def close(self) -> None:
        self.close_calls += 1
        self.closed = True


class _FakeProc:
    def __init__(self, wait_results: list[int | BaseException]) -> None:
        self._wait_results = list(wait_results)
        self.stdin = _FakeStdin()
        self.killed = False
        self.returncode = None

    def wait(self, timeout: float | None = None) -> int:
        result = self._wait_results.pop(0)
        if isinstance(result, BaseException):
            raise result
        self.returncode = result
        return result

    def kill(self) -> None:
        self.killed = True

    def poll(self) -> int | None:
        return self.returncode


def _launched(proc: Any) -> smoke.Launched:
    return smoke.Launched(
        proc=proc,
        port=0,
        launch_token="0" * 64,
        client_secret="0" * 64,
        data_dir=Path("/tmp/data"),
        files_dir=Path("/tmp/files"),
    )


def test_wait_exit_closes_stdin_after_normal_exit() -> None:
    proc = _FakeProc([0])
    app = _launched(proc)
    assert smoke.wait_exit(app) == 0
    assert proc.stdin.closed
    assert proc.stdin.close_calls == 1


def test_wait_exit_kills_and_closes_stdin_on_timeout() -> None:
    proc = _FakeProc([subprocess.TimeoutExpired("cmd", 1.0), 0])
    app = _launched(proc)
    with pytest.raises(RuntimeError, match="did not exit within"):
        smoke.wait_exit(app, timeout=0.1)
    assert proc.killed
    assert proc.stdin.closed
    assert proc.stdin.close_calls == 1


def test_cleanup_temp_dir_retries_permission_error(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = {"rmtree": 0, "sleep": 0}

    def fake_rmtree(_: Path) -> None:
        calls["rmtree"] += 1
        if calls["rmtree"] == 1:
            raise PermissionError("locked")

    def fake_sleep(_: float) -> None:
        calls["sleep"] += 1

    monkeypatch.setattr(smoke.shutil, "rmtree", fake_rmtree)
    monkeypatch.setattr(smoke.time, "sleep", fake_sleep)
    smoke.cleanup_temp_dir(Path("/tmp/locked"))
    assert calls == {"rmtree": 2, "sleep": 1}


def test_cleanup_temp_dir_raises_when_lock_persists(monkeypatch: pytest.MonkeyPatch) -> None:
    times = iter([0.0, 9.5, 10.1])

    def always_locked(_: Path) -> None:
        raise PermissionError("locked")

    monkeypatch.setattr(smoke.shutil, "rmtree", always_locked)
    monkeypatch.setattr(smoke.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(smoke.time, "sleep", lambda _: None)
    with pytest.raises(PermissionError, match="locked"):
        smoke.cleanup_temp_dir(Path("/tmp/locked"))
