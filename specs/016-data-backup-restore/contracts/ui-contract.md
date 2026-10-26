# Contract: Settings → Backup & restore

This is a new Settings page at `/settings/backup`, listed in the Settings navigation after
"Import and export". It is built from shadcn/ui primitives (Card, Button, Progress,
AlertDialog, Alert) and theme tokens only. It is fully keyboard operable, and progress and
results are announced through `role="status"` / `aria-live="polite"` (Principle V).

## Layout

There are three cards.

### 1. Create a backup

Text: "Download one zip file with all your classes, notes, recordings, documents, chats, tasks,
events, settings and themes. API keys are not included — you'll enter them again after a
restore."

| State | Shows | Actions |
|---|---|---|
| idle | text above | **Create backup** |
| running | Progress bar (`bytesDone / bytesTotal`), phase label ("Collecting your data…", "Writing the backup…") | **Cancel** |
| ready | "Your backup is ready (4.5 GB)." The download starts automatically: browser download, or the desktop save dialog. | **Download again**, Done |
| failed | Alert with the error title and detail (e.g. not enough space, with the needed size) | **Try again** |
| recording note | If a recording is in progress, an inline note says "The recording in progress won't be included." It doesn't block. | — |

### 2. Restore from a backup

Text: "Replace all your current data with the contents of a backup file."

Steps:

1. **Choose file**: a file input accepting `.zip`. Upload progress, with Cancel.
2. **Checking**: "Checking the backup…", with progress.
3. **Summary**:
   - backup date, app version and source
   - a table of counts, backup vs. current
   - "Upgraded from an older version" when `willUpgrade`
   - the list of keys to re-enter (`keysLeftOut`)
   - what was left out (`excluded`)
   - `filesNotInBackup` when it is > 0
   - Actions: **Restore…** (opens the confirmation), Cancel.
4. **Confirmation** (AlertDialog, destructive style):
   - Title: "Replace all your data?"
   - Body: "Everything you have now — <counts> — will be replaced by the backup from <date>.
     <n> files that aren't in the backup will be removed. A safety backup of your current data
     is made first<, replacing the one from <date>>."
   - Buttons: **Replace my data** (destructive) and **Cancel**. Cancel is the default focus.
5. **Restoring**: a full-page blocking overlay ("Restoring your data… Don't close the app.")
   with phase and progress. Keyboard focus is trapped in the overlay, which offers no actions.
   Closing the page asks first (`beforeunload`).
6. **Done** (shown after the page reloads):
   - "Your data was restored."
   - If `keysLeftOut` is not empty: "Enter your API keys again in Settings → Transcription /
     AI", with links.
   - The page reloads so every screen shows the restored data.
7. **Rolled back / failed**: an Alert with the cause, plus "Nothing was changed."

**Blocked state** (FR-017): the **Restore…** button is disabled with an explanation in each of
these cases:

| Condition | Explanation |
|---|---|
| a recording is in progress | "Stop the recording first." |
| audio on this device isn't uploaded yet (chunk store not empty) or uploads are pending | "Wait until your recording audio is saved." |
| unsaved note drafts exist | "Wait until your notes are saved." |
| a transcription or AI answer is running | "Wait until it finishes or stop it." |

The client reads its own signals from the same sources that feed the desktop close guard. The
server's `409 restore_blocked` reasons are shown the same way.

### 3. Safety backup

- **None yet**: "A safety backup of your data is made automatically before each restore."
- **Exists**:
  - "Safety backup from <date> (<size>). Restore it to undo your last restore."
  - Desktop: the full path, plus a **Show in folder** button.
  - Web: a **Download safety backup** button.

## Other tabs and windows

- When the API client sees a changed `X-Data-Epoch`, it shows a toast ("Your data was restored
  — reloading") and reloads after 1.5 s.
- On `423 restore_in_progress`, the app shows the same blocking overlay as above (without
  progress) and polls `GET /backup/jobs/{jobId}` until the job ends, then reloads.

## Desktop bridge addition

```ts
revealPath(path: string): Promise<void>;   // shows the file in the system file manager
```

- The preload validates that `path` is inside the backend data folder's `backups/safety/` (the
  main process resolves and checks it). Any other path is refused.
- In the web build the call does nothing, like every other bridge call (015).
