"""Startup: finish or undo a restore the app stopped in the middle of, and clear leftovers
(research R7 step 5, R12). Runs right after the schema upgrade, before any request."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path

from unihelper.backup.restore import current_epoch
from unihelper.config import Settings
from unihelper.storage import backup_fs

log = logging.getLogger("unihelper.backup")


def recover_restores(settings: Settings) -> None:
    backups = settings.backups_dir
    if backups.is_dir():
        for journal in sorted(backups.glob("restore-*.journal.json")):
            try:
                _recover_one(settings, journal)
            except Exception:
                log.exception("could not recover an interrupted restore (%s)", journal.name)
                continue
        for scratch in backups.glob("restore-*.sqlite3*"):
            backup_fs.remove_file(scratch)
    root = settings.files_root
    if root.is_dir():
        for leftover in root.glob(f"{backup_fs.RESTORE_PREFIX}*"):
            if leftover.is_dir() and not _named_by_journal(settings, leftover):
                backup_fs.remove_tree(leftover)


def _named_by_journal(settings: Settings, folder: Path) -> bool:
    for journal in settings.backups_dir.glob("restore-*.journal.json"):
        try:
            data = json.loads(journal.read_bytes())
        except (OSError, ValueError):
            continue
        if str(folder) in (data.get("stagingDir"), data.get("oldDir")):
            return True
    return False


def _recover_one(settings: Settings, journal: Path) -> None:
    data = json.loads(journal.read_bytes())
    if data.get("phase") == "swapping":
        account = Path(data["accountDir"])
        staging = Path(data["stagingDir"])
        old = Path(data["oldDir"])
        if current_epoch(settings, data["userId"]) == data["epochBefore"]:
            # the rows were never replaced: put the old folder back
            backup_fs.unswap_dirs(account, staging, old)
            log.warning("restore %s was interrupted; the previous data was kept", data["jobId"])
        else:
            log.warning("restore %s was interrupted after it was saved; finishing", data["jobId"])
        for d in (staging, old):
            if d.exists():
                backup_fs.remove_tree(d)
    backup_fs.remove_file(journal)


def sweep_exports(settings: Settings) -> None:
    """Finished backups waiting for download don't survive a restart (their jobs don't)."""
    shutil.rmtree(settings.exports_dir, ignore_errors=True)
