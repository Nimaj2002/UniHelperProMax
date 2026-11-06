"""Idea names compared for merging (022 research R9). Pure."""

from __future__ import annotations

import re
import unicodedata

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)


def normalize(name: str) -> str:
    """Casefold, strip punctuation, collapse spaces: "Chain-rule!" and "chain rule" match."""
    text = unicodedata.normalize("NFKC", name).casefold().replace("-", " ").replace("_", " ")
    return " ".join(_PUNCT.sub("", text).split())[:120]
