"""The transcript section appended to a note (004 FR-007, research B7). Pure functions."""

from __future__ import annotations

from datetime import datetime

NO_SPEECH = "(No speech detected)"


def format_duration(ms: int) -> str:
    """`42s`, `12m 05s`, `1h 24m`."""
    seconds = max(0, round(ms / 1000))
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours}h {minutes:02d}m"
    if minutes:
        return f"{minutes}m {secs:02d}s"
    return f"{secs}s"


def heading(recording_name: str, started_local: datetime, duration_ms: int) -> str:
    when = started_local.strftime("%Y-%m-%d %H:%M")
    return f"## Transcript — {recording_name} · {when} · {format_duration(duration_ms)}"


def separator_for(existing: bytes) -> str:
    """Blank line before the heading when needed; the existing last character is never changed."""
    if not existing or existing.endswith(b"\n\n"):
        return ""
    if existing.endswith(b"\n"):
        return "\n"
    return "\n\n"


def section(head: str, part_texts: list[str]) -> str:
    texts = [t.strip() for t in part_texts if t and t.strip()]
    body = "\n\n".join(texts) if texts else NO_SPEECH
    return f"{head}\n\n{body}\n"
