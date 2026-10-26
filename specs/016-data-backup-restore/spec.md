# Feature Specification: Full Data Backup and Restore

**Feature Branch**: `016-data-backup-restore`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "add a feature in setting : backup/restore full data. it puts everything inside a zip file gives to the user. and user can upload the zip backup file to restore. include all the info and data and files in backup"

**Related**: Feature 001 (classes, semesters, sessions), Feature 002 (notes and autosave),
Feature 003 (recordings and progressive persistence), Feature 005 (Settings, provider keys,
themes), Feature 006/007 (documents and annotations), Feature 009/010 (calendar events),
Feature 012 (tasks), Feature 013 (note diagrams and math), Feature 014 (AI chats and AI
endpoints), Feature 015 (desktop data folder and database backup before upgrades).
Constitution Principles I, II, IV and VIII.

## Clarifications

### Session 2026-10-26

- Q: When a student makes a backup, what should happen to their saved provider and AI endpoint API keys? → A: Leave keys out of the backup entirely; after a restore, providers show "not configured" and the student enters the keys again (FR-016).
- Q: The app makes an automatic safety backup of the current data before every restore. How many of these safety backups should it keep? → A: Only the newest one; each new restore replaces the previous safety backup (FR-014).
- Q: Should a backup include files the student put in the data folder by hand, and should a restore remove them? → A: Include every file under the student's data folder, known to the app or not; restore makes the folder match the backup exactly, so hand-added files not in the backup are removed (they remain in the safety backup) (FR-002a, FR-013).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Download a full backup (Priority: P1)

A student opens Settings, goes to a "Backup & restore" section and chooses "Create backup". The
app gathers everything the student has in the app — semesters, classes, sessions, events,
tasks, calendar entries, notes, recordings, documents, annotations, AI chats and their
attachments, settings and themes — into one zip file and hands it to the student to save
(a download in the browser, a save dialog in the desktop app). The file name includes the app
name and the date and time, for example `UniHelperProMax-backup-2026-10-26-1430.zip`.

**Why this priority**: A backup that exists is valuable on its own — the student can keep it
on another drive or cloud storage — even before restore exists in the app, because the zip
holds the student's files in their normal, browsable folder layout.

**Independent Test**: With a data set containing at least one of every kind of item, create a
backup, open the zip with an ordinary archive tool, and confirm every note, recording,
document, annotation and chat is present in the usual folder layout and a description of the
backup (app version, date, item counts) is included.

**Acceptance Scenarios**:

1. **Given** a student with classes, notes, recordings, documents, annotations, chats, events,
   tasks and custom themes, **When** they choose "Create backup", **Then** they receive a single
   zip file containing all of it.
2. **Given** the backup is being prepared, **When** it takes more than a moment, **Then** the
   student sees progress and can cancel; cancelling leaves no partial file behind.
3. **Given** a finished backup, **When** the student opens the zip outside the app, **Then**
   notes are readable `.md` files, recordings play, and documents open, in the same
   `<year>/<semester>/<course>/<class-date>/…` layout the app uses.
4. **Given** a recording is in progress, **When** the student chooses "Create backup", **Then**
   the app tells them the recording in progress will not be included (or asks them to stop it
   first) and never interrupts the recording.

---

### User Story 2 - Restore from a backup file (Priority: P1)

The student, on a new computer or after losing their data, opens Settings → "Backup &
restore", chooses "Restore from backup" and selects a backup zip. The app checks the file,
shows what it contains (date it was made, app version, number of classes, notes, recordings,
documents and chats) and explains what restoring will do to the current data. After the
student confirms, the app restores everything and the student sees their classes, notes,
recordings, documents, chats, tasks, events, settings and themes exactly as they were when the
backup was made.

**Why this priority**: Restore is what makes the backup useful inside the app; together with
Story 1 it is the complete feature.

**Independent Test**: Create a backup, then on a fresh installation (empty data) restore it,
and confirm every item and every file matches the original byte-for-byte and every note,
recording, document and chat opens in the app.

**Acceptance Scenarios**:

1. **Given** a valid backup file, **When** the student selects it, **Then** the app shows a
   summary of its contents and a clear description of the effect on current data before
   anything is changed.
2. **Given** the student confirms, **When** the restore finishes, **Then** all items and files
   from the backup are present and open correctly, and the student is told the restore
   succeeded.
3. **Given** the student has existing data, **When** they confirm a restore, **Then** the app
   first makes an automatic safety backup of the current data and tells the student where it
   is, so the restore can be undone.
4. **Given** a file that is not a backup made by this app, is damaged, or is incomplete, **When**
   the student selects it, **Then** the app refuses it with a clear message and changes nothing.
5. **Given** a restore fails part-way (for example, the disk fills up), **When** the failure
   happens, **Then** the student's data is returned to exactly its state before the restore and
   the student is told what went wrong.

---

### User Story 3 - Restore a backup from an older app version (Priority: P2)

The student made a backup months ago with an earlier version of the app and restores it into
the current version. The app accepts it, upgrades the restored data to the current version and
everything opens normally.

