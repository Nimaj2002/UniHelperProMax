# Research: Floating Card Layout

**Feature**: 008-floating-card-layout | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

No `NEEDS CLARIFICATION` items remained after `/speckit-clarify`. The decisions below settle the
choices the spec left to planning and record how the existing shell is reshaped. File references
are relative to `frontend/src/` unless stated otherwise.

## Starting point (what exists today)

- `app/shell/AppShell.tsx` is a three-row grid: `TopBar` (h-14) → `ShellColumns` (side panel +
  `<main>`) → `ActivityBar` (full-width bottom row). The mobile drawer is a `Sheet`.
- `TopBar.tsx` holds the panel toggle, app name, the page toolbar slot (only the calendar uses it),
  registered top-bar actions ("New class", Settings gear) and the Account menu.
- Five pages size themselves with `h-[calc(100dvh-3.5rem)]`: `WorkspacePage`, `CalendarPage`,
  `CoursePage`, `SettingsLayout`, `AccountsPage`.
- The workspace has its own `WorkspaceHeader` (back link, date/time, location, badges, panel
  toggles), the tab row (`WorkspaceTabs` + Live/Raw toggle + split toggle) and `AudioColumns`
  (editor | audio grid, audio width in `uh.workspace.rightWidth`, open state in the account
  preference `workspaceRightCollapsed`).
- The desktop breakpoint is `(min-width: 1024px)` (`lib/useMediaQuery.ts`); below it the left panel
  and the workspace sections live in drawers.
- `ActivityBar` renders the registered activities: `RecordingBar` and `TranscriptionBar`.
- Save state: `StatusLabel` in each tab and at the bottom-right of each `NotePane`.

## R1 — Shell structure: one grid of three cards

**Decision**: Replace the three-row grid with a single full-viewport grid
(`h-dvh overflow-hidden p-2 gap-2 bg-surface`) of up to three columns: **left card | main card |
right card**. A shared `Card` shell component (`app/shell/Card.tsx`) provides `rounded-[14px]`, a
1 px border in `--border`, `bg-surface-elevated`, `overflow-hidden` (clipping to the radius) and a
column flex layout whose body scrolls on its own (`min-h-0 overflow-y-auto`). The window never
scrolls (`html, body` stay `min-height: 100dvh`, the shell is `h-dvh overflow-hidden`).
`TopBar.tsx` and the `ActivityBar` row are deleted.

**Rationale**: One grid owns all three columns, so the gap rules (FR-002) and the 480 px minimum
(FR-029) are enforced in one place instead of across `ShellColumns` and `AudioColumns`.

**Alternatives considered**: Keep `AudioColumns` inside the workspace and style it as a card. This
was rejected because the audio card would be nested inside the main card's grid cell, and the
480 px rule would need two cooperating width calculations.

## R2 — The audio card moves to the shell via a slot

**Decision**: Add a shell slot context (`app/shell/slots.tsx`, generalizing today's
`toolbar.tsx`): `useRightCard(node | null)`. `WorkspacePage` passes its audio panel (`RightPanel`)
into the slot while it is mounted and clears it on unmount. The shell renders the slot as the right
card, so the audio card exists only in the session workspace (FR-019). The audio width key
`uh.workspace.rightWidth` and the open-state preference `workspaceRightCollapsed` are reused
unchanged. `toolbar.tsx` / `usePageToolbar` are removed: the calendar renders its toolbar inside its
own page (R5).

**Rationale**: This matches the existing portal pattern used for panel sections
(`usePanelSections`). It needs no new dependency, and the workspace still owns the panel's content
and state.

**Alternatives considered**: Render the audio card from a route-level layout. Rejected because the
workspace needs to own open/closed state together with its keyboard handler (Alt+]) and the tab-row
reopen button.

## R3 — Where the top bar's controls go

