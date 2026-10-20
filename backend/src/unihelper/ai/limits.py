"""Per-style attachment limits (014 research R9; published by GET /ai/styles, FR-055).

The Gemini docs disagree on the inline limit (100 MB vs 20 MB); the conservative 20 MB is used
until it is confirmed. Sizes are checked after base64 encoding, where the providers count."""

from __future__ import annotations

from dataclasses import dataclass, field

MB = 1024 * 1024
MAX_ATTACHMENTS = 10
MAX_UPLOAD = 25 * MB


@dataclass(frozen=True)
class Limits:
    per_file_bytes: dict[str, int]
    per_message_bytes: int
    max_images: int | None = None
    max_pdf_pages: int | None = None
    image_types: tuple[str, ...] = ()
    audio_types: tuple[str, ...] = ()
    max_attachments: int = MAX_ATTACHMENTS
    # Anthropic: 600 PDF pages for models with a context of 1M tokens or more
    max_pdf_pages_large_context: int | None = field(default=None)


IMAGES = ("image/png", "image/jpeg", "image/webp", "image/gif")

LIMITS: dict[str, Limits] = {
    "openai": Limits(
        per_file_bytes={"image": 20 * MB, "pdf": 50 * MB, "audio": 25 * MB},
        per_message_bytes=50 * MB,
        image_types=IMAGES,
        audio_types=("audio/wav", "audio/mpeg"),
    ),
    "anthropic": Limits(
        per_file_bytes={"image": 10 * MB, "pdf": 32 * MB, "audio": 0},  # image: after base64
        per_message_bytes=32 * MB,
        max_images=100,
        max_pdf_pages=100,
        max_pdf_pages_large_context=600,
        image_types=IMAGES,
        audio_types=(),
    ),
    "gemini": Limits(
        per_file_bytes={"image": 20 * MB, "pdf": 20 * MB, "audio": 20 * MB},
        per_message_bytes=20 * MB,
        max_pdf_pages=1000,
        image_types=("image/png", "image/jpeg", "image/webp"),
        audio_types=(
            "audio/wav",
            "audio/mpeg",
            "audio/aiff",
            "audio/aac",
            "audio/ogg",
            "audio/flac",
        ),
    ),
}


def base64_size(raw: int) -> int:
    return 4 * ((raw + 2) // 3)


def human(size: int) -> str:
    return f"{size / MB:.0f} MB" if size >= MB else f"{max(1, size // 1024)} KB"
