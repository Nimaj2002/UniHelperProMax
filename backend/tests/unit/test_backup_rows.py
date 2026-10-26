"""016 data-model "Data rows": raw SQLite values round-trip through JSON Lines."""

from __future__ import annotations

import io

import pytest

from unihelper.api.errors import ApiError
from unihelper.backup import rows

pytestmark = pytest.mark.unit


def test_every_value_kind_round_trips() -> None:
    row = {
        "text": "Ünïcode — notes",
        "int": 42,
        "real": 3.25,
        "bool": 1,
        "date": "2026-09-28",
        "time": "10:00:00.000000",
        "blob": b"\x00\x01\xffbinary",
        "null": None,
    }
    buf = io.BytesIO()
    assert rows.write_jsonl(buf, [row, row]) == 2
    buf.seek(0)
    assert list(rows.iter_jsonl(buf)) == [row, row]


@pytest.mark.parametrize(
    "line",
    [b"{not json\n", b"[1, 2]\n", b'{"a": {"x": 1}}\n', b'{"a": {"$b64": "!!!"}}\n',
     b'{"a": [1]}\n'],
)
def test_a_bad_line_is_damaged(line: bytes) -> None:
    with pytest.raises(ApiError) as err:
        list(rows.iter_jsonl(io.BytesIO(line)))
    assert err.value.code == "backup_damaged"
