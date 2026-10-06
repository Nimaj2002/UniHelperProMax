# Validation Record: Settings — Transcription Providers & Themes (005)

**Date**: 2026-10-06

## Automated checks

| Check | Result |
|---|---|
| `ruff check` / `ruff format --check` | ✅ |
| `mypy` (strict, 90 files) | ✅ |
| `pytest` (unit, contract, integration) | ✅ 294 passed; coverage guard: every operation in all five feature contracts exercised with a 2xx |
| `eslint .`, `tsc -b` | ✅ |
| `vitest` | ✅ 340 passed (colour derivation/contrast, theme files, settings forms, appearance/editor, hard-coded colour guard) |
| `playwright` light + dark | ✅ 34 passed (001–005 flows; fake microphone + fake transcriber) |
| Production build | ✅ (main bundle 229 kB gzip; theme editor loads on demand) |

## Quickstart scenarios → evidence (automated)

- [x] 1 Settings from every screen (account menu + top-bar gear) — `e2e/settings.spec.ts`
- [x] 2 Voice Studio preselected, only its fields — `unit/transcription-settings.test.tsx`, contract defaults test
- [x] 3 Test connection: success or specific failure within 15 s (unreachable, timeout, not a transcription service, invalid key, unknown model) — `contract/test_transcription_settings.py::test_connection_test`, `test_timeout`, `test_keys_are_never_returned`
- [x] 4 Malformed address refused inline — `test_invalid_address`, `unit/transcription-settings.test.tsx`
- [x] 5 OpenAI-compatible with key; masked after reload; key never in responses or logs — `test_keys_are_never_returned`, `e2e/settings.spec.ts`
- [x] 6 Change only the model keeps the key — contract + unit tests
- [x] 7 Switching providers keeps each provider's values — `test_switching_keeps_each_providers_values`, unit test
- [x] 8 `http://` + key only for local/private hosts — `unit/test_addresses.py`, `test_https_rule_with_key`, E2E
- [x] 9 Removing the key → "Not configured", 004 explains — contract test (status `configured: false`)
- [x] 10 Default language used by 004 — contract test + 004 dialog default
- [x] 11 Light / Dark / Match system apply at once, per account, no flash on reload — `unit/appearance.test.tsx`, E2E (boot script alone sets `data-theme` with the app blocked)
- [x] 12 New theme: derived colours, live preview, AA warnings with ratios — `unit/theme-colors.test.ts`, `unit/appearance.test.tsx`, E2E
- [x] 13 Advanced overrides marked/resettable/kept — `unit/appearance.test.tsx`
- [x] 14 Saving a failing theme asks and marks "Low contrast" — unit + E2E
- [x] 15 Rename / duplicate / delete active theme → base — `contract/test_themes.py`, E2E
- [x] 16 Built-ins not editable/deletable, can be duplicated/exported — `unit/appearance.test.tsx`
- [x] 17 Export → delete → import identical; duplicate names suffixed; bad files rejected — `unit/theme-file.test.ts`, `test_create_list_get`, E2E
- [x] 18 Keyboard + themes + axe — E2E in light and dark (the theme preview is excluded only when it deliberately shows failing colours)

Not yet done: a test against a real Voice Studio server and a real OpenAI-compatible provider,
and a manual walk-through of a custom theme across every screen.

## Bugs found and fixed during implementation

- The transcription E2E could read a leftover notification from the other colour-scheme project
  (shared account) and check the editor too early; it now waits for its own job to finish.
- Duplicate "Background"/"Accent" controls in Advanced mode — Advanced now replaces the key
  colours instead of adding to them; the "Overridden" hint moved out of the field's name.
- Migration `0007` needed a server default for existing provider rows and the CHECK constraint
  autogenerate missed (verified on a database with existing rows, up and down).
