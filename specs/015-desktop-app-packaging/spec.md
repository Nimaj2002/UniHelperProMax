# Feature Specification: Desktop App for Windows, macOS and Linux

**Feature Branch**: `015-desktop-app-packaging`

**Created**: 2026-10-26

**Status**: Draft

**Input**: User description: "Package the app as installable desktop programs for Windows, macOS and Linux, so a student can install it, open it like any other program in its own window, and use it without installing Python, Node or anything else, and without a network connection except for transcription providers and AI endpoints they choose." (Full description covers: installers and start-up; single instance; start-up failures; graceful stop and no leftover processes; the window close confirmation; a fixed local address and port; the data folder and first-run choice; single user and local-only access; the app window, external links and save dialogs; microphone and WebM/Opus recording on every system; upgrades with database backup; offline use; the unsigned first release and README guidance; keeping existing behavior and the web version; out of scope.)

**Related**: Feature 001 (owner account and login), Feature 002 (notes, autosave and unsaved
drafts), Feature 003 (session audio recording, progressive persistence, audio held on the device
after a crash, microphone changes), Feature 004 (transcription providers), Feature 005 (Settings,
provider keys, themes and theme export), Feature 007 (session PDF reader and its links),
Feature 010 (calendar export), Feature 014 (AI endpoints and encrypted keys). Constitution
Principles I, II, IV and VIII.

## Clarifications

### Session 2026-10-26

- Q: Should the desktop app be able to take over data from an existing self-hosted (web/Docker) installation? → A: No, never; the desktop app always starts with its own empty database (FR-055).
- Q: Which oldest system versions are supported? → A: Every version the pinned desktop runtime supports; the plan states the oldest Windows, macOS and Linux versions (FR-008).
- Q: Should the desktop data folder hold the year folders directly or keep the web layout's account-name folder? → A: Keep the web layout exactly: `<data folder>/<account name>/<year>/…`, where the account name is the computer's login name (FR-025).
- Q: When the student closes the app while a transcription is running or an AI chat answer is still streaming, should the app ask first? → A: Yes; the app says what will stop ("Quitting stops it; you can restart it later") with Keep app open / Quit anyway (FR-013a).
- Q: Should the Windows installer install for the current user only or for all users? → A: Current user only, with no administrator rights needed (FR-001).
- Q: What should happen when the app's port is taken by another program at start-up? → A: Fall back automatically to the next free port of a short list (the saved port, then the next four) and keep using it, unless unsent work waits under the saved port; then show the port error (FR-021, 2026-10-26, after the first Windows probe run).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install and open the app like any other program (Priority: P1)

A student downloads the installer for their system, installs it, and opens UniHelperProMax from
the Start menu, Applications folder or app launcher. The app opens in its own window and is
ready to use; nothing else (no Python, Node, browser or terminal) has to be installed or opened.
On the first run the app asks where to keep the student's data, suggesting a folder named
UniHelperProMax inside their Documents folder, and then shows the app without a login screen.

**Why this priority**: Without an installable program that opens on its own, no other part of the
feature delivers anything.

**Independent Test**: On a clean machine of each supported system with no developer tools
installed and no network connection, install the program, open it, accept the suggested data
folder, create a class and a note, quit, reopen, and confirm the note is still there and a plain
`.md` file exists in the chosen folder.

**Acceptance Scenarios**:

1. **Given** a clean Windows machine and a user without administrator rights, **When** the
   student runs the Windows installer and opens the app from the Start menu, **Then** the install
   completes without an administrator prompt and the app opens in its own window and is usable.
2. **Given** a Mac with Apple Silicon and a Mac with an Intel processor, **When** the student opens
   the disk image, drags the app to Applications and opens it, **Then** the app runs natively on
   both.
3. **Given** a supported Linux system, **When** the student installs the `.deb` package or runs
   the AppImage, **Then** the app opens in its own window and appears in the app launcher (for the
   `.deb`).
4. **Given** a first run, **When** the window opens, **Then** the app asks where to keep its data,
   suggests `<Documents>/UniHelperProMax`, and lets the student choose another folder.
