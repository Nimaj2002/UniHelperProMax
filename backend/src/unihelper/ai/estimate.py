"""Advisory token estimates (014 research R10, FR-056): text is characters ÷ 4, a picture 1,600
tokens, a PDF page 1,500 (Anthropic) or 258 (Gemini) tokens — or its text ÷ 4 when sent as
text — and audio 32 tokens a second. The provider's own "too long" error is still classified
and shown; these numbers only warn before sending."""

from __future__ import annotations

from unihelper.ai.base import Audio, ChatRequest, Image, Pdf, text_of

IMAGE = 1600
PDF_BYTES_PER_PAGE = 50_000
PDF_PAGE = 1500
AUDIO_BYTES_PER_TOKEN = 500  # ~32 tokens a second at 128 kbit/s


def text_tokens(text: str) -> int:
    return len(text) // 4


def request_tokens(request: ChatRequest) -> int:
    total = text_tokens(request.system or "")
    for message in request.messages:
        for part in message.parts:
            text = text_of(part)
            if text is not None:
                total += text_tokens(text)
            elif isinstance(part, Image):
                total += IMAGE
            elif isinstance(part, Pdf):
                total += max(1, len(part.data) // PDF_BYTES_PER_PAGE) * PDF_PAGE
            elif isinstance(part, Audio):
                total += len(part.data) // AUDIO_BYTES_PER_TOKEN
    return total
