"""The ONLY module that touches the file system (Constitution III; research R7).

It never deletes anything: deleting metadata keeps user folders and files (FR-019).
"""

from __future__ import annotations

import os
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
