# Data Model: Settings — Transcription Providers & Themes (005)

Alembic revision `0007_settings_themes`. Conventions as 001–004.

## provider_configs (004 table; 005 adds columns)

| Column | Type | Rules |
|---|---|---|
| test_status | text | `not_tested` (default) \| `connected` \| `failed`; reset to `not_tested` when values/key change |
| test_error | text null | plain-language reason of the last failed test (no key) |
| tested_at | text null | UTC ISO |

Derived per provider for the UI: `not_configured` when a required field is empty (incl. the
secret), else `test_status`.

## transcription_settings (004 table, unchanged)

`active_provider_id`, `default_language` (`auto` or ISO 639-1).

## themes

| Column | Type | Rules |
|---|---|---|
| id | text PK | UUIDv7 |
| user_id | text FK→users ON DELETE CASCADE | |
| name | text | 1–60 chars; UNIQUE (user_id, name_key) |
| name_key | text | casefold(name) |
| base | text | `light` \| `dark` |
| key_colors_json | text | `{"background","surface","text","accent"}` → `#rrggbb` |
| overrides_json | text | token → `#rrggbb` (only tokens of the colour set) |
| colors_json | text | full resolved colour set (every token) |
| low_contrast | bool | saved despite failing pairs |
| version, created_at, updated_at | | `version` for `If-Match` |

## ui_preferences (002) — new key

| Key | Values | Default |
|---|---|---|
| theme | `system` \| `light` \| `dark` \| a theme id of the user | `system` |

Deleting the active custom theme sets `theme` to that theme's base.

## Colour set (tokens)

`surface, surface-elevated, surface-sunken, surface-hover, text-primary, text-muted, border,
divider, grid-line, accent, accent-foreground, now-line, focus-ring, success, warning, danger,
danger-foreground, editor-surface` (18). Labels and derivation: research C4.

| Label in the editor | Token | Note |
|---|---|---|
| Background (key colour) | `surface` | page background |
| Surface / card (key colour "Surface") | `surface-elevated` | cards, dialogs, panels |
| Sunken surface | `surface-sunken` | inputs, code blocks |
| Hover | `surface-hover` | hover and selected rows |
| Primary text (key colour "Text") | `text-primary` | |
| Muted text | `text-muted` | secondary text, upcoming sessions |
| Border | `border` | control borders (3:1) |
| Divider | `divider` | separators |
| Calendar grid lines | `grid-line` | |
| Accent (key colour) | `accent` | primary buttons, links |
| Text on accent | `accent-foreground` | |
| Secondary accent | `now-line` | the calendar's current-time line and other secondary highlights |
| Focus ring | `focus-ring` | |
| Success / Warning / Danger | `success` / `warning` / `danger` | status text and destructive actions |
| Text on danger | `danger-foreground` | |
| Editor background | `editor-surface` | the note editor |
