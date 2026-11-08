# Implementation Plan: Yuii Guided Tour

**Branch**: `023-yuii-guided-tour` | **Date**: 2026-11-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/023-yuii-guided-tour/spec.md`

## Summary

A hands-on product tour led by the mascot Yuii. It runs as one lazily loaded frontend feature
(`features/tour/`): a static list of ~40 steps in 7 chapters, a small engine (step index,
navigation, waiting for user actions), and an overlay that dims the app, cuts a highlight hole
around the target, and places a large Yuii beside it with a speech bubble. Her pose is picked
from the direction to the target and mirrored with CSS for right-facing variants. Targets are
marked with `data-tour` attributes; hands-on steps complete when existing success handlers emit
a tour event. The only backend change is a `tour` key in the existing per-user preferences
(status + chapter), which gives first-run, replay and cross-device behaviour. No new dependency,
table, endpoint or migration.

## Technical Context

**Language/Version**: Python 3.12+ (FastAPI, Pydantic 2); TypeScript with React 19 (Vite,
TanStack Query 5, react-router, shadcn/ui on Radix).

**Primary Dependencies**:
- **New**: none (frontend or backend).
- **Reused**: `motion` (v14, already installed) for movement and `useReducedMotion`; shell
  registry (`registerGlobalHost`, `registerPanelAction`), `useLayout`; preferences hooks
  (`usePreferences`, `useUpdatePreferences`); shadcn `Button`, `DropdownMenu`, `Tooltip`,
  `AlertDialog`.

**Storage**: `ui_preferences.data` JSON gains `tour: {status, chapter}` (no migration; default
applied on read). Artwork bundled as static assets.

**Testing**: pytest contract tests for the preference key; Vitest + Testing Library + axe for
placement maths, engine transitions, event bus, overlay a11y; Playwright `tour.spec.ts` for the
first-run → create course → finish → no auto-start flow. Existing e2e login helper marks the tour
completed (research R12).

**Target Platform**: Browser and the Electron desktop app (same frontend).

**Project Type**: Web application (backend + frontend) wrapped by desktop.

**Performance Goals**: Step change (including route change and target lookup) under 500 ms on a
typical machine; tour code and art load only when the tour starts (separate chunk, ~1.5 MB of
images fetched lazily per pose).

**Constraints**: Tour never creates/changes/deletes data itself (FR-013); never blocks a modal
form the user is filling (research R5); theme tokens only; reduced motion respected; keyboard
operable; Yuii never covers the target (FR-025).

**Scale/Scope**: 7 chapters, ~40 steps, ~20 `data-tour` targets, ~8 tour event emit points,
16 images.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. User work never lost | Tour only guides real actions; creation goes through the normal forms with their autosave/chunked upload; skipping changes nothing (FR-013). Destructive actions are not part of the tour. | Pass |
| II. Data ownership & open formats | No new user files; tour state is a preference (metadata). | Pass |
| III. Frontend/backend separation | Uses existing `/api/v1/preferences`; additive key, no version bump; contract documented in `contracts/preferences-tour.md` and the 002 OpenAPI. | Pass |
| IV. Providers & secrets | AI steps only read whether a provider exists; no keys touched. | Pass |
| V. UI quality & a11y | shadcn primitives for buttons/menus; theme tokens (`--overlay`, `--ring`, `--popover`); keyboard map and ARIA in `contracts/tour-ui.md`; axe tests; reduced motion. Design per `design-taste-frontend`. | Pass |
| VI. Tests | Preferences endpoint: success + each 422 case. Critical flow (first-run tour) covered by Playwright. | Pass |
| VII. Simplicity & spec discipline | No new dependency (own ~small engine instead of a tour library, research R2); no new abstraction beyond one feature folder and a 20-line event bus. | Pass |
| VIII. Desktop data safety | No change to data folder handling. | Pass |

**Post-design re-check (after Phase 1)**: still passes. The design adds one preference key, one
frontend feature folder, `data-tour` attributes and emit calls in existing files.

## Project Structure

### Documentation (this feature)

```text
specs/023-yuii-guided-tour/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── preferences-tour.md
│   └── tour-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/unihelper/
│   ├── schemas/notes.py                 # Preferences.tour (TourState model)
│   └── services/workspace_service.py    # DEFAULT_PREFERENCES["tour"]
└── tests/contract/test_preferences.py   # tour cases

specs/002-course-session-notes/contracts/openapi.yaml   # Preferences.tour schema

frontend/
├── openapi.json, src/lib/api/schema.d.ts               # regenerated
├── src/features/tour/
│   ├── routes.tsx          # registers global host + rail button (imported in app/features.ts)
│   ├── TourHost.tsx        # auto-start rules, lazy-loads the overlay
│   ├── TourProvider.tsx    # engine: step index, context, mode, persistence of status/chapter
│   ├── TourOverlay.tsx     # backdrop + highlight hole, Yuii, bubble, controls
│   ├── TourButton.tsx      # rail/footer button + chapter menu
│   ├── placement.ts        # place(targetRect, viewport) → side, size, pose, bubble
│   ├── steps.ts            # chapters, steps, speech text
│   ├── targets.ts          # TargetId union
│   ├── events.ts           # tourEvents bus
│   └── assets/             # copied Yuii art (pointing PNGs + expression WebPs)
├── src/features/** (existing)  # data-tour attributes + tourEvents.emit(...) at success/error paths
├── src/features/settings/account/AccountSettings.tsx   # "Replay tour with Yuii"
├── tests/unit/tour/        # placement, engine, events, overlay a11y
└── tests/e2e/
    ├── tour.spec.ts
    └── helpers.ts          # signIn marks tour completed (except tour.spec)
```

**Structure Decision**: Existing web-application layout. All tour logic is one new frontend
feature folder that plugs into the shell registry like other features; the backend change is
limited to the preferences schema and default.

## Complexity Tracking

No constitution violations to justify.
