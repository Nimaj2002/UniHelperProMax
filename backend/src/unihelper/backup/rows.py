"""Rows as JSON Lines (data-model.md "Data rows").

Values are SQLite's own storage values — text, integer, real, NULL, or a BLOB written as
`{"$b64": "..."}` — so a row round-trips exactly whatever the column's declared type (dates and
times are already ISO text in SQLite, booleans 0/1).
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterable, Iterator
from typing import IO, Any

from unihelper.backup import errors

B64 = "$b64"


def encode_value(value: Any) -> Any:
    if isinstance(value, bytes | bytearray | memoryview):
        return {B64: base64.b64encode(bytes(value)).decode("ascii")}
    return value


def decode_value(value: Any) -> Any:
    if isinstance(value, dict):
        if set(value) != {B64} or not isinstance(value[B64], str):
            raise errors.backup_damaged("A data row has a value of an unknown kind.")
        try:
            return base64.b64decode(value[B64], validate=True)
        except ValueError as exc:
            raise errors.backup_damaged("A data row has a damaged binary value.") from exc
    if isinstance(value, list):
        raise errors.backup_damaged("A data row has a value of an unknown kind.")
    return value


def encode_row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: encode_value(v) for k, v in row.items()}


def decode_row(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict) or not all(isinstance(k, str) for k in obj):
        raise errors.backup_damaged("A data row isn't an object.")
    return {k: decode_value(v) for k, v in obj.items()}


def dumps_row(row: dict[str, Any]) -> bytes:
    return (json.dumps(encode_row(row), ensure_ascii=False, separators=(",", ":")) + "\n").encode()


def write_jsonl(fh: IO[bytes], rows: Iterable[dict[str, Any]]) -> int:
    n = 0
    for row in rows:
        fh.write(dumps_row(row))
        n += 1
    return n


def iter_jsonl(fh: IO[bytes]) -> Iterator[dict[str, Any]]:
    for raw in fh:
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (ValueError, UnicodeDecodeError) as exc:
            raise errors.backup_damaged("A data file has a damaged line.") from exc
        yield decode_row(obj)
