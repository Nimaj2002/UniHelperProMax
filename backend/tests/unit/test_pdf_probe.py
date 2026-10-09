"""pdf_probe recognises PDFs from header and trailer (T007)."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests import pdf_fixtures as fx
from unihelper.domain.pdf_probe import probe_pdf

pytestmark = pytest.mark.unit


def _file(tmp_path: Path, data: bytes) -> Path:
    path = tmp_path / "x.pdf"
    path.write_bytes(data)
    return path


@pytest.mark.parametrize(
    "data", [fx.text_pdf(3), fx.image_only_pdf(2), fx.annotated_pdf(), fx.linked_pdf()]
)
def test_valid_pdfs(tmp_path: Path, data: bytes) -> None:
    assert probe_pdf(_file(tmp_path, data)) is not None
    assert probe_pdf(_file(tmp_path, data)).encrypted is False  # type: ignore[union-attr]


def test_encrypted_pdf_is_flagged(tmp_path: Path) -> None:
    result = probe_pdf(_file(tmp_path, fx.encrypted_pdf()))
    assert result is not None and result.encrypted is True


def test_pdf_with_leading_junk_and_trailing_newlines(tmp_path: Path) -> None:
    assert probe_pdf(_file(tmp_path, b"\n\n" + fx.text_pdf(1) + b"\r\n\r\n")) is not None


@pytest.mark.parametrize(
    "data",
    [
        fx.truncated(fx.text_pdf(3)),
        fx.fake_pdf(),
        b"\x89PNG\r\n\x1a\n" + bytes(4096),  # an image renamed .pdf
        b"",
        bytes(5000) + b"%PDF-1.7\n" + bytes(100) + b"%%EOF",  # header too far into the file
    ],
    ids=["truncated", "no-trailer", "png", "empty", "late-header"],
)
def test_not_a_pdf(tmp_path: Path, data: bytes) -> None:
    assert probe_pdf(_file(tmp_path, data)) is None


def test_missing_file(tmp_path: Path) -> None:
    assert probe_pdf(tmp_path / "nope.pdf") is None
