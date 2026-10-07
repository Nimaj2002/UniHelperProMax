"""The ONLY module that touches the file system (Constitution III; research R7).

It never deletes folders, and deleting metadata keeps user files (FR-019). Two exceptions:
`delete_content_file` — one confirmed note (`.md` in `notes/`) or recording/imported audio (in
`audios/`) — 002 research N6, 003 research A7; and the import staging files `*.part` in
`files/.uploads/`, which are never user content (006 research I5).
"""

from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import time
from collections.abc import Callable, Sequence
from datetime import timedelta
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from unihelper.domain.naming import safe_name

UPLOADS_DIR = ".uploads"  # staging for imports; usernames can't start with "." (safe_name)
AUDIO_EXTENSIONS = {".webm", ".m4a", ".mp3", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac"}


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

    def append_bytes(self, parts: Sequence[str], data: bytes) -> int:
        """Append and fsync (progressive recording, Constitution I). Returns the new size."""
        path = self.path_for(parts)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "ab") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
            return fh.tell()

    def replace_bytes_atomic(self, parts: Sequence[str], data: bytes) -> None:
        path = self.path_for(parts)
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

    def absolute_path(self, parts: Sequence[str]) -> Path:
        return self.path_for(parts)

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

    def delete_content_file(self, parts: Sequence[str]) -> None:
        """Delete exactly one note (`.md` in `notes/`) or recording/imported audio (an audio
        extension in `audios/`). Anything else is refused."""
        path = self.path_for(parts)
        allowed = {"notes": {".md"}, "audios": AUDIO_EXTENSIONS}
        if path.is_dir() or path.suffix.lower() not in allowed.get(path.parent.name, set()):
            raise StoragePathError("Only note and recording files can be deleted")
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    # ---- import staging (feature 006) --------------------------------------------------
    @property
    def uploads_dir(self) -> Path:
        return self.files_root / UPLOADS_DIR

    def open_upload(self) -> tuple[Path, BinaryIO]:
        """A new, empty staging file outside every user folder: a half-written import never
        appears in a session's `audios/` (006 FR-024)."""
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        path = self.uploads_dir / f"{secrets.token_hex(16)}.part"
        return path, open(path, "xb")  # the caller streams into it and closes it

    def _check_staged(self, path: Path) -> Path:
        resolved = path.resolve()
        if resolved.parent != self.uploads_dir.resolve() or resolved.suffix != ".part":
            raise StoragePathError("Only import staging files can be discarded")
        return resolved

    def discard_upload(self, path: Path) -> None:
        try:
            self._check_staged(path).unlink()
        except FileNotFoundError:
            pass

    def commit_upload(self, path: Path, parts: Sequence[str]) -> Callable[[], None]:
        """Move a complete staging file to `parts` (same file system: an atomic rename). Never
        replaces an existing file. Returns an undo that takes it back out and discards it."""
        staged = self._check_staged(path)
        target = self.path_for(parts)
        with open(staged, "rb") as fh:
            os.fsync(fh.fileno())
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise FileExistsError(str(target))
        _replace_with_retry(staged, target)
        _fsync_dir(target.parent)

        def undo() -> None:
            if target.exists() and not staged.exists():
                os.replace(target, staged)
                self.discard_upload(staged)

        return undo

    def sweep_uploads(self, older_than: timedelta) -> int:
        """Delete staging files left by an interrupted server. Returns how many."""
        if not self.uploads_dir.is_dir():
            return 0
        cutoff = time.time() - older_than.total_seconds()
        removed = 0
        for p in self.uploads_dir.glob("*.part"):
            try:
                if p.is_file() and p.stat().st_mtime < cutoff:
                    p.unlink()
                    removed += 1
            except FileNotFoundError:
                pass
        return removed

    def free_bytes(self) -> int:
        return shutil.disk_usage(self.files_root).free


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
