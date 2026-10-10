# Implementation Plan: Floating Card Layout

**Branch**: `008-floating-card-layout` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-floating-card-layout/spec.md`

## Summary

Frontend-only re-layout of the app shell into up to three floating cards on the theme's Background
color:

- **Left card**: the side panel with the top bar's controls folded into it, closing to a 44 px
  rail.
- **Main card**: the page.
- **Right card**: the session's audio panel, moved up from the workspace into the shell through a
  slot.

`TopBar`, `WorkspaceHeader` and the full-width `ActivityBar` are removed. Their controls move to:

- the left card header and footer;
- a single 40 px workspace tab row with a session chip and a "Show audio panel" button (with a
  recording/transcription indicator);
- floating activity pills at the bottom center of the main card.

The rest of the design:

- One grid enforces the 8 px gaps and the 480 px main minimum.
- Below 1100 px the side cards are closed and open as floating overlays (existing `Sheet`).
- Focus mode (bare `\` + button) hides both side cards and restores them from an in-memory
  snapshot.
- Colors map to existing tokens (Background / Surface / card / Border). The existing border-on-
  background contrast check becomes the card-edge warning.
- There are no backend, API, data or theme-format changes.

## Technical Context

**Language/Version**: TypeScript 5.9 / React 19 (frontend). Backend Python 3.12 is untouched.

**Primary Dependencies**: Existing only: Tailwind CSS 4.3, shadcn/ui (Radix) primitives (`Sheet`,
`Popover`, `DropdownMenu`, `Tooltip`, `Button`, `Badge`), `@phosphor-icons/react`, `motion`
(already used for reduced-motion-aware calendar fades). **No new dependencies.**

**Storage**: None new. Existing localStorage layout keys (`uh.panel.*`, `uh.workspace.rightWidth`)
and the existing account preference `workspaceRightCollapsed` are reused unchanged. Focus mode and
overlay state are in memory ([data-model.md](./data-model.md)).

**Testing**: Vitest + vitest-axe (unit), Playwright + @axe-core/playwright (e2e; chromium-light and
chromium-dark projects). Backend pytest stays green, unchanged.

**Target Platform**: Evergreen desktop browsers, window widths ≥ 800 px (below is out of scope).

**Project Type**: Web application (existing `backend/` + `frontend/`); this feature touches
`frontend/` only.

**Performance Goals**:
- Card open/close ≤ 200 ms.
- Theme switch < 100 ms (SC-009; CSS variables only).
- Resize drags stay at 60 fps (rAF + CSS variables, as today).
- No extra network requests.

**Constraints**:
- 8 px gaps, 14 px radius.
- Main card ≥ 480 px.
- Fixed bars ≤ 10 % of the viewport height at 1366 × 768.
- Overlay below 1100 px.
- All existing shortcuts keep their meaning.
- Theme tokens only (`no-hardcoded-colors` test).
- Constitution v1.1.0, Principles I and V.

**Scale/Scope**:
- ~6 pages hosted in the main card: calendar, course, workspace, settings, accounts, overlay routes.
- ~20 frontend files changed or added.
- Up to 50 open tabs in the tab row (007).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 008 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Save state stays visible; recording never hidden or stopped by layout actions | PASS | PASS — `StatusLabel` is kept as a floating chip per pane with the same states (R7). Recording and transcription pills are visible on every page and in focus mode (R8). "Show audio panel" carries the activity indicator (R9). Closing cards never touches the recorder. |
| II. Data ownership | No change to files or DB | N/A | N/A — no data changes |
| III. Separation | No new endpoints; frontend uses only `/api/v1` | PASS | PASS — reuses `GET/PATCH /preferences`. No contract change, no `schema.d.ts` regeneration. |
| IV. Transcription | Untouched | N/A | N/A — Cancel keeps its existing action |
| V. UI quality | shadcn primitives; design-taste guidance; light/dark/custom themes via tokens; full keyboard access; visible focus; AA; editor warns on failing themes | PASS | PASS — composed from `Sheet`/`Popover`/`DropdownMenu`/`Tooltip`/`Button`. Colors are existing tokens only (R14). Landmarks, names and shortcut inventory are in [contracts/ui-layout.md](./contracts/ui-layout.md). Focus return on close (R13). Reduced motion via the existing global rule (R12). The card-edge warning reuses the existing 3:1 border pair. Visual decisions to be checked against `.claude/skills/design-taste-frontend`. |
| VI. Tests | Endpoint and critical-flow tests stay green | PASS | PASS — backend untouched. New unit and e2e coverage per research R15. Merge gate: UI verified in light, dark and keyboard-only. |
| VII. Simplicity / spec discipline | No new deps or infra; in-spec only | PASS | PASS — zero new dependencies. One new shell slot generalizes the existing `toolbar.tsx` instead of adding a layer. Clarified scope only (no rail below 1100 px, pills, existing colors). |

**Result**: all gates pass. Complexity Tracking is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/008-floating-card-layout/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ui-layout.md       # landmarks, names, geometry, shortcut + action inventory
├── checklists/requirements.md
└── tasks.md                     # next: /speckit-tasks
```

### Source Code (changes, `frontend/` only)

