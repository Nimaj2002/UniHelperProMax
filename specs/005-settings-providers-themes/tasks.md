---

description: "Task list for feature 005 — Settings: Transcription Providers & Themes"
---

# Tasks: Settings — Transcription Providers & Themes

**Input**: `/specs/005-settings-providers-themes/` (plan, spec, research, data-model, contracts, quickstart)

**Tests**: INCLUDED — Constitution VI requires tests for every endpoint; SC-003 (keys never
leak) and SC-007 (all failing pairs flagged) need automated evidence.

**Order**: Setup → Foundational → US1 (Voice Studio) → US2 (OpenAI-compatible, keys) → US3
(choose theme) → US4 (custom theme editor) → US5 (export/import) → Polish.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Add shadcn `switch` to `frontend/src/components/ui/switch.tsx` (token classes only, `cn` from `@/lib/utils`); add `--editor-surface` to both blocks of `frontend/src/styles/tokens.css` (light: same as `--surface-elevated`, dark: same) and to `@theme inline` in `src/index.css`, and use `bg-editor-surface` for the note editor area in `WorkspacePage.tsx`

---

## Phase 2: Foundational

- [X] T002 Migration `0007_settings_themes` + models: `ProviderConfig` gains `test_status` (`'not_tested' | 'connected' | 'failed'`, default `'not_tested'`), `test_error` (text null), `tested_at` (text null); new `Theme` model `backend/src/unihelper/models/theme.py` per data-model.md (`name` "1–60 chars", UNIQUE (user_id, name_key), `base` IN ('light','dark'), JSON columns, `low_contrast`, VersionMixin)
- [X] T003 [P] `backend/src/unihelper/domain/addresses.py`: `parse_address(url) -> ParsedAddress | None` (http/https with host only), `is_local_host(host, resolve=getaddrinfo, timeout=2)` (localhost/*.localhost, loopback, private, link-local, unique-local; every resolved address local; failures → public), `check_address(url, has_key) -> None` raising `ApiError(422, "invalid_address" | "https_required")` with field pointer; unit tests `backend/tests/unit/test_addresses.py`
- [X] T004 [P] Frontend module skeleton `frontend/src/features/settings/` (`routes.tsx` with `/settings` → `/settings/transcription`, `/settings/transcription`, `/settings/appearance`, `/settings/appearance/themes/new`, `/settings/appearance/themes/:id`; `SettingsLayout.tsx` heading + `<nav aria-label="Settings sections">`; account menu item "Settings" and top-bar gear button "Settings"), imported in `app/features.ts`; `api.ts` typed calls/hooks; regenerate API types

---

## Phase 3: User Story 1 — Configure Voice Studio (P1) 🎯 MVP

**Independent Test**: enter a reachable Voice Studio address, test, save, reload — address kept, status shown, Transcribe (004) works.

- [X] T005 [P] [US1] Contract tests `backend/tests/contract/test_transcription_settings.py`: `GET /settings/transcription` defaults (no active provider, `auto`, both providers `not_configured`), `PUT` Voice Studio address → status `not_tested`, active provider set, 004 status `configured: true`; 422 `invalid_address` (malformed, ftp, no host) with field pointer, 422 unknown provider, bad language; `POST /settings/transcription/test` success against the fake transcriber (stored as `connected` when values equal the saved ones), failures `unreachable` (connection refused), `not_a_transcription_service` (404), `timeout` (slow), all within the budget
- [X] T006 [US1] `backend/src/unihelper/services/transcription_settings_service.py` (view with derived status; save one provider keeping other providers' rows; reset status when values/key change; test with 15 s budget mapping `ProviderError`/transport errors to `ConnectionTestResult` categories; store result when values match saved) and `api/v1/settings.py` (GET/PUT `/settings/transcription`, POST `/settings/transcription/test`, using the 004 worker's HTTP transport so tests reach the fake transcriber); successful 004 jobs mark the provider `connected` in `transcription_service.append_result`
- [X] T007 [US1] `frontend/src/features/settings/transcription/TranscriptionSettings.tsx` (the generated provider fields are part of it; no separate `ProviderFields.tsx`): provider `RadioGroup` from `GET /transcription/providers` (Voice Studio preselected when none saved), fields generated from `ProviderField.kind`, status line, Test connection (result resets on edit, `role="status"`), default language `Select` (reuse 004 `languages.ts`), Save + toast, inline field errors from problem field pointers
- [X] T008 [P] [US1] Component tests `frontend/tests/unit/transcription-settings.test.tsx`: Voice Studio preselected with only its fields, test success/failure messages, result resets when a field changes, save payload, inline `invalid_address`, axe clean

---

## Phase 4: User Story 2 — OpenAI-compatible + key handling (P1)

**Independent Test**: configure address + key + model, test, save; reload → masked key only; wrong key → invalid credentials.

- [X] T009 [P] [US2] Contract tests (same file): save with key → `secret {configured: true, last4}` and the key appears in **no** response body (GET/PUT/test) nor logs; change only the model with `apiKey` absent keeps the key; `apiKey: null` removes it → `not_configured`; switching active provider keeps other provider rows; `http://` public host + key → 422 `https_required` (save and test), `http://localhost` / `http://192.168.1.5` allowed, Voice Studio `http://` public allowed; test with `useSavedKey`; wrong key → `invalid_credentials`; unknown model → `model_not_found`
- [ ] T010 [US2] Service/route support for secrets (replace/keep/remove, `useSavedKey`, https rule via `domain/addresses.py`) and UI: masked key "••••••••abcd" with Replace / Remove (marked until Save, with Undo — decided 2026-10-06 instead of a confirmation) for `secret` fields, password input when replacing; OpenAI-compatible address and model required, key may be saved later (status "Not configured") with a hint on the key field
  - **Not done (found 2026-10-06)**: saving OpenAI-compatible without a key shows no hint on the key field (it silently becomes "Not configured"), and testing with an empty key field says "The API key was rejected." instead of asking for a key. Replace/keep/remove, `useSavedKey`, masking and the https rule are implemented.
- [X] T011 [P] [US2] Component tests (same file): masked key never shows more than last 4, Replace reveals an empty password input, Remove sends `apiKey: null`, switching providers shows each provider's saved values

---

## Phase 5: User Story 3 — Choose a theme (P1)

**Independent Test**: pick Light, Dark, Match system — every screen changes at once; the choice follows the account; reload has no flash.

- [X] T012 [P] [US3] Contract test update `backend/tests/contract/test_preferences.py`: `theme` default `system`, accepts `light`/`dark`/an own theme id, 422 for unknown ids or another user's theme; add `theme` to 002's `Preferences` schema in `specs/002-course-session-notes/contracts/openapi.yaml`
- [X] T013 [US3] Backend: `Preferences.theme` (schema + default + validation against the user's themes) in `schemas/notes.py` / `workspace_service.py`
- [X] T014 [US3] `frontend/src/app/theme.tsx`: resolve preference (`system` live via `matchMedia`, `light`, `dark`, custom → base `data-theme` + inline CSS variables from the theme's `colors`), stale id → base, cache `{base, vars}` in `localStorage` (`uh.theme`); `public/theme-boot.js` (loaded in `<head>` of `index.html`) applies the cache before first paint; signed-out screens keep using the cache/system
- [X] T015 [US3] `AppearanceSettings.tsx`: theme `RadioGroup` cards (Light, Dark, Match system, custom themes) with swatches, "Active" marker, "Low contrast" badge; selecting PATCHes `/preferences` and applies immediately
- [ ] T016 [P] [US3] Unit tests `frontend/tests/unit/appearance.test.tsx` (selection applies `data-theme`/CSS vars at once, Match system follows `matchMedia` changes, cache written, axe)
  - **Not done (found 2026-10-06)**: no test covers "Match system follows `matchMedia` changes". The other listed checks (selection applies at once, cache written, axe) exist.

---

## Phase 6: User Story 4 — Create and edit custom themes (P2)

**Independent Test**: create from Dark, change colours, see live preview and contrast warning, save, apply, edit, delete.

- [X] T017 [P] [US4] Contract tests `backend/tests/contract/test_themes.py`: create (201, 409 `name_taken`, `uniqueName` adds " (2)"), list by name, get, update with `If-Match` (412 stale, 428 missing, rename, 409 duplicate name), delete (204; active theme → preference falls back to base), validation (422 bad hex, unknown token, name length, base), 404 for another user's theme
- [X] T018 [US4] `backend/src/unihelper/services/theme_service.py` + `api/v1/themes.py` + `schemas/themes.py`
- [X] T019 [P] [US4] `frontend/src/features/settings/themes/colors.ts`: token list + labels + built-in Light/Dark values (mirroring `tokens.css`), hex parse/format, relative luminance, contrast ratio, `derive(base, keyColors) -> colors`, `resolve(base, keyColors, overrides)`, `contrastIssues(colors) -> {pair, ratio, required}[]`; unit tests `frontend/tests/unit/theme-colors.test.ts` (built-ins have no issues and match tokens.css, derivation meets AA for typical inputs, overrides win, issues detected with ratios)
- [X] T020 [US4] `ThemeEditor.tsx` + `ColorField.tsx` + `ThemePreview.tsx`: name, simple 4 key colours, Advanced switch with all 18 tokens (override marker + Reset, kept-overrides notice), live preview with scoped CSS variables, contrast panel, save confirmation for failing pairs (`lowContrast: true`), unsaved-changes guard (`useBlocker`), "New theme…" dialog (name + start from Light/Dark/custom); list actions Edit / Rename / Duplicate / Delete (confirm) for custom themes, Duplicate only for built-ins
- [ ] T021 [P] [US4] Component tests (in `frontend/tests/unit/appearance.test.tsx`; no separate `theme-editor.test.tsx`) (key colour change re-derives and updates preview, Advanced override marked and resettable, failing pair listed with ratio and confirmation on save, unsaved-changes dialog, built-ins not editable, axe)
  - **Not done (found 2026-10-06)**: no test covers the unsaved-changes dialog. The other editor checks (re-derive and preview, Advanced overrides, failing pairs and confirmation, built-ins, axe) exist in `appearance.test.tsx`.

---

## Phase 7: User Story 5 — Export and import (P3)

**Independent Test**: export, delete, import → identical colours; duplicate names suffixed; bad files rejected.

- [X] T022 [P] [US5] `frontend/src/features/settings/themes/themeFile.ts` (`toFile(theme)` → `{format, version, name, base, keyColors, overrides, colors}` pretty JSON named `<name>.uhtheme.json`; `parseFile(text, size)` → validated theme + notes (filled/ignored counts) or an error: >100 KB, not JSON, wrong format, bad base, bad colour); unit tests `frontend/tests/unit/theme-file.test.ts` (round trip identical, missing colours filled from base, unknown ignored, every rejection case)
- [X] T023 [US5] Export / Import actions in `AppearanceSettings.tsx` (download via Blob URL; file input; `POST /themes` with `uniqueName: true`; low-contrast warning; errors in `role="alert"`)

---

## Phase 8: Polish

- [X] T024 [P] Playwright `frontend/tests/e2e/settings.spec.ts` (light + dark, keyboard, axe): open Settings from the account menu; Voice Studio address of the fake transcriber → test → save → 004 dialog shows "Using Voice Studio"; OpenAI-compatible with key → masked after reload, key absent from responses; Appearance: Dark → applied, reload has `data-theme="dark"` before React mounts; new theme from Light with a low-contrast accent → warning → save as low contrast → applied to calendar and workspace; export/import round trip; delete active → falls back
- [X] T025 Run all checks (ruff, mypy, pytest incl. coverage guard over 5 contracts, eslint, tsc, vitest, Playwright light+dark, build); record in `specs/005-settings-providers-themes/checklists/validation.md`; README (Settings section replaces the `e2e_seed` instructions)

## Phase 9: Analysis fixes (Batch A, 2026-10-06)

- [ ] T026 [US2] Enforce the https-or-local rule when the worker sends a key (005-F11): before each part upload that includes an API key (`worker.py`, where `read_secret` is called), check the address with `domain/addresses.py`, resolving the host at that moment so a DNS change is caught. A public `http://` address fails the job as `not_configured`, settings-related, with "Use https:// for this address when an API key is set.", and no request is sent. **Test** in `backend/tests/contract/test_transcription_lifecycle.py`: provider row written directly (bypassing Settings validation) with `http://transcriber.example` + key and `is_local_host` patched to public → job `failed` with that message and `settingsRelated: true`, and `fake_transcriber` `app.state.calls` is empty; `http://127.0.0.1:<port>` + key → completes; a host that was local at save time and resolves public at send time → refused.
- [ ] T027 [US3] Clear the cached theme on sign-out (005-F1 follow-up: one user's theme must not show to the next person on a shared browser): `useLogout` removes `uh.theme` (`THEME_CACHE_KEY`) and resets the document to Match system (inline theme variables removed, `data-theme` from `matchMedia`); the next sign-in caches that user's theme as now. **Test**: `frontend/tests/unit/appearance.test.tsx` (custom theme applied and cached → sign out → no `uh.theme` in localStorage, no inline `--*` variables on `<html>`, `data-theme` follows the mocked `matchMedia`), and in `frontend/tests/e2e/settings.spec.ts`: choose Dark, sign out, reload the login page with a light colour scheme → `data-theme="light"` before React mounts.

## Dependencies

Setup → Foundational → US1 → US2 → US3 → US4 → US5 → Polish. US3–US5 (themes) are independent of
US1–US2 (providers) and can be built in parallel after Foundational.

## Implementation strategy

MVP = US1 + US2 (makes 004 usable from the UI). Then US3 (theme choice), US4 (editor), US5 (files).