5. **Given** the student accepted a data folder, **When** they create a class, a session and a
   note, **Then** the note appears as a plain file in that folder's existing hierarchy, and the
   database and settings are not in that folder.
6. **Given** a running app, **When** the student starts the program again, **Then** no second copy
   starts and the existing window is brought to the front (restored if minimized).
7. **Given** no network connection, **When** the student uses any feature other than
   transcription and remote AI endpoints, **Then** it works, including fonts, icons and the PDF
   reader.

---

### User Story 2 - Record lectures reliably on every system (Priority: P1)

The student records a lecture in the desktop app exactly as in the browser. The first time they
record, the app explains why it needs the microphone and the system asks for permission. The
recording is saved as WebM with Opus on every system, so transcription and splitting of long
recordings behave the same everywhere.

**Why this priority**: Recording is the app's core promise (Principle I); a desktop app that
cannot record, or records in a different format on one system, fails its main purpose.

**Independent Test**: On each supported system, record two minutes, stop, play it back, confirm
the saved file is WebM with Opus, and transcribe it; then deny the microphone permission and
confirm the app explains how to allow it on that system.

**Acceptance Scenarios**:

1. **Given** a first recording, **When** the student presses Record, **Then** the app first
   explains why it needs the microphone, then the system's permission request appears.
2. **Given** permission was granted, **When** the student records two minutes and stops, **Then**
   the saved file is WebM with Opus, plays back, seeks correctly, and later recordings do not ask
   again.
3. **Given** the system denies the microphone, **When** the student presses Record, **Then** the
   app says that the system blocked the microphone and shows the steps to allow it on that system
   (Windows, macOS or Linux); no recording is created.
4. **Given** a recording in progress, **When** the microphone is unplugged or switched, **Then**
   the app behaves as defined in Feature 003.
5. **Given** the app is forced to quit one minute into a recording, **When** the student opens it
   again, **Then** the audio captured before the crash is recovered as in Feature 003 (at most
   the last unsaved chunk is lost).
6. **Given** the window's content, **When** a page asks for any other permission (camera,
   location, notifications, screen capture and the like), **Then** it is refused without a prompt.

---

### User Story 3 - Quit safely, with nothing left running (Priority: P1)

The student closes the app. Notes and recordings are saved, the database is closed cleanly, and no
background process stays running. If a recording is in progress or uploads are pending, the app
asks before closing. After a crash or a forced shutdown, the next start detects anything left
over and handles it.

**Why this priority**: Leftover processes block the next start and can corrupt data; silent loss
on close breaks Principle I.

**Independent Test**: Quit normally, kill the app, and shut the system down with the app open;
after each, confirm no app process remains (or, after a kill, that the next start reports and
removes the leftover) and the data is intact.

**Acceptance Scenarios**:

1. **Given** no recording and no pending work, **When** the student closes the window, **Then**
   the app quits, the local server stops cleanly, and no app process remains.
2. **Given** a recording in progress, **When** the student closes the window, **Then** the app
   asks whether to stop the recording and quit, or keep recording; "Stop and quit" saves the
   recording before quitting; "Keep recording" leaves everything as it was.
3. **Given** chunks or note changes still waiting to be saved, **When** the student closes the
   window, **Then** the app says what is still being saved and offers to wait or quit anyway;
   waiting quits by itself once everything is saved, and quitting anyway keeps the unsaved work on
   the device to be saved on the next start.
4. **Given** a transcription or an AI chat answer in progress, **When** the student closes the
   window, **Then** the app says that quitting stops it and can be restarted later, and offers
   "Keep app open" or "Quit anyway".
5. **Given** the confirmation appears, **When** the student confirms, **Then** the app always
   closes; it never silently refuses to close.
6. **Given** the app process is killed or crashes, **When** the student opens the app again,
   **Then** any process left from the earlier run is detected and stopped, and the app starts
   normally.
7. **Given** the system shuts down or the user logs out with the app open and idle, **When** the
   system comes back, **Then** no app process was left behind and the database opens cleanly.

---

### User Story 4 - Keep data safe in a folder the student controls (Priority: P2)

