# Data Model: Floating Card Layout

**Feature**: 008-floating-card-layout | **Date**: 2026-10-09

This feature adds **no server data, no API fields, no database columns and no files**. All theme
data is unchanged (clarification Q1). The only state is client-side layout state. Almost all of it
already exists and keeps its current storage location.

## Persisted layout state (unchanged keys and locations)

| State | Where it is kept today, and stays | Values | Written by |
|---|---|---|---|
| Left card closed | localStorage `uh.panel.collapsed` | boolean | close/open button, rail button, `[` (wide windows only) |
| Left card width | localStorage `uh.panel.width` | 240–480 px, default 280 | resize handle (pointer/keyboard) |
| Left card section weights | localStorage `uh.panel.sectionWeights` | % per section pair | section resize |
| Collapsed left card sections | localStorage `uh.panel.sectionsCollapsed` | map id → boolean | section headers, Alt+[ |
| Collapsed course groups | localStorage `uh.panel.collapsedGroups` | map | course list |
| Audio card width | localStorage `uh.workspace.rightWidth` | 260–640 px, default 300 | resize handle |
| Audio card closed | account preference `workspaceRightCollapsed` (`GET/PATCH /api/v1/preferences`, existing) | boolean | close button, "Show audio panel", Alt+] (wide windows only) |
| Theme | account (Feature 005), cached in localStorage `uh.theme` | unchanged | Settings → Appearance |

Rule: the stored values describe the **wide-window (docked) layout**. Narrow-window overlay state
and focus mode never write to them (spec edge cases: resizing narrow → wide restores them).

## In-memory layout state (new, not persisted)

### LayoutMode (derived)

- `docked` when the viewport is ≥ 1100 px (`WIDE_QUERY`); `overlay` otherwise.
- Derived from the media query on every render. It is never stored.

### OverlayState (overlay mode only)

- `open: "none" | "left" | "right"`. At most one overlay is open at a time.
- It starts as `"none"` on load and whenever the mode changes to `overlay` (FR-030).
- Transitions:
  - `none → left` via "Show side panel" or `[`.
  - `none → right` via "Show audio panel" or Alt+].
  - Any open state `→ none` via Escape, the close button, or a navigation link inside the left
    overlay. Opening the other card while one is open replaces it.

### FocusMode

- `focus: null | { leftClosed: boolean, rightClosed: boolean }`. The object is the snapshot taken
  when focus mode is entered.
- Transitions:
  - `null → snapshot` (enter): record the current docked states, hide both side cards (including the
    rail), set the overlay to `none`, and move focus to the focus mode button if it was inside a
    hidden card.
  - `snapshot → null` (leave): show the cards according to the snapshot in docked mode. In overlay
    mode both stay closed.
  - While in focus mode, `[` and Alt+] leave focus mode first and then apply their toggle.
    Explicit card actions are not available otherwise, because the cards are hidden.
  - On reload the state is `null`, and the stored docked states apply.

### Effective widths (derived, `layoutWidths`)

- Inputs: viewport width, mode, focus, left closed/width, right present (session workspace only),
  right closed/width.
- Outputs: `leftEff` (0 | 44 | 240–480), `rightEff` (0 | 260–640), `mainMin = 480`, and limits for
  both resize handles.
- Invariant: `leftEff + rightEff + mainMin + gaps ≤ viewport` in docked mode. The right card shrinks
  first, then the left. Stored widths are not changed by clamping.

## Activity (existing stores, read-only here)

- **Recording**: recorder store `status ∈ {idle, recording, stopping, …}`, `label`, `courseId`,
  `sessionKey`, `elapsed`. A pill and the reopen indicator are shown while `recording | stopping`.
- **Transcription**: running jobs (transcription store). A pill and the reopen indicator are shown
  while any job is running. Cancel uses the existing action.

## Theme colors used by the layout (existing tokens)

| Layout role | Token | Editor label |
|---|---|---|
| Window background | `--surface` | Background |
| Card surface | `--surface-elevated` | Surface / card |
| Card border | `--border` | Border |
| Card boundary warning | existing pair `border` on `surface`, min 3:1 | "Border on Background — card edges" |
