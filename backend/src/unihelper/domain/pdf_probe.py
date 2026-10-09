"""Recognise an uploaded PDF from its header and trailer only (007 research R10).

No dependency and no full read: uploads can be 200 MB. This rejects renamed and truncated files;
damage inside an otherwise valid PDF shows up in the reader, page by page.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

HEAD = 1024
TAIL = 2048
TRAILER_REGION = 65536


@dataclass(frozen=True)
class PdfProbe:
    encrypted: bool  # trailer names an /Encrypt dictionary (password-protected, FR-021)


def probe_pdf(path: Path) -> PdfProbe | None:
    """`None` when the file isn't recognisable as a PDF."""
    try:
        size = path.stat().st_size
        if size < 16:
            return None
        with open(path, "rb") as f:
            head = f.read(HEAD)
            f.seek(max(0, size - TRAILER_REGION))
            trailer = f.read()
    except OSError:
        return None
    if b"%PDF-1." not in head and b"%PDF-2." not in head:
        return None
    if b"%%EOF" not in trailer[-TAIL:]:
        return None
    return PdfProbe(encrypted=b"/Encrypt" in trailer)
