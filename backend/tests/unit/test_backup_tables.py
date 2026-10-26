"""016 research R4: every table is classified, no included column can hold a key, and the
insert order satisfies every foreign key."""

from __future__ import annotations

import re

import pytest

from unihelper.backup.tables import COLUMN_OVERRIDES, EXCLUDED, INCLUDED, PARENT
from unihelper.models import Base

pytestmark = pytest.mark.unit

# columns whose names look secret but hold no secret
NOT_SECRET = {
    "name_key": "case-insensitive name for uniqueness",
    "file_key": "case-insensitive file name for uniqueness",
    "folder_key": "case-insensitive folder name for uniqueness",
    "recurrence_key": "calendar import recurrence id",
    "event_key": "session key a task is linked to",
    "chat_key": "which chat a draft belongs to",
    "key_colors_json": "a theme's key colours",
    "content_hash": "SHA-256 of a note file",
    "file_hash": "SHA-256 of a chat file",
    "previous_hash": "SHA-256 of a note before a transcription",
    "result_hash": "SHA-256 of a note after a transcription",
}
SECRETISH = re.compile(r"key|secret|token|password|hash")


def test_every_table_is_classified_once() -> None:
    tables = set(Base.metadata.tables)
    included = set(INCLUDED)
    assert not included & set(EXCLUDED)
    assert tables == included | set(EXCLUDED), sorted(tables ^ (included | set(EXCLUDED)))


def test_included_tables_hold_no_secret() -> None:
    for name in INCLUDED:
        overridden = COLUMN_OVERRIDES.get(name, {})
        for column in Base.metadata.tables[name].columns:
            if column.name in overridden or column.name in NOT_SECRET:
                continue
            assert not SECRETISH.search(column.name), f"{name}.{column.name} may hold a secret"
    assert COLUMN_OVERRIDES["provider_configs"] == {"secret": None, "secret_id": None}
    assert COLUMN_OVERRIDES["ai_endpoints"] == {"secret_id": None}


def test_every_included_table_is_found_by_account() -> None:
    for name in INCLUDED:
        table = Base.metadata.tables[name]
        assert "user_id" in table.c or name in PARENT, name
        if name in PARENT:
            column, parent = PARENT[name]
            assert parent in INCLUDED and column in table.c


def test_foreign_keys_point_to_included_tables_in_order() -> None:
    position = {name: i for i, name in enumerate(INCLUDED)}
    for name in INCLUDED:
        for fk in Base.metadata.tables[name].foreign_keys:
            target = fk.column.table.name
            if target == "users":
                continue
            if target == "secrets":  # blanked by COLUMN_OVERRIDES
                assert fk.parent.name in COLUMN_OVERRIDES[name]
                continue
            assert target in position, f"{name}.{fk.parent.name} → {target} is not backed up"
            assert position[target] <= position[name], f"{target} must come before {name}"
