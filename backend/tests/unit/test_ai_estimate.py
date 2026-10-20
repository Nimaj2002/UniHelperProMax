"""014 T117: the advisory token estimate of a request."""

from __future__ import annotations

import pytest

from unihelper.ai.base import Audio, ChatRequest, Image, NeutralMessage, NoteText, Pdf, Text
from unihelper.ai.estimate import IMAGE, PDF_PAGE, request_tokens, text_tokens

pytestmark = pytest.mark.unit


def test_estimates() -> None:
    assert text_tokens("x" * 400) == 100
    req = ChatRequest(
        "m",
        [
            NeutralMessage(
                "user",
                [
                    Text("x" * 400),
                    Image("image/png", b"p"),
                    Pdf("a.pdf", b"x" * 150_000),
                    Audio("audio/wav", "wav", b"a" * 16_000),
                    NoteText("N", "y" * 80),
                ],
            )
        ],
        system="z" * 40,
    )
    note = len("--- Note: N ---\n" + "y" * 80) // 4
    assert request_tokens(req) == 10 + 100 + IMAGE + 3 * PDF_PAGE + 32 + note