| Today (TopBar) | New home |
|---|---|
| Panel toggle (`SidebarSimple`, "Hide/Show course panel", `[`) | Left card header close button ("Hide side panel"). The rail and the narrow-window main-bar button reopen it ("Show side panel"). The `[` key is unchanged. |
| App name "UniHelperProMax" (Go to home) | Left card header, top-left. The rail shows the app mark (same link). |
| Page toolbar slot (calendar only) | Removed. The calendar renders `CalendarToolbar` at the top of its own page inside the main card. |
| "New class" (top-bar action) | Small "+" icon button beside the course list heading ("New class"), plus a "New class" button in `CalendarToolbar`. The `n` key on the calendar is unchanged. |
| Settings gear (top-bar action) | Left card footer (and rail footer): Settings icon button, same name "Settings", same route. |
| Account menu (dropdown, same items, Sign out) | Left card footer: "Account" button opening the same `DropdownMenu`, still named "Account menu", with the same registered items and sign-out guards. In the rail it is icon-only. |

The registries change to match. `registerTopBarAction` becomes `registerPanelAction({ slot:
"courses-heading" | "footer", … })`: the calendar routes register "New class" for
`courses-heading`, and settings registers its gear for `footer`. `CalendarToolbar` imports
`NewClassButton` directly, because both belong to the calendar/classes area. Accessible names stay
the same ("Account menu", "Settings", "New class") so existing tests and muscle memory keep working.

## R4 — Breakpoints, overlay mode and drawers

**Decision**: Introduce `WIDE_QUERY = "(min-width: 1100px)"` in `lib/useMediaQuery.ts` and use it
for every shell decision (it replaces `DESKTOP_QUERY` in `AppShell` and `WorkspacePage`).

- **≥ 1100 px (docked)**: the side cards are grid columns. The left card's closed state is the
  44 px rail (FR-011).
- **< 1100 px (overlay)**: both side cards are closed on load (FR-030), using in-memory state rather
  than the remembered wide-window states, which stay untouched. The left card is hidden completely
  (no rail). An "Show side panel" button sits at the left end of the main card's top bar. Opening
  a side card renders the same card component inside the existing `Sheet` (Radix Dialog) as a
  floating card, inset 8 px from the window edge, over the main card. The Sheet already supplies
  Escape-to-close, a focus trap and focus return to the opener (US7 scenario 2).
- **Workspace sections**: they are always portalled into the left card's section targets, whether
  the card is docked or in the overlay. This removes the workspace's own mobile drawer
  (`WorkspacePage` :474-489, :641-649) and the separate left toggle in the old header. When the
  overlay is closed the targets are unmounted, so the sections render nothing. This matches today's
  collapsed-panel behavior.
- **Split view**: availability stays at main width ≥ 1100 px (`SPLIT_MIN_WIDTH`), unchanged.

**Rationale**: 1100 px is the spec's threshold. At that width the docked minimums fit:
240 (left) + 480 (main) + 260 (audio) + 4 × 8 (gaps) = 1012 ≤ 1100. Reusing `Sheet` avoids a
second focus-management implementation.

**Alternatives considered**: Keep 1024 px as the breakpoint and add 1100 only for the overlay.
Rejected because two thresholds would create a 1024–1099 band with mixed behavior.

## R5 — Main card contents per page

- **Calendar**: `CalendarPage` drops `usePageToolbar`. Its card is a column: `CalendarToolbar` row
  (Today, Prev/Next, range label, "New class", view switcher, focus mode button) and then the grid.
- **Course page**: a slim header row with the left-open button (narrow only) and the focus mode
  button, then the existing content (`max-w-3xl`).
- **Settings, Accounts**: same slim header row. Their `h-[calc(100dvh-3.5rem)]` becomes `h-full`
  inside the card.
- **Session workspace**: exactly one fixed bar, the **tab row** (`h-10`, 40 px):
  `[Show side panel (narrow only)] [tabs… (scrolls horizontally)] [Live/Raw] [session chip]
  [split toggle] [Show audio panel (only when the audio card is closed)] [focus mode]`.
  `WorkspaceHeader.tsx` is deleted. The tabs region gets `overflow-x-auto` and `min-w-0`, while the
  right cluster is `shrink-0`, so many tabs never push controls out of view.
