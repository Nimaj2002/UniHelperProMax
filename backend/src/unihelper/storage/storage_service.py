"""The module that touches the file system (Constitution III; research R7). The one other is
`backup_fs.py` (016), for walking, extracting and swapping a whole account folder.

It never deletes folders, and deleting metadata keeps user files (FR-019). Two exceptions:
`delete_content_file` — one confirmed note (`.md` in `notes/`), recording/imported audio (in
`audios/`) or document (a `.pdf` and its `.annotations.json` sidecar in `documents/`) — 002
research N6, 003 research A7, 007; and the import staging files `*.part` in `files/.uploads/`,
which are never user content (006 research I5). Uploaded PDFs are never written after the upload
is committed (Constitution II). 009: `delete_tree` removes one session/event folder — only for
a permanent delete from the Trash after the user answered "Yes" (FR-021d).
"""

from __future__ import annotations

import hashlib
import os
import secrets
import shutil
import stat
import time
from collections.abc import Callable, Sequence
from datetime import timedelta
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from unihelper.domain.naming import safe_name

UPLOADS_DIR = ".uploads"  # staging for imports; usernames can't start with "." (safe_name)
SIDECAR_SUFFIX = ".annotations.json"  # 007: annotations next to the PDF, never inside it
# <user>/<year>/<semester>/<course or _Events>/<session or event folder>
FOLDER_DEPTH = 5
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
    def exists(self, rel_parts: Sequence[str]) -> bool:
        """Whether a file or folder is already there (e.g. one the user made by hand)."""
        return self.path_for(rel_parts).exists()

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

    @staticmethod
    def sidecar_parts(pdf_parts: Sequence[str]) -> list[str]:
        """`…/documents/Name.pdf` → `…/documents/Name.annotations.json`."""
        name = pdf_parts[-1]
        stem = name[: -len(".pdf")] if name.lower().endswith(".pdf") else name
        return [*pdf_parts[:-1], stem + SIDECAR_SUFFIX]

    def rename_pair(self, old_pdf: Sequence[str], new_pdf: Sequence[str]) -> Callable[[], None]:
        """Rename a document's PDF and, when present, its sidecar, together (007 FR-009).
        Never replaces an existing file; returns one undo for both."""
        moves = [(old_pdf, new_pdf), (self.sidecar_parts(old_pdf), self.sidecar_parts(new_pdf))]
        for old, new in moves:
            if self.path_for(old) != self.path_for(new) and self.path_for(new).exists():
                raise FileExistsError(str(self.path_for(new)))
        undos = [self.rename_file(old, new) for old, new in moves]

        def undo() -> None:
            for u in reversed(undos):
                u()

        return undo

    def move_aside(self, parts: Sequence[str], label: str) -> Path | None:
        """Keep a file the app can't use (e.g. a hand-edited sidecar that is no longer valid
        JSON) under a new name next to it: `Name.annotations.<label>.json`. Never deletes or
        replaces anything; returns the new path, or None when the file doesn't exist."""
        path = self.path_for(parts)
        if not path.exists():
            return None
        base = path.name[: -len(".json")] if path.name.endswith(".json") else path.name
        target = path.with_name(f"{base}.{label}.json")
        n = 2
        while target.exists():
            target = path.with_name(f"{base}.{label}-{n}.json")
            n += 1
        _replace_with_retry(path, target)
        _fsync_dir(path.parent)
        return target

    def delete_content_file(self, parts: Sequence[str]) -> None:
        """Delete exactly one note (`.md` in `notes/`), recording/imported audio (an audio
        extension in `audios/`) or document file (`.pdf` or `*.annotations.json` in
        `documents/`). Anything else is refused."""
        path = self.path_for(parts)
        allowed = {"notes": {".md"}, "audios": AUDIO_EXTENSIONS, "documents": {".pdf"}}
        sidecar = path.parent.name == "documents" and path.name.lower().endswith(SIDECAR_SUFFIX)
        if path.is_dir() or not (
            sidecar or path.suffix.lower() in allowed.get(path.parent.name, set())
        ):
            raise StoragePathError("Only note, recording and document files can be deleted")
        try:
            path.unlink()
        except FileNotFoundError:
            pass

    def delete_chat_files(self, chats_parts: Sequence[str], stem: str) -> None:
        """014: remove one chat — `<stem>.json`, `<stem>.md` and its `<stem>.files/` folder —
        from a session's `chats/` folder. Nothing outside that folder, no links."""
        folder = self.path_for(chats_parts)
        if folder.name != "chats" or folder.is_symlink():
            raise StoragePathError("Only files in a chats folder can be deleted")
        for name in (f"{stem}.json", f"{stem}.md"):
            self._check_part(name)
            target = folder / name
            if target.is_symlink() or target.is_file():
                target.unlink(missing_ok=True)
        extra = folder / f"{stem}.files"
        self._check_part(extra.name)
        if extra.is_dir() and not extra.is_symlink() and not _is_junction(extra):
            shutil.rmtree(extra)

    def delete_tree(self, rel_parts: Sequence[str]) -> list[str]:
        """Permanently remove one session or event folder and everything in it (009 Trash →
        Delete → "Yes"). Strict: the path must be exactly at session/event-folder depth inside
        the user's root, made of real directories (a symbolic link or junction anywhere on the
        way is refused, so nothing outside the root is ever reached). The caller only passes
        folders recorded as session/event folders. A missing folder is not an error. Returns the
        paths (relative to the user's root) that could not be removed."""
        if len(rel_parts) != FOLDER_DEPTH:
            raise StoragePathError("Only a session or event folder can be deleted")
        for part in rel_parts:
            self._check_part(part)
        current = self.files_root
        for part in rel_parts:
            current = current / part
            try:
                mode = current.lstat().st_mode
            except FileNotFoundError:
                return []  # already gone (removed outside the app, or a retried purge)
            if stat.S_ISLNK(mode) or _is_junction(current):
                raise StoragePathError("Links are never followed")
        if not stat.S_ISDIR(mode):
            raise StoragePathError("Only a folder can be deleted")
        user_root = (self.files_root / rel_parts[0]).resolve(strict=True)
        target = current.resolve(strict=True)
        if user_root not in target.parents:
            raise StoragePathError("Path escapes the user's folder")
        failed: list[str] = []

        def on_error(_fn: Callable[..., object], path: str, _exc: BaseException) -> None:
            failed.append(Path(path).relative_to(user_root).as_posix())

        shutil.rmtree(current, onexc=on_error)
        return failed

    def remove_empty_dir(self, rel_parts: Sequence[str]) -> bool:
        """Remove a folder only when no file is anywhere inside it (empty sub-folders go with
        it), e.g. folders a creation made that its Undo takes back (009 research R10). Links are
        never followed or removed; a file anywhere keeps the folder. Returns whether it is gone."""
        if len(rel_parts) < 2:  # never a user's root
            raise StoragePathError("Only a folder inside a user's root can be removed")
        path = self.path_for(rel_parts)
        try:
            mode = path.lstat().st_mode
        except FileNotFoundError:
            return True
        if stat.S_ISLNK(mode) or _is_junction(path) or not stat.S_ISDIR(mode):
            return False
        for current, dirs, _files in os.walk(path, topdown=False, followlinks=False):
            for d in dirs:
                sub = Path(current) / d
                if sub.is_symlink() or _is_junction(sub):
                    continue
                try:
                    sub.rmdir()  # fails (and is kept) when anything is inside
                except OSError:
                    pass
        try:
            path.rmdir()
        except OSError:
            return False
        return True

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


def _is_junction(path: Path) -> bool:
    """Windows directory junctions are links too (Path.is_junction, Python ≥ 3.12)."""
    return bool(getattr(path, "is_junction", lambda: False)())


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