**Why this priority**: Backups are kept for a long time; a backup that only works with the
exact version that made it is of little value.

**Independent Test**: Restore a backup made by the previous released version into the current
version and confirm all data opens; try to restore a backup made by a newer version and
confirm it is refused with an explanation.

**Acceptance Scenarios**:

1. **Given** a backup from an older version of the app, **When** it is restored, **Then** the
   data is upgraded to the current version and all items open.
2. **Given** a backup from a newer version than the installed app, **When** the student selects
   it, **Then** the app refuses it and tells the student to update the app first.

---

### Edge Cases

- **Very large data (many hours of audio)**: backup and restore work for data sets of several
  gigabytes without running out of memory and show progress throughout; the app warns before
  starting if there is not enough free disk space for the operation.
- **Activity during backup**: notes edited while a backup is being made are either included in
  their saved state at the moment the backup started or in a later saved state; a backup never
  contains a half-written file.
- **Activity during restore**: while a restore runs, the student cannot edit, record, import or
  chat; other open windows or tabs are told the data was replaced and reload.
- **Recording in progress or unsent audio held on the device** (Feature 003): restore is blocked
  until the recording is stopped and pending audio has been saved, so no audio is lost.
- **Transcription or AI chat answer running**: restore is blocked until it finishes or the
  student stops it.
- **Files the student added to the data folder by hand**: included in the backup (FR-002a);
  on restore, any not in the backup are removed and kept only in the safety backup (FR-013).
- **Zip with unsafe paths** (entries pointing outside the data folder, links, absolute paths):
  refused; nothing outside the app's data folder is ever written.
- **Zip edited by hand** (files added, removed or changed after the backup was made): detected by
  the backup's own checks and refused, with a message saying the file was modified or damaged.
- **Backup made on another operating system or with a different account name**: restored into
  the current installation's data folder and account folder; file names that are not valid on
  the current system are reported rather than silently dropped.
- **Backup made by the web (self-hosted) version restored in the desktop app, or the other way
  round**: allowed; data is placed under the current installation's account folder.
- **Provider API keys**: never in a backup (FR-016); after a restore, providers and AI endpoints
  that need a key show as "not configured" rather than failing, and transcription or AI chat
  asks the student to enter the key.
- **Student closes the app or the tab during a backup**: the partial file is discarded; data is
  unaffected.
- **Student closes the app during a restore**: on next start the app detects the unfinished
  restore and returns the data to its state before the restore.

## Requirements *(mandatory)*

### Functional Requirements

#### Location

- **FR-001**: Settings MUST include a "Backup & restore" section offering "Create backup" and
  "Restore from backup", reachable and operable by keyboard and correct in every theme.

#### Backup contents

- **FR-002**: A backup MUST contain all of the student's app data: semesters, courses, class
  sessions, events, recurring schedules, calendar entries, tasks, note files, recordings,
  uploaded documents, annotation files, AI chat files and chat attachments, app settings
  (including provider and AI endpoint configuration), and custom themes.
- **FR-002a**: A backup MUST include every file and folder under the student's data folder
  (`<data folder>/<account name>/`), whether or not the app tracks it, including files the
  student added with ordinary file tools, at their same relative paths. Only the exclusions
  listed in Assumptions (logs, temporary caches, pre-upgrade database backups, the safety
  backup) and files of a recording still in progress are left out.
- **FR-003**: Files in the backup MUST keep the app's normal human-readable folder layout and
  original formats (Principle II), so a student can browse the backup with ordinary tools
  without the app.
- **FR-004**: A backup MUST include a human-readable description of itself: app version, data
  format version, creation date and time, and counts of each kind of item.
- **FR-005**: A backup MUST include integrity information that lets the app detect a damaged,
  incomplete or modified backup file before restoring.
- **FR-006**: A backup MUST be a single zip file delivered to the student via a download (web)
  or a save dialog (desktop), named with the app name and the creation date and time.
- **FR-007**: A backup MUST reflect a consistent moment in time: each item and file is either
  fully included as saved, or not included; no half-written file is ever included.
- **FR-008**: Creating a backup MUST NOT change, lock out or interrupt the student's work;
  recording in progress continues, and the student is told an in-progress recording is not
  included.
- **FR-009**: The student MUST see progress while a backup is prepared and MUST be able to
  cancel; cancelling or failure leaves no partial backup behind.

#### Restore

- **FR-010**: The student MUST be able to select a backup zip from their computer to restore.
- **FR-011**: Before changing anything, the app MUST validate the file (it is an app backup,
  is complete and unmodified, has only safe paths, and its version is supported) and show a
  summary: creation date, app version, and item counts.
- **FR-012**: Restore MUST require explicit confirmation that names its effect on the current
  data (Principle I: destructive operations need confirmation).
- **FR-013**: Restoring MUST replace all of the current app data with the contents of the backup,
  so that afterward the app holds exactly what the backup holds and the student's data folder
  contains exactly the backup's files: files present now but not in the backup, including
  hand-added ones, are removed (they remain in the safety backup per FR-014). The confirmation
  in FR-012 MUST say that files not in the backup will be removed.
