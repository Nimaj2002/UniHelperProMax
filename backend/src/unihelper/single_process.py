"""One server process per data folder (004-D1).

Note writes are serialized by an in-process lock (`note_service.note_file_lock`), so a second
process — `uvicorn --workers 2`, or another server started on the same data folder — could
overwrite a transcript. The first process holds an OS lock on `<data>/server.lock`; any other
process fails at startup, which also makes uvicorn's worker supervisor stop.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import IO

LOCK_NAME = "server.lock"


class AnotherServerRunning(RuntimeError):
    pass


def _try_lock(fh: IO[bytes]) -> bool:
    if sys.platform == "win32":  # pragma: no cover - exercised on Windows only
        import msvcrt

        try:
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True
    else:
        import fcntl

        try:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            return False
        return True


def acquire(data_dir: Path) -> IO[bytes]:
    """Hold the data folder's server lock until the returned file is closed."""
    fh = open(data_dir / LOCK_NAME, "a+b")  # noqa: SIM115 - kept open for the server's lifetime
    if not _try_lock(fh):
        fh.close()
        raise AnotherServerRunning(
            f"Another UniHelper server process is already using {data_dir}. The backend must run "
            "as a single process: start uvicorn without --workers (or with --workers 1), and "
            "don't start a second server on the same data folder."
        )
    return fh