The student's notes, recordings, documents and chats live as plain files in a folder they can see
and change. They can move the data folder in Settings. Uninstalling or upgrading the app never
deletes that folder, and the uninstaller says where the data stays.

**Why this priority**: Principle VIII requires it; it protects the student's work beyond the life
of any one installation.

**Independent Test**: Create data, move the data folder in Settings, confirm everything still
opens; uninstall the app and confirm the data folder and its files are untouched; reinstall and
confirm the app finds the same data.

**Acceptance Scenarios**:

1. **Given** Settings, **When** the student opens the data section, **Then** it shows the full path
   of the data folder and a way to open it in the system's file manager.
2. **Given** Settings, **When** the student chooses a new empty folder and confirms "Move", **Then**
   all files are copied to the new folder, checked, the app switches to the new folder, and only
   then are the old files removed; if anything fails, the app keeps using the old folder and
   nothing is lost.
3. **Given** Settings, **When** the student chooses a folder that already holds UniHelperProMax
   data (for example, restored from a backup) and confirms "Use this folder", **Then** the app
   switches to it without copying, after warning that the current folder will no longer be used.
4. **Given** a recording in progress or pending uploads, **When** the student tries to change the
   data folder, **Then** the change is blocked with an explanation.
5. **Given** the student uninstalls the app on Windows, **When** the uninstaller finishes,
   **Then** the data folder is untouched and the uninstaller tells the student where their data
   remains.
6. **Given** the app was uninstalled and installed again, **When** it starts, **Then** it uses the
   same data folder and database without asking again.

---

### User Story 5 - Upgrade to a newer version without losing anything (Priority: P2)

The student downloads a newer version and installs it over the old one. Their data is kept. If the
new version changes the database, it backs it up first and then migrates. If the migration fails,
nothing is changed and the student is told how to restore the backup. The version number is in
Settings.

**Why this priority**: Every later release depends on safe upgrades; a failed upgrade must never
cost the student their data (Principles I and VIII).

**Independent Test**: Install version N, create data, install version N+1 that changes the
database, confirm the backup exists and the data is intact; repeat with a migration forced to fail
and confirm the database is unchanged and the message explains how to restore.

**Acceptance Scenarios**:

1. **Given** version N with data, **When** the student installs version N+1 over it, **Then** all
   notes, recordings, documents, chats, settings and provider keys are kept.
2. **Given** version N+1 changes the database, **When** it starts for the first time, **Then** it
   makes a backup of the database before changing it, then migrates.
3. **Given** the migration fails, **When** the app starts, **Then** the database is left exactly as
   it was before the upgrade, the app does not open on a half-migrated database, and the student
   sees a message naming the backup's location and the steps to restore it or to reinstall the
   previous version.
4. **Given** Settings, **When** the student opens it, **Then** the installed version number is shown.
5. **Given** a newer database than the installed app understands (the student installed an older
   version), **When** the app starts, **Then** it refuses to open the database and explains that a
   newer version was used with this data.

---

### User Story 6 - Start-up problems are explained, never a blank window (Priority: P2)

If the app cannot start its local server (the port is in use, a folder cannot be written, data is
damaged), the student sees a message naming the cause and where the log file is, and can fix the
common case (port in use) without editing files.

**Why this priority**: A blank or frozen window gives the student no way forward and invites them
to delete data to "fix" it.

**Independent Test**: Occupy the app's port with another program, make the data folder read-only,
and damage the database; for each, start the app and confirm the message names the cause and the
log location.

**Acceptance Scenarios**:

1. **Given** another program uses the app's port, **When** the app starts, **Then** it says which
   port is taken and offers a start-up dialog to choose another port, with the warning in FR-021.
2. **Given** the data folder cannot be written, **When** the app starts, **Then** it names the
   folder and the problem, and offers to choose another folder or quit.
3. **Given** the data folder is missing (for example, an unplugged external drive), **When** the app
   starts, **Then** it says the folder cannot be found and offers to retry, choose the folder again
   or quit; it never silently creates an empty folder in its place.
