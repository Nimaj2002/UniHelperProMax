"""016: full backup and restore of one account's data (specs/016-data-backup-restore/research.md).

A backup is a zip: `manifest.json`, `README.txt`, `data/<table>.jsonl` (the account's rows) and
`files/…` (the account folder, same relative paths). Restore validates first, makes a safety
backup, upgrades the rows in a scratch database, then swaps the folder and the rows in one step.
"""
