# Data Model: Yuii Guided Tour

Only one piece of data is stored: the per-user tour state. Everything else is static frontend
data (steps, chapters, artwork) or in-memory state of a running tour.

## Stored: `Preferences.tour` (per user, in `ui_preferences.data`)

| Field | Type | Rules |
|-------|------|-------|
| `status` | `"not_seen" \| "in_progress" \| "skipped" \| "completed"` | required |
| `chapter` | `ChapterId \| null` | last chapter reached; `null` unless `status = in_progress` (a non-null value with another status is accepted and ignored) |

Default (no stored value, old or new account): `{ "status": "not_seen", "chapter": null }`.
`ChapterId` is one of `welcome`, `first_course`, `first_note`, `pdf_recording`, `ai`,
`settings`, `goodbye`. Unknown fields → `422 extra_forbidden`; unknown status/chapter →
`422 literal_error`. A PATCH with `tour` replaces the whole object (same as `shortcuts`).

### State transitions

```text
not_seen ──start──▶ in_progress ──finish──▶ completed
    │                   │  ▲
    │                   │  └── chapter changes (stored on each chapter start)
    │                   └──end/skip──▶ skipped
    └──"Maybe later"──▶ skipped

skipped | completed ──replay──▶ in_progress (chapter = welcome or the jumped-to chapter)
in_progress (on next app start) ──"Continue"──▶ in_progress (same chapter)
                                ──"End tour"──▶ skipped
```

Auto-start happens only from `not_seen` and `in_progress` (the latter as a "continue?" offer).
The stored state is written on: start, each chapter change, skip/end, finish. It is **not**
written per step.

## Static (frontend only): Tour step

| Field | Meaning |
|-------|---------|
| `id` | unique string, e.g. `first_course.create_year` |
| `chapter` | `ChapterId` |
| `kind` | `"show"` (Next/Back only) or `"do"` (waits for an action) |
| `target` | `TargetId` or none (centred Yuii) |
| `route` | optional path, or function of the tour context |
| `expression` | `greeting \| instructional \| excited \| thinking \| shy \| dizzy \| tablet \| wink` or `"point"` (pose chosen by placement, research R6) |
| `text` | speech bubble text; may be a function of the tour context (e.g. AI configured or not) |
| `waitFor` | for `do` steps: the tour event that completes it (research R4) |
| `successText` / `successExpression` | shown briefly after `waitFor` fires (default `excited`) |
| `errorText` | hint when the underlying action fails (default expression `dizzy`) |
| `optional` | shows "Skip this step" |
| `dependsOn` | an earlier step; skipping that step skips this one too (e.g. the New class form steps, Stop/Transcribe after Record) |
| `reveal` | selectors clicked once to uncover the target (expand a collapsed section, select a panel tab); they match only the closed state |
| `existingPicker` | `year \| semester \| course \| session`: offers "Use my existing …" when the user has one (FR-014) |
| `requires` | context keys this step needs (e.g. `sessionKey`); missing → prerequisite message (FR-015) |

## Static: Chapters (in order)

| Chapter | Steps (outline) |
|---------|-----------------|
| `welcome` | welcome + start/later; side panel; home; calendar; home right panel and each of its tabs (tasks, general notes, time, knowledge graph) |
| `first_course` | open New class; pick/create year, semester, course in its picker; set time and save |
| `first_note` | open the course's first session; new note; type; point at save status "saved" |
| `pdf_recording` | upload PDF (optional); record (optional) → stop → transcribe |
| `ai` | right panel; AI chat (+ optional first message); open the AI teacher; start a lesson; the lesson tab's columns (provider hint instead when no AI model) |
| `settings` | AI providers, transcription, proxy, appearance/themes, time, shortcuts, import/export, backup, trash, account, version |
| `goodbye` | point at the Yuii rail button: "replay me anytime"; finish |

## In memory: Running tour

| Field | Meaning |
|-------|---------|
| `stepIndex` | index into the flat step list |
| `mode` | `interactive` or `passive` (a modal dialog is open while awaiting, research R5) |
| `context` | `{ yearId?, semesterId?, courseId?, sessionKey?, aiConfigured? }` (research R10) |
| `lastError` | set when the awaited action reported an error (FR-017) |

## Tour events (frontend bus)

The year/semester/course steps do not use an event: they wait for their picker field's
`data-filled="true"` (which also covers values the form preselects).

| Event | Emitted by (existing success path) | Payload |
|-------|------------------------------------|---------|
| `class.created` | New class dialog submit success | `{ courseId }` |
| `note.created` | new-note dialog success | `{ noteId }` |
| `note.saved` | note autosave success | — |
| `document.added` | document upload success | `{ id }` |
| `recording.started` | recording started | — |
| `recording.saved` | recording finalized | — |
| `chat.sent` | AI chat message sent | — |
| `action.failed` | the same forms' error paths | `{ kind }` |