4. **Given** the database is damaged, **When** the app starts, **Then** it says so, names the log
   file and the latest backup, and does not overwrite or delete the damaged database.
5. **Given** any start-up failure, **When** the message is shown, **Then** it includes a way to open
   the log folder and to copy the error text.

---

### User Story 7 - The window only ever shows the app (Priority: P3)

Links to other websites, in notes, chats and PDFs, open in the student's default browser. Exports
(themes, calendar files, notes) open a save dialog. The window remembers its size and position.

**Why this priority**: Expected desktop behavior; without it the window can get stuck on another
site with no way back.

**Independent Test**: Click external links in a note, a chat answer and a PDF; export a theme, a
calendar file and a note; resize and move the window, quit and reopen.

**Acceptance Scenarios**:

1. **Given** a note, chat answer or PDF with a link to another website, **When** the student
   activates it, **Then** it opens in the default browser and the app window stays on the app.
2. **Given** any attempt to navigate the window or open a new window to another address, **When**
   it happens, **Then** the window stays on the app and the address opens in the default browser
   only if it is a web (http or https) or email (mailto) link; other kinds are ignored.
3. **Given** an export, **When** the student exports a theme, a calendar file or a note, **Then** a
   save dialog lets them choose the name and folder.
4. **Given** the window was resized, moved or maximized, **When** the app is reopened, **Then** it
   opens with the same size, position and maximized state; if that position is no longer on any
   screen, it opens centered on the main screen.

---

### Edge Cases

- **Second launch during first-run setup**: focuses the first copy's setup dialog.
- **Port taken by a leftover from this app** (after a crash): the app recognizes its own leftover
  process, stops it and starts normally; it never stops another program's process.
- **Port taken by another program**: never stops the other program (User Story 6, scenario 1).
- **Port change with pending work**: blocked while recordings or drafts are held on the device
  (FR-022).
- **Data folder inside the install location** (chosen by the user): refused with an explanation
  (Principle VIII).
- **Data folder on a removable or network drive that disappears while running**: saves fail
  visibly as in Features 002 and 003; unsaved work stays on the device and is retried.
- **Not enough disk space for a database backup before migration**: the upgrade does not migrate;
  the app explains how much space is needed.
- **Recording in progress when the system goes to sleep**: behaves as in Feature 003 on wake.
- **System shutdown during a recording**: the recording keeps everything saved up to the last
  stored chunk and is recovered on the next start as an interrupted recording (Feature 003).
- **Two different user accounts on the same computer**: each gets its own app data and data folder;
  only one of them can run the app at a time if both would use the same port, and the second sees
  the port-in-use message.
- **macOS closing the window**: closing the last window quits the app (the backend must stop).
- **AppImage moved or deleted after first run**: the next start from the new location uses the same
  data and settings.
- **Unsupported older system**: the installer or app refuses to start with a message naming the
  minimum supported version, rather than failing later.
- **Existing self-hosted (web/Docker) data**: the desktop app never takes over data from a
  self-hosted installation; it always starts with its own empty database and the data folder
  the user chooses (FR-055).

## Requirements *(mandatory)*

### Functional Requirements

#### Installers and start-up

- **FR-001**: The project MUST produce: a Windows installer; a macOS disk image containing an app
  that runs natively on both Apple Silicon and Intel Macs; a Linux AppImage; and a Linux `.deb`
  package. The Windows installer MUST install for the current user only and MUST NOT require
  administrator rights.
- **FR-002**: Installing and using the app MUST NOT require installing anything else (no Python,
  Node, browser, runtime or developer tool), except what the operating system itself provides or
  the installer adds without user action.
- **FR-003**: Starting the app MUST open it in its own window and start its local server
  automatically; the window MUST show a start-up indicator until the app is ready and MUST NEVER
  show a blank page.
- **FR-004**: Only one copy of the app MUST run per user account. Starting it again MUST bring the
  existing window to the front (restoring it if minimized) and MUST NOT start a second server.
- **FR-005**: If the local server cannot start, the app MUST show a message naming the cause (port
  in use and by which port, missing or unwritable folder, damaged database, newer database
  version, or other) and the location of the log file, with actions to open the log folder, copy
  the error text, retry and quit.