- Every `calc(100dvh-3.5rem)` becomes `h-full` / `min-h-0` within the card body.

**Height budget at 1366 × 768 (FR-028 / SC-001)**: the tab row is 40 px, which is 5.2 % of 768 and
inside the 10 % (76.8 px) limit. The 8 px card gaps are outside the main card. The note area gets
768 − 16 − 2 − 40 = 710 px, which is 92 % of the window height and above SC-001's 85 %.

## R6 — Session info chip

**Decision**: `features/sessions/SessionChip.tsx`, a compact `Button` (`variant="outline"`, `h-7`,
rounded-full) that shows a calendar icon, `EEE d MMM · HH:mm–HH:mm`, and an "Upcoming" badge from
`statusAt`/`useNow`, the same source as today. It opens a `Popover` with:

- the course, as a link to the course page (this replaces the old header's back link);
- the session title;
- the location (omitted when empty);
- the class links from the class's `links` list, opening in a new tab (the section is omitted when
  empty);
- the status: Upcoming / In progress / Past, plus "No longer scheduled" when it applies.

The accessible name includes the full date, for example "Session details: Friday 9 October
2026, 09:40–11:30, upcoming".

**Rationale**: Every piece of information the old header showed is still one action away, and
nothing new is fetched.

## R7 — Floating save indicator

**Decision**: Keep `StatusLabel` and its states (`saved | dirty | saving | error | conflict`). The
per-pane label in `NotePane` becomes an absolutely positioned chip (`absolute bottom-3 right-3`,
`bg-surface-elevated/90`, border, rounded-full, `aria-live="polite"`) in each editor pane. It uses
no layout space, and each split pane has its own. The tab labels stay as they are. Conflict
handling stays in `ConflictDialog`, so the chip gains no actions (FR-017 "same states and any
actions it offers today"). The editor's scroll area gets bottom padding equal to the chip height
plus the pill stack height (R8), so the last line can always be scrolled out from under the
floating elements.

## R8 — Activity pills (clarification Q2)

**Decision**: `ActivityBar.tsx` → `app/shell/ActivityPills.tsx`, rendered inside the main card as
an absolutely positioned stack (`absolute inset-x-0 bottom-3 flex flex-col items-center gap-2
pointer-events-none`). Each pill is `pointer-events-auto`, rounded-full, card-surface background,
border and a small shadow. `RecordingBar` and `TranscriptionBar` get a compact pill layout with the
same contents: elapsed time or progress, label (truncated), "Go to session", Stop/Cancel. They are
stacked with recording above transcription (registry priority). The stack's max width is
`calc(100% - 2 × 8rem)`, which keeps the bottom-right save chip clear. At the 480 px minimum this
leaves 224 px, so the label truncates first and the buttons stay. A `ResizeObserver` on the stack
publishes `--pills-h` to the main card so scroll areas can pad their bottom (R7). The stack is part
of the main card, so it stays visible in focus mode, with the audio card closed, and on the
calendar and course pages. The `role="region" aria-label="Activity"` landmark is kept.

## R9 — Audio card header and the reopen indicator

**Decision**:

- **Header**: `RecordingPanel`'s header row becomes the audio card header: "Audio" title (h2),
  Record, Upload, and a close button ("Hide audio panel"). The close button comes from a small
  context (`useAudioCardControls()` from `WorkspacePage`), so the recordings feature does not import
  the workspace. The rest of the panel is unchanged. "Collapsing" the audio card is closing it
  (spec FR-021).
- **Reopen button**: "Show audio panel", shown in the tab row when the audio card is closed. It
  reads the existing recorder store (`status === "recording" | "stopping"`) and the transcription
  job store (any running job). While recording it shows a pulsing `danger` dot. While transcribing it
  shows a small spinning ring in `accent` (static under reduced motion). The two are visually
  distinct, are not conveyed by color alone, and the button's accessible name gains ", recording in
  progress" / ", transcription running".
- **Alt+]**: keeps toggling the audio card.

