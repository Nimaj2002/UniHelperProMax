# Phase 0 Research: Settings — Transcription Providers & Themes (005)

Builds on 001 (shell, account menu registry, tokens.css, `ThemeProvider`), 002 (`/preferences`
in `ui_preferences`) and 004 (provider registry, `transcription_settings`/`provider_configs`
tables, `OpenAITranscriptionClient.test`). Clarifications of 2026-10-04 apply (per-user
providers, simple + Advanced editor, https rule, theme per account).

## C1. Where settings live

- **Decision**: Provider settings stay in 004's per-user tables (005 adds the write path and
  test-result columns). The theme choice is a new `/preferences` key `theme` (`system` default,
  `light`, `dark`, or a custom theme id) — per account, applied on every device (FR-015).
  Custom themes are rows of a new `themes` table.
- **Rationale**: One source per concern; preferences already sync per account.

## C2. Transcription settings API (FR-002–FR-013)

- `GET /settings/transcription` → active provider, default language, and one entry per
  registered provider: non-secret `values`, `secret: {configured, last4}` for secret fields,
  `status` (`not_configured | not_tested | connected | failed`), `lastError`, `testedAt`.
  Never the key (Constitution IV, SC-003).
- `PUT /settings/transcription` saves the active provider, default language and **one**
  provider's values; its `apiKey` is `absent` = keep, a string = replace, `null` = remove
  (FR-010). Other providers' rows are untouched (FR-011). Changing any value resets that
  provider's status to `not_tested`.
- `POST /settings/transcription/test` tests the entered values (saved or not) through the
  provider's `test()` (`GET {base}/v1/models`) with a 15 s budget (FR-008); `useSavedKey: true`
  uses the stored key without the browser ever seeing it. If the tested values equal the saved
  ones, the result is stored as the provider's status. A successful transcription also marks
  the provider `connected` (spec edge case).
- Failure categories for the UI: `invalid_address`, `unreachable`, `timeout`,
  `invalid_credentials`, `model_not_found`, `not_a_transcription_service` (mapped from 004's
  `ProviderError` + transport errors).

## C3. Address rules (FR-007, clarification B)

- **Decision**: `http`/`https` URLs with a host only (`urllib.parse`); path allowed (004
  normalises `/v1`). When an API key is set (saved or entered) and the scheme is `http`, the
  host must be local: `localhost`, `*.localhost`, loopback, private (RFC 1918/4193), link-local,
  or a name whose **every** resolved address is one of those (`getaddrinfo`, 2 s timeout via a
  worker thread). Otherwise saving and testing are refused with "Use https:// for this address
  when an API key is set." Unresolvable names count as public.
- Voice Studio has no key, so `http` is allowed for any host.

## C4. Theme model and colour set (FR-016–FR-018)

- **Editable colour set** (the app's semantic tokens, labelled for people): Background
  (`surface`), Surface/card (`surface-elevated`), Sunken surface (`surface-sunken`), Hover
  (`surface-hover`), Primary text (`text-primary`), Muted text (`text-muted`), Border
  (`border`), Divider (`divider`), Calendar grid lines (`grid-line`), Accent (`accent`), Text on
  accent (`accent-foreground`), Secondary accent (`now-line`, the current-time line and other
  secondary highlights), Focus ring (`focus-ring`), Success, Warning, Danger, Text on danger,
  Editor background (`editor-surface` — new token, defaults to the surface/card colour and is
  used by the note editor). Shadows/overlays and the 12 class colours come from the base theme
  (class colours keep their own AA-checked text, spec edge case).
- **Key colours** (simple mode): background, surface, text, accent. Everything else is derived
  in `frontend/src/features/settings/themes/colors.ts` (pure functions): mixes in sRGB toward
  text/background, then nudged lighter/darker until the required contrast is met where
  possible (muted text 4.5:1 on background and surface, border/focus 3:1, text on accent 4.5:1,
  status colours start from the base theme and are adjusted to 4.5:1 on the background).
- **Overrides** (Advanced): a map token → colour; overridden tokens are marked and can be reset;
  changing a key colour keeps overrides and warns that they were not re-derived (FR-017).
- **Contrast check**: a fixed list of pairs (text on each surface, muted text, accent as link
  text, text on accent/danger, status colours as text, border/focus as non-text 3:1, editor
  text). The same function powers the editor warnings, the save confirmation and import.
- **Derivation lives only in the frontend**; the server stores and validates (`#rrggbb` per
  known token, name 1–60 chars, base light/dark) but never derives — one implementation.

## C5. Applying themes without a flash (FR-015, US3 #4)

- **Decision**: `ThemeProvider` resolves the preference: `system` → OS light/dark (live via
  `matchMedia`); `light`/`dark` → that; custom → `data-theme=<base>` plus the theme's colours as
  inline CSS variables on `<html>` (overriding `tokens.css`). The last applied theme is cached in
  `localStorage` and re-applied by a tiny synchronous `public/theme-boot.js` in `<head>` (allowed
  by the CSP's `script-src 'self'`), so reloads and new tabs start in the right theme; the server
  preference wins as soon as it loads. A deleted active theme falls back to its base (server
  rewrites the preference on delete; a stale id on load also falls back).

## C6. Export / import (FR-020, FR-021)

- **File**: `<Theme name>.uhtheme.json`, pretty-printed JSON:
  `{"format": "unihelper-theme", "version": 1, "name", "base", "keyColors": {…}, "overrides": {…}, "colors": {…}}`.
  Built-in themes export too (no overrides).
- **Import** (client-side parse, then `POST /themes` with `uniqueName: true`): reject files over
  100 KB, non-JSON, wrong `format`, non-`#rrggbb` values or a missing/invalid base; missing
  colours are filled from the base theme, unknown keys ignored (user told how many); name taken →
  server adds " (2)", " (3)"…; failing contrast → saved with `lowContrast: true` and a warning.
  Nothing executes: values are only ever used as validated hex strings.

## C7. Settings UI structure

- Routes `/settings` (redirects to `/settings/transcription`), `/settings/transcription`,
  `/settings/appearance`, `/settings/appearance/themes/new?from=<id|light|dark>`,
  `/settings/appearance/themes/:id`. Reachable from every screen via the account menu item
  "Settings" (`registerAccountMenuItem`) and a gear button in the top bar
  (`registerTopBarAction`).
- Provider form fields are rendered from `GET /transcription/providers` (`ProviderField.kind`):
  `url`/`text` → inputs, `secret` → masked value with Replace/Remove (FR-006).
- Unsaved theme edits: React Router `useBlocker` + an AlertDialog "Save / Discard / Keep
  editing" (US4 #7).