- **FR-006**: The app MUST write a log in the system's per-user log or app data location, keeping
  a bounded amount of history (at most the last 10 runs or 10 MB). Logs MUST NOT contain API keys
  or note, chat or recording content.
- **FR-007**: The installed version number MUST be shown in Settings.

#### Supported systems

- **FR-008**: The app MUST support every Windows, macOS and Linux version that the pinned
  desktop runtime chosen in the plan supports, on X11 and Wayland for Linux; the plan states the
  oldest version of each. On an older system the app MUST refuse to start with a message naming
  the minimum version.

#### Stopping

- **FR-009**: Quitting the app MUST stop the local server gracefully: pending saves are finished,
  any recording in progress is finalized, and the database is closed cleanly, before the process
  ends.
- **FR-010**: No app process MUST remain after the app quits normally, after the app's window
  process crashes or is killed, or after the system shuts down or the user logs out.
- **FR-011**: On start, the app MUST detect a process left from an earlier run of the same
  installation and data, stop it safely, and continue. It MUST NEVER stop a process that does not
  belong to the app.
- **FR-012**: Closing the window while a recording is in progress MUST ask for confirmation with
  the choices "Stop recording and quit" and "Keep recording". Stop and quit MUST save the
  recording before quitting.
- **FR-013**: Closing the window while recording chunks or note changes are still waiting to be
  saved MUST say what is pending and offer "Wait and quit" (quits by itself once saved, with
  progress) and "Quit anyway" (keeps the unsaved work on the device and saves it on next start,
  as in Features 002 and 003).
- **FR-013a**: Closing the window while a transcription is running or an AI chat answer is still
  being generated MUST say what will stop ("Quitting stops it; you can restart it later") and
  offer "Keep app open" and "Quit anyway". Quit anyway stops that work, which is then shown as
  interrupted as defined in Features 004 and 014. When this applies together with FR-012 or
  FR-013, a single dialog lists everything that is pending.
- **FR-014**: Once the user confirms quitting, the app MUST close. It MUST NEVER silently refuse
  to close; every blocked close MUST show why.
- **FR-015**: Closing the last window MUST quit the app on every system, including macOS.

#### Address and port

- **FR-016**: The desktop app MUST always use the same local address and port across restarts and
  crashes, so recording buffers and unsaved drafts held by the window are recovered on the next
  start.
- **FR-017**: The default port MUST be a fixed number other than 8000, documented in the README.
- **FR-018**: The local server MUST accept connections only from the same computer; it MUST NOT be
  reachable from other computers on any network.
- **FR-019**: The local server MUST reject requests whose host name is not the app's own address
  and port, so other websites (including through DNS rebinding) cannot reach it.
- **FR-020**: The local server MUST reject requests that do not come from the app's own window;
  other programs and websites on the same computer MUST NOT be able to read or change data.
- **FR-021**: If the saved port is in use by another program at start-up, the app MUST try the
  next four ports in order, start on the first free one, and keep that port for later starts. It
  MUST NOT fall back while unfinished recordings or unsaved drafts are held under the saved port
  (FR-022); then, and when every candidate is taken, the user MUST be told which port(s), and be
  able to choose another in a start-up dialog or in Settings. Before a manual port change, the
  app MUST warn that unfinished recordings and unsaved drafts held under the old address will
  not be recovered. The log MUST record why each port could not be used.
- **FR-022**: Changing the port MUST be blocked, with an explanation, while any recording is in
  progress or any recording chunks or unsaved drafts are held by the window.
- **FR-023**: The new port MUST take effect after a restart of the app, which the app MUST offer
  to do.

#### Data

- **FR-024**: On first run the app MUST ask where to keep its data, suggesting a folder named
  `UniHelperProMax` in the user's Documents folder, and MUST create it if needed.
- **FR-025**: Notes, recordings, documents, annotations and chats MUST be stored as plain files in
  the data folder, using the existing hierarchy of Principle II, unchanged, including the per-user
  folder: `<data folder>/<account name>/<year>/<semester>/…`. In the desktop app the account name
  is the computer's login name, made safe for use as a folder name.
