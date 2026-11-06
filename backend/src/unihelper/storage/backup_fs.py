"""016: the backup feature's file-system operations (the second module allowed to touch files,
next to storage_service.py).

Walking an account folder, checking archive names, extracting below a staging folder, and the
two renames that swap a restored account folder in (research R5, R7, R9, R10).
"""

from __future__ import annotations

import os
import re
import shutil
import sys
from collections.abc import Iterator
from pathlib import Path, PurePosixPath

from unihelper.backup import errors
from unihelper.storage.storage_service import _fsync_dir, _replace_with_retry

FREE_SPACE_MARGIN = 64 * 1024 * 1024  # same as api/uploads.py
RESTORE_PREFIX = ".restore-"

_TEMP = re.compile(r"^\..+\.tmp-[0-9a-f]+$")  # storage_service atomic-write temp files
_WIN_FORBIDDEN = re.compile(r'[<>:"|?*\x00-\x1f]')
_WIN_RESERVED = (
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


# ---- walking -------------------------------------------------------------------------------


def _skipped(name: str) -> bool:
    return bool(_TEMP.match(name)) or name.endswith(".part")


def walk_account(
    user_root: Path, skip: frozenset[Path] = frozenset()
) -> Iterator[tuple[str, Path, int]]:
    """Every regular file under the account folder as (posix relative path, path, size), sorted.
    Links are neither followed nor included; temp and partial files are skipped."""
    if not user_root.is_dir():
        return
    stack = [user_root]
    found: list[tuple[str, Path, int]] = []
    while stack:
        folder = stack.pop()
        try:
            entries = list(os.scandir(folder))
        except FileNotFoundError:
            continue
        for e in entries:
            if e.is_symlink():
                continue
            path = Path(e.path)
            if e.is_dir(follow_symlinks=False):
                if not bool(getattr(path, "is_junction", lambda: False)()):
                    stack.append(path)
            elif e.is_file(follow_symlinks=False) and not _skipped(e.name) and path not in skip:
                rel = path.relative_to(user_root).as_posix()
                found.append((rel, path, e.stat(follow_symlinks=False).st_size))
    found.sort(key=lambda f: f[0])
    yield from found


def tree_size(root: Path) -> int:
    return sum(size for _rel, _p, size in walk_account(root))


# ---- free space ----------------------------------------------------------------------------


def free_bytes(path: Path) -> int:
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return shutil.disk_usage(probe).free


def check_space(path: Path, needed: int, where: str | None = None) -> None:
    free = free_bytes(path)
    if free < needed + FREE_SPACE_MARGIN:
        raise errors.insufficient_storage(needed + FREE_SPACE_MARGIN, free, where)


# ---- archive names (R9) --------------------------------------------------------------------


def unsafe_reason(name: str) -> str | None:
    """Why a zip entry name can't be used anywhere, or None."""
    if not name or "\x00" in name or "\\" in name:
        return "invalid character"
    if name.startswith("/") or re.match(r"^[A-Za-z]:", name) or name.startswith("//"):
        return "absolute path"
    parts = PurePosixPath(name).parts
    if any(p in ("..", ".") for p in name.split("/")) or not parts:
        return "parent folder"
    if name.endswith("/"):
        return "folder entry"
    return None


def invalid_here(rel: str, windows: bool | None = None) -> bool:
    """True when a relative path can't be created on this operating system."""
    if windows is None:
        windows = sys.platform == "win32"
    if not windows:
        return False
    for part in rel.split("/"):
        if _WIN_FORBIDDEN.search(part) or part.endswith((" ", ".")):
            return True
        stem = part.split(".", 1)[0].upper()
        if stem in _WIN_RESERVED:
            return True
    return False


def safe_extract_target(staging_root: Path, rel: str) -> Path:
    """The path `rel` extracts to; refuses anything that would land outside `staging_root`."""
    if unsafe_reason(rel) is not None:
        raise errors.backup_unsafe([rel])
    root = staging_root.resolve()
    target = (root / rel).resolve()
    if root not in target.parents:
        raise errors.backup_unsafe([rel])
    return target


# ---- swapping the account folder (R7) ------------------------------------------------------


def _replace(src: Path, dst: Path) -> None:
    try:
        _replace_with_retry(src, dst)
    except PermissionError as exc:
        raise errors.files_in_use(str(exc.filename or src)) from exc


def swap_dirs(account_dir: Path, staging_dir: Path, old_dir: Path) -> None:
    """account → old, staging → account. An account folder that doesn't exist yet is fine."""
    if account_dir.exists():
        _replace(account_dir, old_dir)
    try:
        _replace(staging_dir, account_dir)
    except BaseException:
        if old_dir.exists() and not account_dir.exists():
            _replace(old_dir, account_dir)
        raise
    _fsync_dir(account_dir.parent)


def unswap_dirs(account_dir: Path, staging_dir: Path, old_dir: Path) -> None:
    """Undo `swap_dirs` (as far as it got)."""
    if old_dir.exists():
        if account_dir.exists():
            _replace(account_dir, staging_dir)
        _replace(old_dir, account_dir)
        _fsync_dir(account_dir.parent)


def remove_tree(path: Path) -> None:
    """Delete one of the feature's own `.restore-*` working folders."""
    if not path.name.startswith(RESTORE_PREFIX):
        raise ValueError(f"not a restore working folder: {path}")
    shutil.rmtree(path, ignore_errors=True)


def remove_file(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


def write_json_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    _replace_with_retry(tmp, path)
    _fsync_dir(path.parent)
