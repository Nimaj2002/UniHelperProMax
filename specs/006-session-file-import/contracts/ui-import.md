# Contract: Upload Audio & Import Note

Extends 002 `ui-workspace.md` and 003 `ui-recording.md`. Tokens only, keyboard operable,
WCAG AA, state never conveyed by colour alone, shadcn primitives (`Button`, `Progress`,
`AlertDialog`, `Checkbox`, `Badge`, `Input`, `sonner` toasts).

## Audio panel

```text
┌ Audio ──────────────────────────────┐
│ [● Record]  [⇪ Upload audio]        │
│ ┌ Uploading ─────────────────────┐  │
│ │ lecture-05.mp3 · 84 MB          │  │
│ │ ━━━━━━━━━━━━━━──────── 62 %  [✕]│  │   ✕ = "Cancel upload of lecture-05.mp3"
│ │ notes.pdf — This file type isn't│  │
│ │ supported. Use MP3, M4A, AAC,   │  │
│ │ WAV, OGG, Opus, WebM or FLAC.[Dismiss]│
│ └────────────────────────────────┘  │
│ ▸ Week 3 — Graphs    1h 12m  [Imported]
│   Imported 6 Oct 2026 · 14:31        │
│ ▸ Recording 10:02    1h 24m          │
│   Recorded 5 Oct 2026 · 10:02        │
└─────────────────────────────────────┘
```

- **Upload audio**: `Button variant="outline"` beside Record, always enabled (also while a recording
  runs, and in upcoming sessions). Opens a native picker: `multiple`,
  `accept=".mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.webm,.flac"`.
- **Drop zone**: the whole panel. While files are dragged over it, an overlay with a dashed
  `border-primary` outline and the text "Drop audio files to upload" covers the list. Dropping
  folders shows "Folders can't be uploaded — drop the files inside." Not the only way in.
- **Pre-checks (no request sent)**: wrong extension → "This file type isn't supported. Use MP3, M4A,
  AAC, WAV, OGG, Opus, WebM or FLAC."; over 1 GB → "<name> is 1.4 GB. Audio files can be at most
  1 GB."
- **Upload rows**: file name, size, `Progress` with `aria-label="Uploading <name>"` and percentage
  text; Cancel icon button (accessible name includes the file name). States: Waiting… (queued, max 2
  at once), percentage, "Checking…" (verifying), error text + **Retry** + **Dismiss**. Done rows
  are removed and the item appears in the list (focus is not moved).
- **Errors from the server**: 413 / 415 as above; 422 `unreadable_audio` → "<name> couldn't be read
  as audio."; 507 → "There isn't enough space on the server for <name>."; network → "Upload of
  <name> failed — check your connection." (Retry).
- **Live region** (polite): "Uploading <name>", "<name> 50 % uploaded" every 25 %, "<name>
  uploaded", "<name> upload cancelled", errors as above.
- **Leaving**: reload/close while uploads run → browser `beforeunload` prompt; sign-out → the shell
  sign-out guard dialog "Uploads in progress will be cancelled." Navigating inside the app keeps
  uploads going; the panel of another session shows only its own uploads.
- **List items**: imported items show `Badge variant="outline"` "Imported" and the date line prefix
  "Imported"; recorded items' date line prefix is "Recorded". Tooltip on the name of an imported
  item: "Imported from <originalFileName>". Everything else (player, menu, Transcribe, history)
  unchanged, except the player's existing error text: for an imported item whose format the browser
  can't decode (`MEDIA_ERR_SRC_NOT_SUPPORTED`) it reads "This browser can't play <FORMAT> files. Try
  another browser, or transcribe it." instead of "This recording can't be played."

## Notes section ("Sessions and notes")

```text
[+ New note]  [⇪ Import note]
```

- **Import note**: `Button size="sm" variant="outline"` beside New note; picker `multiple`,
  `accept=".md,.txt,text/markdown,text/plain"`.
- Files are processed in pick order; each accepted file appears in the note list as it's created
  (not opened in a tab, so the user's current tab stays active). A single imported note is opened
  in a tab (like New note).
- **Rejections** (per file, import continues): wrong type → "<name> isn't a .md or .txt file.";
  over 5 MB → "<name> is larger than 5 MB."; invalid UTF-8 / binary → "<name> isn't readable text
  (save it as UTF-8 and try again)."

### Conflict prompt (`AlertDialog`)

```text
A note named “Lecture 3” already exists in this session.
What should happen to “Lecture 3.md”?

  ( ) Rename to [Lecture 3 (2)        ]   ← inline Input, validated live
  [ ] Apply to all 3 remaining conflicts

            [Skip]  [Replace…]  [Import as new note]
```

- Buttons: **Skip** (also Escape / close), **Replace…** (destructive styling), **Import as new
  note** (primary, uses the Rename field). Focus starts on the name field. Empty or taken names
  disable the primary button with an inline message.
- **Replace…** opens a second `AlertDialog`: "Replace the content of “Lecture 3”? Its current
  content will be permanently replaced by “Lecture 3.md”. This can't be undone." With apply-to-all
  it lists every note to be replaced. **Cancel** returns to the conflict prompt; **Replace**
  (destructive) proceeds.
- Replace refused (no dialog closes silently): unsaved edits → "“Lecture 3” has unsaved changes.
  Wait until it says Saved, then try again."; 409 `note_transcribing` → "A transcription is being
  added to “Lecture 3”. Try again when it finishes."; 409 `file_changed_on_disk` / 412 → "“Lecture
  3” changed since you chose Replace. Nothing was replaced." Each such file is reported as not
  imported.

### Result summary

- One file: a toast ("Imported “Lecture 3”", or the rejection message).
- Several files: toast "Imported 4 of 6 notes" with **Details** → `Dialog` listing each file:
  Imported · Imported as “X” · Replaced “X” · Skipped · Not imported — <reason>.
- Audio imports with several files use the same pattern once all uploads in the batch settle.

## Keyboard

- Both buttons are in the tab order; `Alt+Shift+N` opens Import note (next to `Alt+N` New note);
  no shortcut for Upload audio (the panel button is one Tab stop from Record).
- All dialogs trap focus while open and return it to the triggering button on close.