- **FR-026**: The database, settings, logs and the key used to protect provider keys MUST be stored
  in the system's per-user application data location, outside the data folder and outside the
  install location.
- **FR-027**: The data folder MUST be outside the install location; choosing a folder inside it
  MUST be refused with an explanation.
- **FR-028**: Settings MUST show the data folder's full path with an action to open it in the
  system's file manager.
- **FR-029**: In Settings, the user MUST be able to change the data folder by either (a) moving the
  data to a new empty folder — copied, verified, switched, and only then removed from the old
  folder, with the old folder kept intact on any failure — or (b) pointing the app at a folder
  that already holds UniHelperProMax data, after a warning. Both MUST be blocked while a recording
  is in progress or uploads are pending.
- **FR-030**: Uninstalling or upgrading the app MUST NEVER delete, move or change the data folder
  or the per-user application data (database, settings, keys, backups).
- **FR-031**: The Windows uninstaller MUST tell the user where their data remains. For the macOS
  and Linux packages, which have no interactive uninstaller, the README MUST say where the data
  and app data are kept and how to remove them by hand.
- **FR-032**: Reinstalling the app MUST find and use the existing data folder and app data without
  asking again.

#### Single user and secrets

- **FR-033**: The desktop app MUST be single-user and MUST open without a login screen. Account
  management (login, owner password) MUST NOT be shown in the desktop app.
- **FR-034**: Provider API keys MUST be stored locally and protected with the operating system's
  key store where available, following Principle IV and Feature 014's encryption-at-rest rules;
  where no key store is available, the existing fallback and its Settings warning apply.

#### The app window

- **FR-035**: The window MUST only ever show the app. Navigation to any other address, in the
  window or a new window, MUST be prevented.
- **FR-036**: Web (`http`, `https`) and email (`mailto`) links to other addresses, from notes,
  chats, PDFs or anywhere else in the app, MUST open in the user's default browser or mail
  program. Links with any other scheme MUST be ignored.
- **FR-037**: Every export the app offers (themes, calendar files, notes and any other download)
  MUST open the system's save dialog, letting the user choose the name and folder.
- **FR-038**: The window MUST remember its size, position and maximized state across restarts,
  and MUST open centered on the main screen if the saved position is no longer visible.
- **FR-039**: Developer tools and other debugging features MUST NOT be available in released
  builds.

#### Microphone and recording

- **FR-040**: Recording MUST work on all supported systems, and every recording MUST be saved as
  WebM with Opus on every system.
- **FR-041**: The microphone MUST be the only permission the window grants, and only to the app's
  own address. All other permission requests MUST be refused without a prompt.
- **FR-042**: At the first recording, the app MUST explain why it needs the microphone before the
  system asks.
