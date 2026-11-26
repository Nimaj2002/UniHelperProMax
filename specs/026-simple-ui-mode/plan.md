# Implementation Plan: Simple UI Mode

**Branch**: `026-simple-ui-mode` | **Date**: 2026-11-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/026-simple-ui-mode/spec.md`

## Summary

Add a second, selectable interface named **Simple** beside the current one, renamed **Ultimate** in
the UI only. The choice is one new optional field, `uiMode`, on the existing per-user
`/api/v1/preferences` object (no migration, no new endpoint, no new table). `AppShell` reads it and
renders either the existing shell (unchanged) or a new `SimpleShell`: one left sidebar + one main
area, over the **same route tree and URLs**, so pages, deep links and background hosts (recording,
transcription, chat streaming, tour) keep working and survive a switch.

Simple's sidebar has two modes. **General**: Calendar (landing, `/`), Courses, Tasks, AI chat,
Settings/account at the bottom. **Session** (when a class session or event is open): Calendar plus
the tools Ultimate keeps in its right panel (Recordings, Chat, Teacher, Time) and the session's
Notes and PDFs, with a back link to the general sidebar. In a session the main area shows
Ultimate-style workspace tabs; sidebar entries open or focus a tab. `Courses` opens a new
`/courses` page: a Moodle-style grid of course boxes that open the existing `/courses/:courseId`.
Graph is not part of Simple.

## Technical Context

**Language/Version**: TypeScript / React 19 (frontend), Python 3.12 (backend, one schema field)

**Primary Dependencies**: existing only: React Router, TanStack Query, shadcn/ui (Sidebar-style
composition from `Sheet`, `Button`, `ScrollArea`, `Collapsible`, `Tooltip`), Phosphor icons. **No new dependencies.**

**Storage**: unchanged. `uiMode` lives in the existing `ui_preferences.data` JSON (per user); sidebar
collapsed state is a per-browser convenience in `localStorage` (`readLocal`/`writeLocal`, like the
Ultimate panel widths). No migration.

**Testing**: pytest contract + unit test for the `uiMode` preference (default absent → Ultimate,
accepts `ultimate|simple`, rejects other values, persists per user); Vitest + Testing Library + axe
for `SimpleShell`, sidebar (general/session), Courses grid, switch controls; Playwright e2e: switch
Ultimate↔Simple, persistence across reload, open a session in Simple and reach notes/PDF/recording/
chat, narrow-viewport drawer; the demo e2e covers Simple in demo mode.

**Target Platform**: browsers, Electron desktop app, browser demo build (024).

**Project Type**: web application (backend + frontend) with desktop wrapper.

**Performance Goals**: switching interface re-renders in under 1 s without reloading data (queries
stay cached); no refetch of the course tree on switch.

**Constraints**: Ultimate must be pixel/behaviour-identical when `uiMode` is absent or `ultimate`
(regression risk is the main constraint); single process; theme tokens only; fully keyboard
operable; the normal build must still pass `check:no-demo`.

**Scale/Scope**: 1 backend schema field; frontend: 1 shell, ~8 components, 1 new page (`/courses`),
a `uiMode` provider/hook, and a session-presentation variant in `WorkspacePage`.

## Constitution Check

| Principle | Status |
|---|---|
| I. Work never lost | PASS. Switching only swaps the shell; open note editors autosave and flush on unmount as they already do; recordings/transcription run in global hosts that live outside either shell; switch is blocked from discarding drafts (same guard as navigation). |
| II. Open formats / layout | N/A. No files touched. |
| III. Frontend/backend separation | PASS. Only `/api/v1/preferences` gets an additive optional field (non-breaking, same API version). |
| IV. Providers/secrets | N/A. |
| V. UI quality & accessibility | PASS (to verify in tasks): shadcn primitives, theme tokens only, landmarks (`nav`, `main`), keyboard drawer, AA in all themes; design follows `design-taste-frontend`. |
| VI. Tests | PASS (planned): contract + unit for the field; component, axe and e2e tests above. |
| VII. Simplicity & spec discipline | PASS. No new dependency, table, endpoint or abstraction beyond one shell component and one preference. |
| VIII. Desktop data safety | PASS. No data-folder or installer change. |

Re-check after design: unchanged, still PASS.

## Project Structure

### Documentation (this feature)

```text
specs/026-simple-ui-mode/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/openapi.yaml
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
backend/
├── src/unihelper/schemas/notes.py          # Preferences: + ui_mode: Literal["ultimate","simple"] | None
└── tests/{unit,contract}/…preferences…     # field default/validation/persistence

frontend/
├── openapi.json, src/lib/api/schema.d.ts   # regenerated (gen:api)
└── src/
    ├── app/
    │   ├── uiMode.tsx                       # useUiMode(): reads/writes preferences.uiMode (optimistic)
    │   ├── shell/AppShell.tsx               # picks Ultimate (existing body) or <SimpleShell/>
    │   └── simple/
    │       ├── SimpleShell.tsx              # sidebar + main, drawer on narrow, collapse, hosts
    │       ├── SimpleSidebar.tsx            # general and session variants
    │       ├── sidebarModel.ts              # pure: ordered general/session entries from route + registries
    │       └── UiModeSwitch.tsx             # shared control used in settings and both account menus
    ├── features/
    │   ├── courses/CoursesGridPage.tsx      # new /courses route (Moodle-style cards, filter)
    │   ├── tasks/…                          # /tasks route for Simple (existing board components)
    │   ├── sessions/WorkspacePage.tsx       # presentation variant: no right card in Simple
    │   └── settings/themes/AppearanceSettings.tsx  # + Interface section (UiModeSwitch)
    └── demo/handlers/bootstrap.ts           # demo preferences already merge any field (no change expected)
```

**Structure Decision**: web application, extending the existing frontend shell layer; no new
top-level projects. Both shells render the same `featureRoutes` Outlet.

## Complexity Tracking

No constitution violations. The one structural risk, `WorkspacePage` (1,100 lines) being coupled to the shell's right card, is handled by a small presentation switch rather than a fork (see research R3).