## R10 — Focus mode

**Decision**:

- **State**: shell context (`app/shell/layout.tsx`) holding `focus: null | { left, right }`. Entering
  saves the current left and right open states and hides both side cards (including the rail).
  Leaving restores the snapshot. The snapshot is held in memory only (spec assumption: not
  persisted). On reload the remembered states apply.
- **Shortcut**: bare `\` (Backslash), handled on `window`. It is ignored with any modifier and while
  typing (`hasModifier` / `isTypingTarget`, the same style as `[` and `/`).
  - Conflict check: Alt+\ (split view) needs Alt and stays distinct. CodeMirror, the PDF reader, the
    player and the calendar do not bind bare `\`. No browser binds bare `\`.
  - The PDF reader's container is not a typing target, so `\` works there; inside annotation text
    editors it is typed as text.
- **Button**: "Enter focus mode" / "Leave focus mode" (`ArrowsIn`/`ArrowsOut` icon,
  `aria-pressed`, `aria-keyshortcuts="Backslash"`) at the right end of every main card top bar
  (tab row, calendar toolbar, slim header).
- **Interactions**: entering closes any open overlay (narrow window). Leaving restores the snapshot.
  On a narrow window that is "both closed" (spec edge case). Focus-mode changes are not written to
  the remembered states: `uh.panel.collapsed` and `workspaceRightCollapsed` are only written by
  explicit open/close actions, never by focus mode.

**Alternatives considered**:
- Mod+Shift+F: conflicts with browser full-screen or search on some platforms.
- F11: the browser's own full-screen key.
- Alt+F: opens the browser menu on Windows.

## R11 — Widths and the 480 px minimum

**Decision**: The shell grid template is
`[left] var(--left-eff) [main] minmax(480px, 1fr) [right] var(--right-eff)`, where the effective
widths are derived in one pure function `layoutWidths(viewport, prefs)` in `app/shell/widths.ts`
(unit-tested):

- Left: 44 (rail) or clamp(240, stored, 480).
- Right: 0 or clamp(260, stored, 640).
- If `left + right + 480 + gaps > viewport`, shrink right first, then left, down to their minimums.
  At ≥ 1100 px this always resolves. Stored preferences are never overwritten by this clamp.

Resize handles (`PanelResizeHandle`) get a `limit()` from the same function, so pointer and
keyboard resizing stop at the 480 px main minimum. `EDITOR_MIN 360` is removed in favor of the
480 px main minimum. Inside the main card, the workspace's split view keeps its own 20–80 % ratio.

## R12 — Card open/close animation and reduced motion

**Decision**:
- **Docked**: animate `grid-template-columns` with `transition-[grid-template-columns]
  duration-200 ease-out`. The left card swaps open → rail; the right card goes from width → 0, with
  the card content kept from wrapping by `min-w-0` and an inner fixed-width wrapper during the
  transition.
- **Overlay**: the Sheet's slide/fade durations are set to 200 ms.
- **Reduced motion**: `index.css` already reduces all transitions and animations to 0.01 ms under
  `prefers-reduced-motion: reduce`, so the change is instant (FR-037). Grid column transitions are
  supported in all evergreen browsers the project targets.

## R13 — Landmarks, names and focus

- **Left card**: `<aside aria-label="Side panel" id="course-panel">` (existing id and name kept).
  The rail is the same landmark in its closed form.
- **Main card**: `<main id="main" aria-label="Workspace">`. `<main>` already exists; it gets a label.
- **Right card**: `<aside aria-label="Audio" id="workspace-audio-panel">`, now a sibling of
  `<main>` and no longer nested in it.
- **Icon-only buttons**: every one has an `aria-label` and a tooltip: rail buttons, "+" New class,
  close buttons, the reopen buttons, the focus mode button, and the Settings and Account icons in
  the rail.
- **Focus on close (FR-038)**: when a card closes while `document.activeElement` is inside it, focus
  moves to its reopen control. For the left card that is the rail's "Show side panel" button
  (docked) or the main-bar button (narrow). For the audio card it is the tab row's "Show audio
  panel". When focus mode hides the cards, focus moves to the focus mode button.
- **Focus visibility near the 14 px radius**: card bodies use `p-2` inner padding (FR-003), so
  `focus-visible` rings (2 px + 2 px offset) are not clipped by `overflow-hidden`. Scroll
  containers use `scroll-padding` so a focused row scrolls fully into view.

## R14 — Theme colors (clarification Q1)

**Decision**: There are no new tokens, and the theme data, API, editor list and export are
unchanged. The mapping is:

- Window background = `--surface` ("Background").
- Card surface = `--surface-elevated` ("Surface / card").
- Card border = `--border` ("Border").
- The editor inside notes keeps `--editor-surface`, which equals `surface-elevated` in both
  built-ins.

The boundary warning (FR-041) already exists: `CONTRAST_PAIRS` contains `pair("border", "surface",
3)`, rendered by `ThemeEditor` the same way as the other warnings. We add an explanatory suffix to
its label ("— card edges") so the warning says why it matters. The 3:1 threshold is the WCAG
non-text contrast minimum. Both built-ins pass: light `#85858d` on `#f8f8f9` ≈ 3.5:1, dark
`#6c6c75` on `#131316` ≈ 3.6:1.

**Background repaints**: components that paint `bg-surface` inside a card would now paint the window
color inside the card. Examples are the side panel root, `SessionTimeline`'s sticky month heading
and the audio `aside`. They are switched to `bg-surface-elevated` (or transparent). An audit task
covers every `bg-surface` inside the three cards.

**Risk (noted)**: The built-in "Border" is a 3:1 line by design. It reads stronger than the faint
lines in the mockups. FR-044 allows tuning built-in values within the existing colors if the visual
review (SC-010) asks for it, but `border` must stay ≥ 3:1 because inputs rely on it. We will not
substitute `divider`, because that would contradict clarification Q1.

## R15 — Testing strategy

- **Vitest (unit)**:
  - `layout-widths.test.ts`: clamp rules, 480 px minimum, shrink order, rail.
  - `focus-mode.test.tsx`: snapshot and restore for all 4 left × right combinations (SC-004), no
    writes to stored prefs, the `\` key ignored while typing and with modifiers.
  - `session-chip.test.tsx`: upcoming marker, details content, empty location/links omitted.
  - `audio-reopen.test.tsx`: the indicator for recording vs transcription.
  - `activity-pills.test.tsx`: stacking and order.
  - `theme-colors.test.ts`: the border/surface warning label.
  - Existing `course-panel`, `panel-resize-handle`, `workspace-tabs`, `timeline` and
    `no-hardcoded-colors` tests are updated or kept green.
- **Playwright (e2e)**: a new `layout.spec.ts` at 1366 × 768 in the light and dark projects:
  - card count, radius, gaps and no window scroll;
  - tab row height ≤ 76.8 px;
  - main card ≥ 480 px while resizing;
  - rail contents;
  - focus mode by key and button;
  - pills on the calendar during a recording;
  - the reopen indicator;
  - the overlay at 1000 px with Escape and focus return;
  - the 1366 → 1000 → 1366 resize round trip.

  `responsive.spec.ts` moves from 390 × 844 (out of scope now) to 900 × 700 overlay behavior.
  `side-panel.spec.ts`, `a11y-themes.spec.ts` (axe on the calendar, course page and workspace,
  landmarks present, SC-008), `settings.spec.ts`, `accounts.spec.ts`, `notes.spec.ts`,
  `workspace-switch.spec.ts`, `recording.spec.ts` and `transcription.spec.ts` are updated for the
  removed header, the moved controls and the pills.
- **Shortcut inventory (SC-002)**: `contracts/ui-layout.md` lists every action and shortcut before
  and after the change. The e2e spec walks the list.
- **Backend**: no changes, so no backend tests change. The constitution's critical-flow integration
  tests keep running unchanged.
