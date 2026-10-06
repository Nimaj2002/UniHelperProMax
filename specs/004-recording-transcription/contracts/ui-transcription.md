# UI Contract: Transcription (004)

shadcn/ui primitives, theme tokens only, Phosphor icons, `design-taste-frontend` guidance; every
state is conveyed by text (+ icon), never by colour alone. Works in light, dark and user themes.

## Where it lives

- `frontend/src/features/transcription/` registers itself (like 003) — the recordings module
  exposes a **recording extension registry** (`registerRecordingExtension`) so the audio panel
  renders per-recording actions and status rows (under each recording, so a narrow panel
  never overflows) without importing transcription code.
- Global: an activity-bar item (`registerActivity`) and a notifications host (`registerGlobalHost`).

## Recording list item (audio panel)

- **Transcribe** button (icon `Article` + text "Transcribe") on finished recordings
  (`complete` / `interrupted`, file present).
  - Disabled + reason (`aria-describedby` text) when: a transcription is running anywhere ("A
    transcription is already running.") or the file is missing ("The audio file is missing.").
  - Not shown at all while the recording is still being recorded (its "Recording" status already
    explains why) — decided 2026-10-06.
- **Status row** under the recording, from the latest job of that recording:
  - Running: stage label + progress — "Queued", "Uploading 42 %", "Transcribing part 2 of 3 ·
    1:24", "Adding to note" — with a shadcn `Progress` (determinate when `progress` is known,
    otherwise an indeterminate bar with `aria-valuetext` = stage) and **Cancel**.
  - Failed: `WarningCircle` + "Transcription failed: <message>", **Retry**; if
    `settingsRelated`, a link "Open Settings → Transcription" (`/settings/transcription`).
  - Cancelled: "Transcription cancelled", **Retry**.
  - Completed: "Transcribed → <note name> · 5 Oct" — the note name is a link that opens the
    note in the workspace (and selects its tab). Multiple completed jobs: the latest, plus
    "+N earlier" disclosure listing the others.
- Progress text is in an `aria-live="polite"` region, throttled to stage changes and every 10 %
  (no per-second announcements); completion/failure announced once.

## Transcribe dialog (shadcn `Dialog`)

Title "Transcribe “Recording 10:02”". Content:

1. **Not configured** (`GET /transcription/status` → `configured: false`): text "Set up a
   transcription provider first." + primary link button "Open Settings → Transcription"; no
   other controls.
2. **Target** (`RadioGroup`, labelled "Add the transcript to"):
   - one radio per session note (name; sorted like the note list),
   - "New note…" radio revealing an `Input` "Note name" (pre-filled "Transcript", or
     "Transcript (2)"… if taken).
   - Session without notes: no radio group, just the "Note name" input (pre-filled).
3. **Language** (`Select`, labelled "Spoken language"): "Auto-detect" + languages
   (`Intl.DisplayNames`), defaulting to the user's default language.
4. **Already transcribed warning** (FR-023): if a completed job of this recording targets the
   selected note: inline `Alert` "This recording was already transcribed into “Lecture notes”
   on 5 Oct. Transcribe again?" — the confirm button label becomes "Transcribe again".
5. Footer: "Cancel" and primary "Transcribe" (`Enter` submits; focus starts on the first
   radio or the name input). Errors from the start call (name taken, in progress, not
   configured) render inline in `role="alert"`; the dialog stays open.

The dialog never shows provider values or keys — only the provider's name ("Using Voice Studio").

## Activity bar item

While a job is active: `<section aria-label="Transcription">` with stage text, a compact
progress bar, "Recording 10:02 → Lecture notes", **Go to session** and **Cancel**.

## Notifications

- On completion: toast "Transcript added to “Lecture notes”" with action "Open note"; if
  `fallbackNoteCreated`: "The target note was deleted — the transcript was saved as
  “Transcript – Recording 10:02”."
- On failure: toast "Transcription failed: <message>" with action "Retry" (and "Settings" when
  settings-related).
- On app start, unseen finished jobs produce the same toasts once, then are acknowledged.

## Open editor (FR-009)

If the target note is open, its text grows at the end without reload; the cursor and scroll
position stay where they are; unsaved typing is kept (see research B10). The save status shows
"Saved" after the merged content is stored.

## Keyboard

All controls are native/Radix focusable elements; dialog traps focus and returns it to the
Transcribe button; `Escape` closes. No new global shortcuts.
