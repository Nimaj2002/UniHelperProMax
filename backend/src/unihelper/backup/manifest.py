"""`manifest.json`: what a backup is and what it holds (data-model.md "Backup manifest")."""

from __future__ import annotations

from functools import cache
from typing import Literal

from alembic.script import ScriptDirectory
from pydantic import Field

from unihelper.db.migrate import alembic_config
from unihelper.schemas.common import ApiModel

KIND = "unihelper-backup"
FORMAT_VERSION = 1
MANIFEST = "manifest.json"
README = "README.txt"
DATA_PREFIX = "data/"
FILES_PREFIX = "files/"

COUNT_KEYS = (
    "semesters",
    "courses",
    "sessions",
    "events",
    "notes",
    "recordings",
    "documents",
    "chats",
    "tasks",
    "themes",
    "files",
    "bytes",
)

README_TEXT = """UniHelperProMax backup
======================

This zip holds one account's data from UniHelperProMax:

  files/      your notes (.md), recordings, documents, annotations and chats, in the same
              folders the app uses (<year>/<semester>/<course>/<class date>/...); general
              notes not tied to a class are in General Notes/
  data/       your classes, events, tasks, settings and themes, one JSON object per line
  manifest.json   when and with which version this backup was made, and a checksum of
                  every file, so the app can tell a damaged backup

API keys are never included: after a restore, enter them again in Settings.

To restore: open UniHelperProMax, go to Settings -> Backup & restore -> Restore from backup,
and choose this file. Restoring replaces all of the account's current data; a safety backup
of the current data is made first.

Don't change files inside this zip: the app refuses a backup whose contents changed.
"""


class Entry(ApiModel):
    path: str
    size: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class KeyLeftOut(ApiModel):
    kind: Literal["transcription_provider", "ai_endpoint", "proxy"]
    id: str
    name: str


class Excluded(ApiModel):
    reason: Literal["recording_in_progress"]
    name: str


class Account(ApiModel):
    timezone: str


class Manifest(ApiModel):
    kind: Literal["unihelper-backup"]
    format_version: int
    app_version: str
    schema_revision: str
    created_at: str
    source: Literal["web", "desktop"]
    account: Account
    counts: dict[str, int]
    keys_left_out: list[KeyLeftOut] = []
    excluded: list[Excluded] = []
    entries: list[Entry]

    def to_json(self) -> bytes:
        return self.model_dump_json(by_alias=True, indent=2).encode()


@cache
def known_revisions() -> tuple[str, ...]:
    """This app's Alembic revisions, oldest first."""
    script = ScriptDirectory.from_config(alembic_config("sqlite://"))
    revs = [r.revision for r in script.walk_revisions()]
    return tuple(reversed(revs))


def head_revision() -> str:
    return known_revisions()[-1]
