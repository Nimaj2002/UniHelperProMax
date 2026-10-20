"""014 T108: PDF text for models without PDF support; scans and encrypted PDFs are recognised."""

from __future__ import annotations

import pytest

from tests.pdf_fixtures import encrypted_pdf, image_only_pdf, text_pdf
from unihelper.domain.pdf_text import extract

pytestmark = pytest.mark.unit


def test_text_pdf() -> None:
    result = extract(text_pdf(pages=3))
    assert result.pages == 3 and result.has_text and "red-black tree" in result.text


def test_scan_has_no_text() -> None:
    result = extract(image_only_pdf())
    assert result.pages == 2 and not result.has_text


def test_encrypted() -> None:
    assert extract(encrypted_pdf()).encrypted


def test_page_limit_and_garbage() -> None:
    limited = extract(text_pdf(pages=5), max_pages=2)
    assert limited.truncated and limited.text.count("page") == 2
    assert extract(b"not a pdf").has_text is False
