# UI Contract: Settings (005)

shadcn/ui primitives, theme tokens only, Phosphor icons, `design-taste-frontend` guidance; every
state shown by text (+ icon), never colour alone; keyboard-only operable (SC-008); colour values
can always be typed as text (FR-022).

## Entry points

- Account menu item "Settings" and a gear icon button "Settings" in the top bar (every screen).
- `/settings` → `/settings/transcription`. Page layout: heading "Settings", a section nav
  (`<nav aria-label="Settings sections">`: Transcription, Appearance) and the section content.

## Settings → Transcription

- **Provider** `RadioGroup` from `GET /transcription/providers` (Voice Studio preselected when
  nothing is saved). Switching shows that provider's saved values (FR-011).
- **Fields** generated from the provider's `fields`: `url`/`text` → `Input` with label and
  placeholder; `secret` → when saved: "••••••••abcd" + "Replace" + "Remove"; when replacing or
  none saved: password `Input` (FR-009/FR-010).
- **Status** line: "Not configured" / "Not tested" / "Connected · tested 10:02" / "Last test
  failed: <reason>" with an icon (FR-013).
- **Test connection** button → spinner + "Testing…", then a result `role="status"` line; the
  result resets when any field changes (spec edge case). Inline errors (`invalid_address`,
  `https_required`, missing field) sit under their field.
- **Default spoken language** `Select` ("Auto-detect" + languages; FR-012).
- **Save** (primary) → toast "Transcription settings saved."; Save is allowed without testing.

## Settings → Appearance

- **Theme list** (`RadioGroup` of cards): Light, Dark, Match system, then custom themes by name;
  each card: name (truncated, full name on hover/focus), a 4-swatch preview, "Low contrast"
  badge when flagged, "Active" marker. Selecting applies immediately (FR-015).
- Custom theme card actions (menu "Actions for <name>"): Edit, Rename…, Duplicate, Export,
  Delete… (AlertDialog naming the theme; deleting the active theme says it falls back to Light
  or Dark). Built-in cards: Duplicate, Export only (US4 #8).
- Buttons "New theme…" (dialog: name + start from Light/Dark/custom → editor) and "Import…"
  (file picker, `.json`; errors in `role="alert"`, notes about filled/ignored colours in a toast).

## Theme editor (`/settings/appearance/themes/new`, `/settings/appearance/themes/:id`)

- Header: name `Input`, base shown, "Advanced" `Switch`, Save / Cancel.
- **Simple mode**: 4 rows (Background, Surface, Text, Accent) — each a native colour picker
  (`input type=color`, labelled) plus a hex `Input` (validated `#rrggbb`).
- **Advanced**: replaces the 4 key colours with all 18 colours (so no colour appears twice),
  same row control; overridden rows described "Overridden" with a "Reset" button; changing a key
  colour (back in simple mode) while overrides exist shows "N colours you set by hand were kept"
  (FR-017).
- **Contrast** panel: list of failing pairs "Muted text on Background — 3.2:1, needs 4.5:1"
  (`role="status"`, updates live); none → "All colour pairs meet WCAG AA".
- **Preview** (scoped CSS variables on the preview container only): calendar event block, note
  text with a heading and link, primary/outline/danger buttons, a dialog card, a player bar.
- Save with failing pairs → AlertDialog listing them, "Save as low contrast" / "Keep editing".
- Leaving with unsaved changes → AlertDialog "Save / Discard / Keep editing" (US4 #7).
