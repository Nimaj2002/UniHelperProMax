# Contract: Desktop UI Surfaces

There are two kinds of surface:
- The **startup page**: a local `startup.html` inside `app.asar`, shown before the backend is
  verified. It uses the same theme tokens through a small bundled stylesheet, works offline and
  is keyboard accessible.
- **In-app surfaces**: React, using shadcn/ui, shown only when `uhDesktop` exists.

## Startup page states

| State | Content | Actions |
|---|---|---|
| `starting` | App logo, "Starting UniHelperProMax…" with a progress indicator | — (after 60 s, 180 s in dev mode, it becomes `error: unexpected`) |
| `first-run` | "Where should UniHelperProMax keep your notes, recordings and documents?" + path field (default `<Documents>/UniHelperProMax`) + "You can change this later in Settings." | Choose folder…, Continue |
| `error` | Title per `code`; the message names the cause; "Log file: <path>" | Open log folder, Copy error, Retry, Quit + per-code extras below |

Per-code extras:
- `port_in_use`: shown only when the saved port and its four fallbacks are all taken ("Ports
  47813–47817 are all in use by other programs."), or when the saved port is taken while unsent
  work waits under it ("…the app won't switch to another one…"). Choose another port. When
  `lastGuardState` shows pending work, it is disabled with "Unsent recording audio or unsaved
  notes are waiting under this port. Free the port and retry, so they aren't lost." Otherwise it
  shows the warning text (Settings → Port, below).
- `data_dir_unwritable` / `files_dir_missing`: "The folder <path> can't be written / can't be
  found (is an external drive unplugged?)." Choose another folder.
- `database_damaged`: names the database and the latest backup. Never offers to delete.
- `database_newer`: "This data was used by a newer version of UniHelperProMax. Install that
  version or newer."
- `migration_failed`: "The update couldn't upgrade your database. Nothing was changed. A backup
  is at <backup>. To go back, reinstall version <old> — see the README section 'Restoring a
  backup'."
- `low_disk_for_backup`: "Free at least <n> MB so the app can back up your database before
  updating."
- `another_server`: "Another UniHelperProMax server is using your data. Close it and retry."

## Close dialogs (AlertDialog, from `close-requested`)

| Situation | Title / body | Buttons (default focus first) |
|---|---|---|
| Recording | "A recording is in progress" / "Stop it and save before quitting?" | Keep recording · Stop recording and quit |
| Pending saves | "Still saving" / "<n> recording parts and <m> notes are still being saved." + live progress | Wait and quit · Quit anyway ("They'll be saved next time you open the app.") |
| Native fallback (renderer silent > 3 s) | "UniHelperProMax isn't responding" / "Quit anyway? Unsaved work stays on this computer and is saved next time." | Wait · Quit anyway |

## Microphone

- **Explanation** (before the first recording, once): "UniHelperProMax needs your microphone to
  record lectures. Recordings are saved only in your data folder." Buttons: Continue, Cancel.
- **Denied**: the message names the system and gives its steps.
  - Windows: Settings → Privacy & security → Microphone → turn on "Microphone access" and "Let
    desktop apps access your microphone".
  - macOS: System Settings → Privacy & Security → Microphone → turn on UniHelperProMax, then
    restart the app.
  - Linux: check the desktop's Sound settings for an input device and any privacy switch, and
    make sure no other app holds the microphone exclusively.

## Settings → Desktop section (desktop build only)

- **Version**: `X.Y.Z`.
- **Data folder**: the full path, plus Open folder and Change…. The change dialog asks Move here
  or Use this folder, with progress. It is disabled with an explanation while a recording or
  uploads are pending.
- **Port**: the number, plus Change….
  - Warning: "Unfinished recordings and unsaved drafts kept under the old port won't be
    recovered. The app restarts."
  - Blocked while pending work exists.
- **Logs**: Open log folder.
- **Account**: no account, password or sign-out items appear in the desktop build.
