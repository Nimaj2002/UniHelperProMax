# UI Contract: Settings → Import and export

Route `/settings/import-export`, added to the Settings section nav after "Appearance" with the
label "Import and export". Built from shadcn/ui primitives (Card, Button, Select, RadioGroup,
Checkbox, Input, Table, Progress, AlertDialog, Badge, Popover/Command for course picking),
theme tokens only, Phosphor icons (Principle V).

## Page layout

Two cards, stacked:

1. **Export calendar (.ics)**: a scope Select ("All years and semesters" by default, then one
   option per "<year> · <semester>") and a primary button "Export calendar (.ics)". On success
   the browser saves the file; a toast says "Exported <n> classes and <m> events" (counts from
   the `X-Export-Counts` header, see Notes). On 409 `nothing_to_export`, an inline message: "There
   is nothing to export in <scope>." and no download.
2. **Import calendar (.ics)**: one-line explanation ("Classes and events from Google Calendar,
   Apple Calendar, Outlook or a file exported here. Notes, recordings and documents are never
   imported.") and the import wizard (below).

## Import wizard: steps and states

| Step | Shows | Leaves by |
|---|---|---|
| 1 Choose | Drop area (also a focusable button "Choose .ics file", `accept=".ics,text/calendar"`), limits text "Up to 5 MB and 5,000 events". | File chosen or dropped (only one file; other types refused inline before upload) |
| 1b Reading | File name, `Progress` bar (upload bytes, then "Checking…"), "Cancel" button. | Preview, rejection message (back to step 1), or Cancel (aborts XHR + `DELETE`, back to step 1) |
| 2+3 Preview | Destination block on top, then the groups table, then skipped-before-grouping list (collapsed, with count). Footer: "Cancel" and "Import <n> entries". | Confirm (step 4) or Cancel |
| 4 Importing | Spinner + "Importing…" (not cancellable, FR spec US5-3). | Result or error |
| 5 Result | Counts (classes / events × created, updated, skipped; unchanged), created courses, skipped list with reasons, notes. Buttons: "Undo import", "Done". | Done (back to step 1) or Undo |

### Destination block (step 3)

RadioGroup "Existing semester" (Select of "<year> · <semester>", preselected: the user's
`lastSemesterId` preference, else the latest semester) / "New semester" (year Select or new year
name, semester name Input, required). Changing the destination recomputes default course mapping
and the "update/create" badges client-side from the preview (`matches` are recomputed server-side
only on apply; the preview data already has per-semester name keys — see Notes).

For a file from this app (`fromThisApp`), a notice: "Entries keep their saved year and semester.
Use 'Put in destination' on a group to change that."

### Groups table (step 2)

One row per group, keyboard-navigable as a normal table (no roving focus needed); each row:

- Checkbox "Import <title>" (selected per defaults).
- Title; Badge "Repeating" or "One time"; Badge "Not supported" (with reason in a Tooltip and in
  visually hidden text); Badge "From this app".
- Summary: "<n> entries · Mon, Wed 10:00–11:30 · FENS G032" (several patterns comma-separated).
- "Import as" segmented control (RadioGroup, Class | Event).
- Class: course combobox (existing courses of the target semester + "New course: <name>",
  editable name); shows "Uses existing course" or "New course" plus the colour swatch with its
  colour name in text.
- Open-ended: date input "Repeats until" (default suggested date).
- Not supported: RadioGroup "Import first occurrence only" / "Skip" (no default; confirm disabled
  until chosen, with the row's error text "Choose what to do with this repetition").
- Empty title: Input "Title" (Event) or the course name (Class) required.
- Match badges: "<n> new", "<n> will update", "<n> skipped" with a disclosure listing skipped
  reasons and notes.
- Reserved name issue: inline error on the course name "This name is reserved for events."

"Select all" / "Clear" buttons above the table. Confirm is enabled only when ≥ 1 group is
selected and every selected group is valid; otherwise the first problem is named next to the
button and focus moves to it on activation.

### Result (step 5)

Heading receives focus; an `aria-live="polite"` region announces "Import finished: 38 classes
created, 0 updated, 2 skipped." Skipped list: title, date/time, reason message (exactly the
spec text for all-day: "all-day events are not supported yet"). "Undo import" opens an
AlertDialog: "Remove <n> classes, <m> events and <k> courses created by this import? Entries
with notes, recordings or documents are kept." On success a toast states removed/kept counts and
the kept list replaces the result list; the button disappears.

## Accessibility and theming

- Drop area: `role="button"`, `tabIndex=0`, Enter/Space opens the file dialog; dropping also
  works; visible focus ring from tokens.
- Progress: `Progress` with `aria-valuenow`; a polite live region announces "Reading file, 40%"
  at most every 10 percentage points, then "Checking file", "Preview ready: 5 groups".
- Errors announced assertively (`role="alert"`), e.g. "This file is larger than 5 MB."
- No colour-only information: badges have text; colour swatches have names.
- All controls reachable by Tab in reading order; AlertDialog traps and returns focus.
- Light, dark and custom themes via tokens only; axe passes on every step in all three.
- Reduced motion: no step transition animations.

## Error message map

| Code | Message |
|---|---|
| `file_empty` | "This file is empty." |
| `file_too_large` | "This file is larger than 5 MB." |
| `not_icalendar` | "This isn't a valid calendar (.ics) file." |
| `too_many_events` | "This file has more than 5,000 events." |
| `upload_expired` | "This preview expired. Choose the file again." |
| `nothing_to_export` | "There is nothing to export in <scope>." |
| `import_failed` | "The import failed and nothing was changed. Try again." |
| `undo_unavailable` | "This import was already undone." |

## Notes

- `GET /calendar-export` also returns `X-Export-Counts: classes=<n>; events=<m>` (exposed header)
  for the toast; documented in the response description of the contract during implementation.
- Default course mapping for a changed destination is computed client-side by comparing the
  group title's name key (trim + case-fold, as `name_key`) with the course list of that semester
  from the existing `GET /course-tree`; the server applies the same rule authoritatively.
