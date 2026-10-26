"""Exit codes and `startup-error.json`, read by the Electron main process to explain a failed
start (contracts/backend-desktop-mode.md §2, FR-005)."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

FILE_NAME = "startup-error.json"


class StartupError(Enum):
    # (code, exit status)
    PORT_IN_USE = ("port_in_use", 10)
    DATA_DIR_UNWRITABLE = ("data_dir_unwritable", 11)
    FILES_DIR_MISSING = ("files_dir_missing", 12)
    DATABASE_DAMAGED = ("database_damaged", 13)
    DATABASE_NEWER = ("database_newer", 14)
    MIGRATION_FAILED = ("migration_failed", 15)
    ANOTHER_SERVER = ("another_server", 16)
    LOW_DISK_FOR_BACKUP = ("low_disk_for_backup", 17)
    HANDSHAKE_FAILED = ("handshake_failed", 20)
    UNEXPECTED = ("unexpected", 1)

    @property
    def code(self) -> str:
        return self.value[0]

    @property
    def exit_status(self) -> int:
        return self.value[1]


def write_startup_error(
    data_dir: Path,
    error: StartupError,
    message: str,
    details: dict[str, Any] | None = None,
    log_file: str | None = None,
) -> int:
    """Write the file atomically (temp, fsync, rename) and return the exit status to use.
    The message and details never contain secrets or note, chat or recording content."""
    body = {
        "code": error.code,
        "exitCode": error.exit_status,
        "message": message,
        "details": details or {},
        "logFile": log_file,
        "at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    try:
        data_dir.mkdir(parents=True, exist_ok=True)
        target = data_dir / FILE_NAME
        tmp = target.with_suffix(".json.tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(body, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, target)
    except OSError:
        pass  # an unwritable data folder is itself the error; the exit status still says so
    return error.exit_status