- **FR-043**: If the system denies the microphone, the app MUST say so and show the steps to allow
  it on the current system (Windows privacy settings, macOS Privacy & Security, or the Linux
  desktop's sound and privacy settings), and MUST NOT create a recording.
- **FR-044**: Microphone loss or change during a recording, progressive saving and crash recovery
  MUST behave exactly as in Feature 003.

#### Upgrades

- **FR-045**: Installing a newer version over an older one MUST keep all data and settings.
- **FR-046**: Before any change to the database's structure, the app MUST make a backup of the
  database in the per-user application data location, named with the old version and the date.
  The app MUST keep at least the three most recent such backups.
- **FR-047**: If a migration fails, the database MUST be left exactly as it was before the
  attempt, the app MUST NOT open on it, and the user MUST see the backup's location and the steps
  to restore it or reinstall the previous version.
- **FR-048**: If there is not enough free space for the backup, the app MUST NOT migrate and MUST
  say how much space is needed.
- **FR-049**: If the database was created by a newer version than the installed app, the app MUST
  refuse to open it and explain why.
- **FR-050**: Automatic updates are out of scope; the user installs new versions manually.

#### Offline

- **FR-051**: All interface files, fonts, icons and the PDF reader MUST be bundled. Every feature
  except transcription and remote AI endpoints MUST work with no network connection, and the app
  MUST make no network requests except to providers and endpoints the user configured.

#### Unsigned first release and documentation

- **FR-052**: The first release is not code-signed. The README MUST explain, for each system, the
  warning users will see, how to proceed, and what it means, including that Windows may block
  unsigned programs entirely when its stricter protection setting is on.
- **FR-053**: The README MUST list the supported systems, the installers, the default port, how to
  change it, and where the data folder, app data, backups and logs are kept on each system.

#### Keep working as before

- **FR-054**: All existing features, the storage layout, the web version used in a browser for
  development, and the self-hosted (Docker) installation MUST keep working as before, including
  their login and their current default port.
- **FR-055**: The desktop app MUST NOT import or take over data from a self-hosted (web/Docker)
  installation, and MUST NOT offer to; it starts with its own empty database.

### Key Entities *(include if feature involves data)*

- **Data folder**: The user-chosen folder holding notes, recordings, documents, annotations and
  chats as plain files in the Principle II hierarchy. Its path is recorded in the desktop settings.
- **App data**: The per-user application data location holding the database, desktop settings,
  logs, the key that protects provider keys, and database backups.
- **Desktop settings**: Data folder path, port, window size/position/maximized state, and whether
  the first-run setup and microphone explanation were completed.
- **Database backup**: A copy of the database made before a migration, with the old version and
  date in its name.
- **Run marker**: What the app records about its running local server so a later start can
  recognize its own leftover process.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a clean machine of each supported system, a student with no developer tools gets
  from a downloaded installer to a usable app window in under 3 minutes.
- **SC-002**: After the first run, the app window is usable within 10 seconds of opening it on a
  typical student laptop.
- **SC-003**: In 20 trials per system covering normal quit, killed app and system shutdown, zero
  app processes remain afterwards (or, after a kill, the leftover is removed on the next start).
- **SC-004**: On every supported system, 100% of test recordings (2 minutes and 60 minutes) are
  saved as WebM with Opus, play back and seek correctly, and transcribe like recordings made in
  the browser.
- **SC-005**: After the app is killed during a recording, at most the last unsaved chunk of audio
  is lost, on every supported system.
- **SC-006**: Upgrading from the previous release keeps 100% of notes, recordings, documents,
  chats, settings and keys; a forced migration failure leaves the database byte-for-byte
  unchanged.
- **SC-007**: Uninstalling leaves 100% of the data folder's files byte-for-byte unchanged.
- **SC-008**: With the network disconnected, every feature other than transcription and remote AI
  works, and the app makes no network requests other than to user-configured providers.
- **SC-009**: Requests to the local server from another computer, from a website in a browser,
  or from another program on the same computer are refused in 100% of tested cases.
- **SC-010**: Every start-up failure in the test list (port in use, unwritable folder, missing
  folder, damaged database, newer database) shows a message naming the cause and the log
  location; none shows a blank window.
- **SC-011**: A first-time user following the README can open the unsigned app on each system on
  the first attempt.

## Assumptions

- The desktop app bundles everything it needs to show the interface and record, so recording
  behavior and the WebM/Opus format do not depend on which browser engine the user's system
  provides. The choice of desktop technology is made in the plan (see the shell research done
  before this spec).
- Windows and Linux builds target 64-bit x86 machines; macOS builds cover Apple Silicon and Intel.
  Windows on ARM and Linux on ARM are out of scope for the first release.
- The desktop app keeps a single implicit owner account so the existing account-based data model
  is unchanged; it is created on first run without a password prompt and is named after the
  computer's login name (FR-025).
- "Recording buffers and unsaved drafts held by the window" are the audio chunks and note drafts
  that Features 002 and 003 keep on the device until the server confirms them.
- The README's per-system guidance and default port are part of this feature; screenshots are
  optional.
- Each user account on a computer has its own app data and data folder; sharing one data folder
  between accounts is not supported.
- Out of scope: importing data from a self-hosted installation, automatic updates, app stores, code signing and notarization in the first release,
  mobile apps, multiple accounts on one installation, cloud sync, and packaging as a browser-only
  program.