```text
frontend/src/
├── lib/useMediaQuery.ts                 # + WIDE_QUERY (min-width: 1100px), replaces DESKTOP_QUERY in shell/workspace
├── index.css                            # html/body/#root no window scroll; card utilities if needed
├── app/shell/
│   ├── AppShell.tsx                     # single grid: left | main | right; overlay Sheets; focus mode; no TopBar/ActivityBar rows
│   ├── Card.tsx                         # NEW rounded bordered card (clip, own scroll, inner padding)
│   ├── LeftCard.tsx                     # NEW (from SidePanel): header (name + hide), search/courses, sections, footer (Account, Settings)
│   ├── Rail.tsx                         # NEW 44 px closed form: show, mark, Account, Settings
│   ├── AccountMenu.tsx                  # moved out of TopBar (same items, same "Account menu" name)
│   ├── layout.tsx                       # NEW layout context: mode, overlay, focus snapshot, open/close + focus return
│   ├── widths.ts                        # NEW pure layoutWidths() + resize limits (480 px main minimum)
│   ├── slots.tsx                        # NEW (replaces toolbar.tsx): right card slot
│   ├── MainBarControls.tsx              # NEW "Show side panel" (narrow) + focus mode button, used by every page's top bar
│   ├── ActivityPills.tsx                # NEW (replaces ActivityBar.tsx): floating stack, publishes --pills-h
│   ├── registry.ts                      # registerTopBarAction → registerPanelAction({ slot })
│   ├── panelSection.tsx                 # bg-surface → card surface; otherwise unchanged
│   ├── TopBar.tsx · ActivityBar.tsx · toolbar.tsx   # DELETED
├── components/PanelResizeHandle.tsx     # unchanged API; limits supplied by widths.ts
├── features/
│   ├── courses/CoursePanel.tsx          # "Courses" heading + panel-action slot ("New class" +)
│   ├── courses/CoursePage.tsx           # h-full in card; slim top bar with MainBarControls
│   ├── calendar/CalendarPage.tsx        # toolbar rendered in-page; h-full
│   ├── calendar/CalendarToolbar.tsx     # + NewClassButton, + MainBarControls
│   ├── calendar/routes.tsx              # register "New class" for courses-heading slot
│   ├── settings/routes.tsx · SettingsLayout.tsx   # gear → footer slot; h-full + slim bar
│   ├── admin/AccountsPage.tsx           # h-full + slim bar
│   ├── settings/themes/colors.ts        # border/surface pair label "— card edges"
│   ├── sessions/
│   │   ├── WorkspacePage.tsx            # no header/AudioColumns/drawer; tab row bar; right-card slot; sections always portalled
│   │   ├── WorkspaceHeader.tsx          # DELETED
│   │   ├── SessionChip.tsx              # NEW chip + details popover
│   │   ├── AudioReopenButton.tsx        # NEW "Show audio panel" with recording/transcription indicator
│   │   ├── WorkspaceTabs.tsx            # h-10 row; horizontal scroll; right cluster
│   │   ├── NotePane (in WorkspacePage)  # floating save chip; bottom scroll padding (chip + --pills-h)
│   │   ├── SessionTimeline.tsx          # sticky month header bg → card surface
│   │   └── useWorkspaceKeyboard.ts      # Alt+[ / Alt+] route through layout context (meaning unchanged)
│   ├── recordings/RecordingPanel.tsx    # header row = audio card header (+ close from context)
│   ├── recordings/RecordingBar.tsx      # pill layout, same contents
│   └── transcription/TranscriptionBar.tsx # pill layout, same contents
frontend/tests/
├── unit/layout-widths.test.ts · focus-mode.test.tsx · session-chip.test.tsx
├── unit/audio-reopen.test.tsx · activity-pills.test.tsx · theme-colors.test.ts (updated)
└── e2e/layout.spec.ts (NEW) · responsive.spec.ts (→ 900×700 overlay) · side-panel, a11y-themes,
    settings, accounts, notes, workspace-switch, recording, transcription specs (updated)
```

**Structure Decision**: The shell owns the card grid, layout state and focus mode in `app/shell/`.
Features keep owning their content and plug in through the existing registry/portal patterns
(panel sections, panel actions, and the new right-card slot), so no feature imports another
feature's layout. No backend files change.

## Phase 0 — Research

Complete: [research.md](./research.md) (R1–R15). The spec had no open clarification markers after
`/speckit-clarify`. The research settles:

- R4: the 1100 px breakpoint unification;
- R10: the focus key `\`;
- R11: width clamping;
- R14: the card-edge warning threshold (the existing 3:1 pair);
- R3: where each top-bar control moves.

## Phase 1 — Design

- [data-model.md](./data-model.md): client-side layout state only (stored keys unchanged; overlay
  and focus in memory).
- [contracts/ui-layout.md](./contracts/ui-layout.md): geometry, landmarks, control names, top bars
  per page, the shortcut inventory, and the before → after action inventory (SC-002).
- [quickstart.md](./quickstart.md): automated commands and the manual walkthrough per user story.
- No OpenAPI change, so there is no API contract file.

### Post-design Constitution re-check

All gates still pass (table above, "Post-design" column). Two items are watched during
implementation:

1. **Contrast of the Border color**: the built-in `--border` meets 3:1 but is stronger than the
   mockups' lines. If the visual review asks for tuning, it must stay ≥ 3:1 (R14).
2. **Tab row width at the 480 px minimum**: the right cluster can reach ≈ 300 px, so the tabs region
   relies on horizontal scrolling. The chip may drop its time range below a container width of
   about 640 px, but it keeps the full name.

## Complexity Tracking

Not needed: no constitution violations.
