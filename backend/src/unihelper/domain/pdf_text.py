"""Text of a PDF for models without PDF support (014 research R9, FR-053).

`pypdf`, pure Python, within a page and time limit. A PDF whose pages yield fewer than 20
characters on average counts as having no text (for example a scan), so the app can say so
instead of sending an empty document."""

from __future__ import annotations

import io
import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger("unihelper.chat")

MAX_PAGES = 2000
TIMEOUT_S = 20.0
MIN_CHARS_PER_PAGE = 20


@dataclass(frozen=True)
class PdfText:
    text: str = field(repr=False)
    pages: int
    has_text: bool
    encrypted: bool = False
    truncated: bool = False  # the page or time limit was reached


def extract(data: bytes, max_pages: int = MAX_PAGES, timeout_s: float = TIMEOUT_S) -> PdfText:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            return PdfText("", 0, False, encrypted=True)
        pages = len(reader.pages)
    except (PdfReadError, ValueError, OSError) as exc:
        log.info("pdf text: unreadable (%s)", type(exc).__name__)
        return PdfText("", 0, False)
    started = time.monotonic()
    parts: list[str] = []
    truncated = False
    for index, page in enumerate(reader.pages):
        if index >= max_pages or time.monotonic() - started > timeout_s:
            truncated = True
            break
        try:
            parts.append(page.extract_text() or "")
        except Exception as exc:  # one damaged page doesn't lose the others
            log.info("pdf text: page failed (%s)", type(exc).__name__)
            parts.append("")
    text = "\n\n".join(p.strip() for p in parts).strip()
    has_text = pages > 0 and len(text) / max(1, len(parts)) >= MIN_CHARS_PER_PAGE
    return PdfText(text, pages, has_text, truncated=truncated)