- **FR-014**: Before a restore changes anything, the app MUST automatically create a safety
  backup of the current data in the same format, keep it in a known location, and tell the
  student where it is. The app MUST keep only the newest safety backup: once a new safety
  backup has been completely written, the previous one MUST be deleted (never before). The
  "Backup & restore" section MUST show the location and date of the current safety backup, if
  any, and the confirmation in FR-012 MUST say that the previous safety backup will be replaced.
- **FR-015**: A restore MUST be all-or-nothing: if it fails or is interrupted at any point
  (including the app closing), the data MUST end up exactly as it was before the restore.
- **FR-016**: Provider API keys and AI endpoint keys MUST NOT be included in a backup in any
  form (neither readable nor encrypted); all other provider and AI endpoint settings (names,
  server addresses, models, selected provider) MUST be included. After a restore, every provider
  and AI endpoint whose key was left out MUST show as "not configured" until the student enters
  the key again, and the restore summary MUST tell the student which keys need re-entering.
  Restoring MUST NOT keep or reuse keys from the data being replaced.
- **FR-017**: Restore MUST be blocked, with an explanation, while a recording is in progress,
  audio is waiting on the device to be saved, or a transcription or AI chat answer is running.
- **FR-018**: While a restore runs, the student MUST see progress and MUST NOT be able to change
  data; when it finishes, every open window or tab of the app MUST show the restored data.
- **FR-019**: Backups made by older app versions MUST be restorable and upgraded to the current
  version; backups made by a newer version MUST be refused with a message to update the app.
- **FR-020**: Restore MUST never write outside the app's data folder and MUST refuse archives
  containing absolute paths, parent-folder references, or links.
- **FR-021**: A backup made by the web version MUST be restorable in the desktop app and vice
  versa; restored files MUST be placed under the current installation's account folder.

#### Safety and limits

- **FR-022**: Before starting a backup or restore, the app MUST check there is enough free disk
  space and refuse with a clear message if there is not.
- **FR-023**: Backup and restore MUST work for data sets of at least 20 GB without failing for
  lack of memory.
- **FR-024**: Backup and restore failures MUST be reported in plain language naming the cause
  (not enough space, damaged file, newer version, unsafe file, operation blocked by recording),
  and MUST NOT include secrets in messages or logs.

### Key Entities

- **Backup file**: A single zip file representing all app data at one moment. Holds the data
  folder content in its normal layout, the app's structured data, settings and themes, a
  manifest, and integrity information.
- **Backup manifest**: Human-readable description of a backup: app version, data format
  version, creation date and time, source (web or desktop), and item counts per kind.
- **Safety backup**: A backup automatically made just before a restore, kept in a known location
  so the student can undo the restore. At most one exists at a time; a newer one replaces it.
- **Restore operation**: One attempt to replace current data with a backup's contents; it either
  completes fully or leaves the data as it was.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student can create a backup from Settings in no more than 3 actions (open the
  section, choose "Create backup", save the file).
- **SC-002**: After restoring a backup into an empty installation, 100% of items and files are
  present and every file is byte-for-byte identical to the original.
- **SC-003**: A backup of 1 GB of data is created in under 2 minutes and restored in under 3
  minutes on a typical student laptop.
- **SC-004**: In tests that interrupt a restore at random points (including closing the app),
  100% of cases end with the data exactly as before the restore or exactly as in the backup —
  never a mix.
- **SC-005**: 100% of damaged, modified, non-app or newer-version backup files are refused before
  any data is changed.
- **SC-006**: No backup file ever contains a provider or AI endpoint key, in readable or
  encrypted form.
- **SC-007**: A student can browse a backup with an ordinary archive tool and open any note,
  recording or document without the app.

## Assumptions

- A backup covers the signed-in account's data in full (the desktop's implicit owner, or one web
  account — the owner or a member). In the web version, backing up or restoring one account
  never reads or changes another account's data, and the account's identity (user name,
  password, role) is kept as it is on restore. Partial backups (for example, one semester only)
  are out of scope.
- Restore replaces current data rather than merging it; merging two data sets is out of scope.
- Automatic or scheduled backups and uploading backups to cloud storage are out of scope; the
  student keeps the file wherever they like.
- The backup is not encrypted as a whole; the student is responsible for where they store it.
  Because keys are never included (FR-016), a backup holds no secrets.
- The app's own logs and temporary caches are not part of the backup; the database backups made
  before upgrades (Feature 015) and the safety backup (FR-014) are not included either, and the
  safety backup is kept outside the student's data folder so a restore never removes it.
- Only the newest safety backup is kept (FR-014); a student who wants to keep an older one
  copies it elsewhere. Undoing a restore is done by restoring the safety backup through the
  normal "Restore from backup" flow.
- The data folder location itself (desktop) is a property of the installation, not of the data,
  and is not changed by a restore.
