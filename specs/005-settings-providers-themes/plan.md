# Implementation Plan: Settings — Transcription Providers & Themes

**Branch**: `005-settings-providers-themes` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-settings-providers-themes/spec.md`

## Summary

A Settings area (account menu + top-bar gear) with two sections. **Transcription** writes the
per-user provider tables 004 reads: provider choice, fields generated from each provider's
declared requirements, masked keys with replace/remove, an https-unless-local rule, a 15 s
connection test with specific failure reasons, status, and the default language.
**Appearance** offers Light, Dark, Match system and custom themes; a theme editor derives a full
colour set from 4 key colours (Advanced allows overriding any of the 18 tokens), checks WCAG AA
live, previews representative UI, and saves per account; themes export to and import from a
human-readable JSON file. The chosen theme applies app-wide immediately and on every device,
without a flash on load.

## Technical Context

**Language/Version**: Python 3.12+, TypeScript 5.9 / React 19 — as 001–004

**Primary Dependencies**: no new packages (stdlib `ipaddress`/`socket`/`urllib` for address rules;
colour maths hand-written); shadcn `switch` added.

**Storage**: new `themes` table; `provider_configs` gains test columns (revision
`0007_settings_themes`); `ui_preferences` key `theme`; per-device `localStorage` cache of the last
applied theme (flash prevention only).

**Testing**: pytest — address rule unit tests, contract tests for every path (keys never in any
response, masked last4, keep/replace/remove, test categories via the fake transcriber), themes
CRUD/validation/fallback; Vitest — colour derivation + contrast, provider form, theme list,
editor (overrides, warnings, unsaved-changes guard), import/export round trip; Playwright —
settings flows in light/dark with axe, theme switching across screens.

**Target Platform / Project Type**: as 001–004.

**Performance Goals**: theme switch < 0.5 s without reload (SC-004); test result ≤ 15 s (FR-008).

**Constraints**: Constitution IV (keys server-side, masked), V (tokens only, AA warnings, user
themes everywhere, keyboard), III (all via `/api/v1`), VII (no new infrastructure/deps).

**Scale/Scope**: a handful of providers and themes per user; theme files ≤ 100 KB.

## Constitution Check

| Principle | Gate for 005 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Destructive actions confirmed; unsaved edits guarded | PASS | PASS — delete theme behind a confirmation; removing a key is only marked (with Undo) until Save; editor unsaved-changes dialog |
| II. Data ownership | Themes are portable | PASS | PASS — human-readable theme files (export/import) |
| III. Separation | Only via `/api/v1` | PASS | PASS — 4 paths in `contracts/openapi.yaml`; export/import parse in the browser, persist via the API |
| IV. Pluggable transcription & secrets | UI discovers providers; keys never returned/logged | PASS | PASS — fields from `ProviderSpec`; `secret.{configured,last4}` only; test uses saved key server-side; https rule |
| V. UI quality | User themes on every screen; AA warnings; keyboard | PASS | PASS — every colour is a token; editor flags failing pairs; new `editor-surface` token; `ui-settings.md` |
| VI. Testing | Endpoint tests | PASS | PASS — contract tests per path; coverage guard includes 005 |
| VII. Simplicity | No new deps/infrastructure | PASS | PASS — stdlib + existing stack; derivation in one place (frontend) |

**Result**: all gates pass.

## Project Structure

```text
specs/005-settings-providers-themes/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ openapi.yaml · ui-settings.md
└── tasks.md

backend/src/unihelper/
├── domain/addresses.py                    # URL validation + local/private host rule
├── models/theme.py · models/transcription.py (+ test columns) · migration 0007
├── schemas/settings.py · schemas/themes.py · schemas/notes.py (Preferences.theme)
├── services/transcription_settings_service.py · services/theme_service.py
├── services/workspace_service.py          # theme preference default/validation
├── services/transcription_service.py      # successful job → provider "connected"
└── api/v1/settings.py · api/v1/themes.py
backend/tests/{unit/test_addresses.py, contract/test_transcription_settings.py, contract/test_themes.py}

frontend/
├── public/theme-boot.js · index.html     # apply cached theme before first paint
├── src/styles/tokens.css                  # + editor-surface token
├── src/app/theme.tsx                      # preference-driven provider (system/light/dark/custom)
└── src/features/settings/
    ├── routes.tsx                         # routes, account menu item, top-bar gear
    ├── SettingsLayout.tsx · api.ts
    ├── transcription/TranscriptionSettings.tsx · ProviderFields.tsx
    └── themes/ colors.ts (derive, contrast) · themeFile.ts (export/import)
        · AppearanceSettings.tsx · ThemeEditor.tsx · ThemePreview.tsx · ColorField.tsx
frontend/tests/{unit/theme-colors.test.ts, theme-file.test.ts, transcription-settings.test.tsx,
                appearance.test.tsx, theme-editor.test.tsx, e2e/settings.spec.ts}
```

**Structure Decision**: one `features/settings` module registering routes and shell entries;
backend split into settings and themes routers. 004's transcription screens need no change
(FR-021) — they already link to `/settings/transcription`.

## Phase 0 / Phase 1

Complete: [research.md](./research.md) (C1–C7), [data-model.md](./data-model.md),
[contracts/openapi.yaml](./contracts/openapi.yaml), [contracts/ui-settings.md](./contracts/ui-settings.md),
[quickstart.md](./quickstart.md). Post-design Constitution Check: PASS.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| DNS lookups block or hang | 2 s budget in a thread; failure = public (refuse http + key) |
| Derived colours fail AA | Nudge toward contrast; remaining failures are flagged, never hidden |
| Flash of the wrong theme | `theme-boot.js` applies the cached theme synchronously before first paint |
| Hard-coded colours bypass themes | Existing `no-hardcoded-colors` test stays; E2E switches to a custom theme and checks representative screens |

## Complexity Tracking

> No violations.
