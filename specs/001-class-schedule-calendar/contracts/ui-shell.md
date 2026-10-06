# Contract: App Shell, Routes & Extension Points

The authenticated shell built in 001 and the seams later features plug into. Visual decisions
follow the taste-skill (`design-taste-frontend`) with dials `4 / 3 / 6` (see research R10).

## Layout (desktop ≥ 1024 px)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ TopBar: [≡ panel] UniHelperProMax   ‹ Today ›  Oct 5 – 11, 2026   [D|W|M]  [+ New class] [account ▾] │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ CoursePanel   │ Main outlet                                                  │
│ 280 px        │  /calendar → CalendarView (≈ 75–80 % of width)               │
│ [search…]     │  /courses/:courseId → course page (placeholder in 001; 002)  │
│ 2026  ⠿       │  /settings/* → settings (005)                                 │
│  Fall 2026    │  /admin/accounts → owner only                                │
│   ● CS 201    │                                                              │
│   ● MATH 203  │                                                              │
├───────────────┴──────────────────────────────────────────────────────────────┤
│ ActivityBar slot (empty in 001; 003 renders the recording bar here)          │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **CoursePanel**: resizable 240–480 px (default 280; drag the edge or ←/→ on the focused edge), collapsible (`[` shortcut and button); collapsed state
  remembered per browser. Below `lg` (1024 px) it becomes a shadcn `Sheet` drawer and the calendar
  defaults to day view (spec assumption).
- **Page section in the side panel** (added later, used by 002): a page can show a collapsible
  section under the courses (002's "Sessions and notes"); its height is draggable and remembered
  per browser.
- **CalendarView** fills the remaining width; the time grid scrolls vertically inside the view, the
  header (dates, all-day row) stays fixed. Default: week view of the current week, scrolled to
  07:00 or the first session of the week, current-time line shown.
- Height uses `min-h-[100dvh]` / grid rows, never `h-screen` (taste-skill §3.E).

## Routes

| Path | Component | Feature |
|---|---|---|
| `/setup` | Owner setup (only while `needsOwner`) | 001 |
| `/login` | Sign in | 001 |
| `/account/password` | Change password (forced when `mustChangePassword`) | 001 |
| `/calendar/:view?/:date?` | Calendar (`view` ∈ day/week/month, `date` = YYYY-MM-DD) | 001 |
| `/classes/new?date=&start=&end=` | Class form dialog over the calendar | 001 |
| `/sessions/:sessionKey` | Session details popover/dialog over calendar | 001 |
| `/courses/:courseId` | Course page — placeholder identifying the course in 001 | 001 → 002 |
| `/courses/:courseId/sessions/:sessionKey` | Session workspace | 002 |
| `/settings/:section?` | Settings | 005 |
| `/admin/accounts` | Account management (owner) | 001 |

Guards: unauthenticated → `/login` (or `/setup` when `needsOwner`); `mustChangePassword` →
`/account/password`; `/admin/*` requires `role = owner`.

## Extension points

| Seam | Contract | Used by |
|---|---|---|
| Feature route modules | Each feature exports `routes: RouteObject[]` from `src/features/<name>/routes.tsx`; the router composes them under `AppShell` | 002, 005 |
| `ActivityBar` slot | Shell renders registered activity components (`registerActivity({ id, component, priority })`); visible on every authenticated screen | 003 recording bar, 004 transcription progress |
| `CoursePanel` item adornments | Optional per-course badge renderer (e.g. note count) | 002 |
| Session details actions | Session popover renders registered actions (`registerSessionAction`) beneath edit/delete | 002 "Open workspace" |
| Theme tokens | All colours — including the 12 class colours as `--event-<key>-bg/fg/border` — come from CSS variables in `src/styles/tokens.css`; no colour literals anywhere else in `src/` (enforced by a test); `palette.ts` holds only keys and `var(--event-…)` references; `ThemeProvider` sets `data-theme` = `light` \| `dark` from system preference in 001 | 005 adds user themes by supplying token values, including class colours |
| API client | `src/lib/api` — generated types + `apiFetch` (CSRF, problem+json → `ApiError`) | all |
| Query keys | `['sessions', from, to, courseId?]`, `['course-tree', q]`, `['course', id]`, `['me']` | all |

## Interaction & accessibility contract (FR-027, SC-006)

- Year reordering (FR-022a): drag handle on each year row plus "Move up" / "Move down" in the
  year's menu (also `Alt+↑` / `Alt+↓` while the year row is focused); the moved year keeps focus
  and a live region announces "2026 moved to position 2 of 3".
- Keyboard: `t` today; `d`/`w`/`m` views; `←`/`→` previous/next period; `n` new class; `/` focus
  course search; `[` toggle panel; arrow keys move the roving focus across days/time slots;
  `Enter` on a slot opens a pre-filled class form; `Enter` on an event opens details; `Esc` closes
  dialogs and returns focus to the trigger. Shortcuts are listed in a `?` help dialog and are
  ignored while typing in inputs.
- Event blocks: `role="button"`, accessible name "CS 201 Lecture, Monday 5 October, 10:00 to 11:30,
  FENS G032". Month "+N more" is a button opening a popover list.
- Colour never carries meaning alone; focus rings use `--focus-ring` with ≥ 3:1 contrast.
- All text/background token pairs and every class-colour preset (`--event-<key>-fg` on
  `--event-<key>-bg`) meet WCAG AA in light and dark, verified by automated tests (axe + a token
  contrast unit test).
- Motion: short opacity/translate transitions only (≤ 200 ms), disabled under
  `prefers-reduced-motion`.
