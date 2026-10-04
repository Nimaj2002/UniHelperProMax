# Validation Record: Class Schedule Calendar (001)

**Date**: 2026-10-04
**Build**: backend `unihelper 0.1.0`, frontend `unihelper-frontend 0.1.0` (production bundle built)

## Automated checks (quickstart.md)

| Check | Result |
|---|---|
| `ruff check .` | ✅ pass |
| `mypy` (strict, 50 source files) | ✅ pass |
| `pytest` — unit, contract (every endpoint), integration | ✅ 138 passed; contract-coverage guard: every documented operation exercised with a 2xx |
| Live API vs `contracts/openapi.yaml` (26 paths) | ✅ identical operation sets |
| `eslint .` | ✅ pass |
| `tsc -b --noEmit` (app, tests, configs) | ✅ pass |
| `vitest` (components, axe, token contrast, no hard-coded colours) | ✅ 185 passed |
| `playwright` — light + dark projects | ✅ 14 passed (7 specs × 2 themes) |
| Production single process (`UNIHELPER_STATIC_DIR`) | ✅ health, SPA deep links, hashed assets, CSP, JSON 404 under `/api` |

## Quickstart scenarios → evidence

All scenarios were exercised by automated tests (API and/or real browser). A manual walk-through by
a person has **not** been done yet; the boxes below record automated evidence only.

- [x] 1 Owner setup — `e2e/accounts.spec.ts`, `contract/test_health_setup_auth.py`
- [x] 2 No public sign-up — `e2e/accounts.spec.ts` (no registration link), contract 409 `owner_exists`
- [x] 3 Member account, forced password change, isolation — `e2e/accounts.spec.ts`, `integration/test_account_isolation.py`
- [x] 4 Recurring class with inline hierarchy + folders — `e2e/class-creation.spec.ts`, `integration/test_recurring_class_creation.py`
- [x] 5 Semester end moves sessions — `integration/test_hierarchy_rename_and_dates.py` (API level; the dates dialog UI is covered only by type/lint checks)
- [x] 6 Validation messages keep input — `unit/class-form.test.tsx`, `contract/test_classes_sessions_read.py`
- [x] 7 Views, navigation, overlaps, "+N more" — `e2e/calendar-navigation.spec.ts`, `unit/calendar-views.test.tsx`, `unit/overlap-layout.test.ts`
- [x] 8 Edit scopes (this / following / all, preserved override) — `e2e/edit-scopes.spec.ts`, `integration/test_edit_scopes_flow.py`
- [x] 9 Cancel one session — `e2e/edit-scopes.spec.ts`
- [x] 10 Course search, empty state, clear — `unit/course-panel.test.tsx`, `unit/course-panel.performance.test.tsx`
- [x] 11 Delete keeps files — `contract/test_hierarchy_manage.py`, `contract/test_admin_accounts.py` (API level; the delete dialog UI is not driven by an E2E test)
- [x] 12 Keyboard only — `e2e/calendar-navigation.spec.ts`, `e2e/accounts.spec.ts`, `e2e/edit-scopes.spec.ts`, `e2e/a11y-themes.spec.ts` (visible focus on every tab stop)
- [x] 13 Light/dark, AA contrast — every E2E spec runs in both themes with axe WCAG 2.1 AA; `unit/tokens.contrast.test.ts`
- [x] 14 DST keeps wall-clock time — `unit/test_recurrence.py`, `integration/test_recurring_class_creation.py` (Europe/Berlin member)

## Success criteria

| SC | Status |
|---|---|
| SC-001 / SC-002 (time for a person to enter classes) | ⏳ not measured — needs a usability check with a real user |
| SC-003 view switch < 1 s | ✅ `e2e/calendar-performance.spec.ts` (cold and warm cache); backend budget `integration/test_sessions_performance.py` |
| SC-004 correct sessions incl. DST | ✅ |
| SC-005 search < 0.5 s at 200 courses | ✅ `unit/course-panel.performance.test.tsx` |
| SC-006 keyboard + AA | ✅ |
| SC-007 folders browsable | ✅ integration tests assert the on-disk tree |

## Notes

- Production bundle is 863 kB (259 kB gzip); Vite warns about chunk size. Route-level code
  splitting is a possible follow-up, not required by the spec.
