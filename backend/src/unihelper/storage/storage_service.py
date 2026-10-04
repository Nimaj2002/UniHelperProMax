"""The ONLY module that touches the file system (Constitution III; research R7).

It never deletes folders, and deleting metadata keeps user files (FR-019). The single exception
is `delete_note_file`: one confirmed `.md` file inside a `notes/` folder (002 research N6).
"""

from __future__ import annotations

import hashlib
import os
import secrets
import time
from collections.abc import Callable, Sequence
from pathlib import Path, PurePosixPath

from unihelper.domain.naming import safe_name


class StoragePathError(ValueError):
    pass


class StorageService:
    def __init__(self, files_root: Path) -> None:
        self.files_root = files_root.resolve()

    # ---- paths -------------------------------------------------------------------------
    def _check_part(self, part: str) -> None:
        if part in ("", ".", "..") or "/" in part or "\\" in part or os.path.isabs(part):
            raise StoragePathError(f"Invalid path component: {part!r}")

    def path_for(self, rel_parts: Sequence[str]) -> Path:
        for part in rel_parts:
            self._check_part(part)
        target = self.files_root.joinpath(*rel_parts).resolve()
        if target != self.files_root and self.files_root not in target.parents:
            raise StoragePathError("Path escapes the storage root")
        return target

    def user_root(self, username: str) -> Path:
        return self.path_for([safe_name(username)])

    @staticmethod
    def relative_path(rel_parts: Sequence[str]) -> str:
        """Path shown to users, relative to their own storage folder (skips the username)."""
        return str(PurePosixPath(*rel_parts[1:])) if len(rel_parts) > 1 else ""

    # ---- operations --------------------------------------------------------------------
    def ensure_dir(self, rel_parts: Sequence[str]) -> Path:
        path = self.path_for(rel_parts)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def rename_dir(self, old_parts: Sequence[str], new_parts: Sequence[str]) -> Callable[[], None]:
        """Rename a folder (creating the target if the source is missing). Returns an undo."""
        old = self.path_for(old_parts)
        new = self.path_for(new_parts)
        if old == new:
            return lambda: None
        if old.exists():
            new.parent.mkdir(parents=True, exist_ok=True)
            os.replace(old, new)

            def undo() -> None:
                if new.exists() and not old.exists():
                    os.replace(new, old)

            return undo
        new.mkdir(parents=True, exist_ok=True)
        return lambda: None

    # ---- files (feature 002) ----------------------------------------------------------
    @staticmethod
    def hash_bytes(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def read_bytes(self, parts: Sequence[str]) -> bytes | None:
        path = self.path_for(parts)
        try:
            return path.read_bytes()
        except FileNotFoundError:
            return None

    def file_hash(self, parts: Sequence[str]) -> str | None:
        data = self.read_bytes(parts)
        return None if data is None else self.hash_bytes(data)

    def write_text_atomic(self, parts: Sequence[str], text: str) -> tuple[str, int]:
        """Write via a temp file in the same folder + fsync + rename, so a crash leaves either
        the old or the new file — never a truncated one. Returns (sha256, size)."""
        path = self.path_for(parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = text.encode("utf-8")
        tmp = path.with_name(f".{path.name}.tmp-{secrets.token_hex(4)}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            _replace_with_retry(tmp, path)
        finally:
            if tmp.exists():
                tmp.unlink()
        _fsync_dir(path.parent)
        return self.hash_bytes(data), len(data)

    def rename_file(self, old_parts: Sequence[str], new_parts: Sequence[str]) -> Callable[[], None]:
        old = self.path_for(old_parts)
        new = self.path_for(new_parts)
        if old == new or not old.exists():
            return lambda: None
        _replace_with_retry(old, new)

        def undo() -> None:
            if new.exists() and not old.exists():
                os.replace(new, old)

        return undo

    def delete_note_file(self, parts: Sequence[str]) -> None:
        """Delete exactly one note file: a `.md` file whose parent folder is `notes`."""
        path = self.path_for(parts)
        if path.suffix.lower() != ".md" or path.parent.name != "notes" or path.is_dir():
            raise StoragePathError("Only note files can be deleted")
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _replace_with_retry(src: Path, dst: Path, attempts: int = 5) -> None:
    """os.replace, retrying briefly when Windows reports the target as locked."""
    for i in range(attempts):
        try:
            os.replace(src, dst)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(0.05 * (i + 1))


def _fsync_dir(folder: Path) -> None:
    try:
        fd = os.open(folder, os.O_RDONLY)
    except OSError:  # not supported on every platform/file system
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)
