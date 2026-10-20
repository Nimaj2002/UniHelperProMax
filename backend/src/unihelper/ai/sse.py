"""Incremental server-sent events parser shared by the three styles (014 T034).

Follows the HTML event-stream rules that matter here: `event:` and `data:` fields (several
`data:` lines join with newlines), comments (`:`), `\\r\\n` line ends, and a last event without
the closing blank line."""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass(frozen=True)
class SseEvent:
    event: str
    data: str


async def parse(lines: AsyncIterator[str]) -> AsyncIterator[SseEvent]:
    event = ""
    data: list[str] = []
    async for raw in lines:
        line = raw.rstrip("\r\n")
        if line == "":
            if data:
                yield SseEvent(event or "message", "\n".join(data))
            event, data = "", []
            continue
        if line.startswith(":"):
            continue
        name, _, value = line.partition(":")
        value = value.removeprefix(" ")
        if name == "event":
            event = value
        elif name == "data":
            data.append(value)
    if data:
        yield SseEvent(event or "message", "\n".join(data))
