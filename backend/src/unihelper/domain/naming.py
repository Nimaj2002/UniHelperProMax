"""Human-readable, cross-platform safe names (contracts/storage-layout.md)."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from datetime import date, time

MAX_NAME_LEN = 80
_FORBIDDEN = re.compile(r'[/\\:*?"<>|\x00-\x1f\x7f]')
_WS = re.compile(r"[ \t\n\r\f\v\u00a0]+")
_RESERVED = (
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)


def normalize_display(name: str) -> str:
    """NFC + collapsed whitespace + trimmed; used for display names and name keys."""
    return _WS.sub(" ", unicodedata.normalize("NFC", name)).strip()


def name_key(name: str) -> str:
    """Case-insensitive uniqueness key: casefold(nfc(trim(name)))."""
    return normalize_display(name).casefold()


def _split_ext(name: str) -> tuple[str, str]:
    dot = name.rfind(".")
    if dot <= 0:
        return name, ""
    return name[:dot], name[dot:]


def safe_name(display_name: str) -> str:
    s = normalize_display(display_name)
    s = _FORBIDDEN.sub("-", s)
    s = s.strip(" .")
    stem, _ext = _split_ext(s)
    if stem.upper() in _RESERVED:
        s = s[: len(stem)] + "_" + s[len(stem) :]
    if len(s) > MAX_NAME_LEN:
        s = s[:MAX_NAME_LEN].rstrip(" .")
    return s or "Untitled"


def unique_sibling(name: str, existing: Iterable[str]) -> str:
    """Append ' (2)', ' (3)'… (before any extension) until no case-insensitive clash."""
    taken = {e.casefold() for e in existing}
    if name.casefold() not in taken:
        return name
    stem, ext = _split_ext(name)
    n = 2
    while True:
        candidate = f"{stem} ({n}){ext}"
        if candidate.casefold() not in taken:
            return candidate
        n += 1


def class_date_folder_name(day: date, start: time, existing: Iterable[str]) -> str:
    """Folder name for a session's dated folder (assigned once by feature 002)."""
    taken = list(existing)
    plain = day.isoformat()
    if plain.casefold() not in {t.casefold() for t in taken}:
        return plain
    return unique_sibling(f"{plain} {start.strftime('%H%M')}", taken)
