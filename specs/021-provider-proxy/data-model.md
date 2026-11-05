# Data Model: Proxy for Transcription and AI Provider Requests

Migration `0018_provider_proxy.py` (Alembic, runs on startup).

## New table `proxy_settings` (one row per user, optional)

| Column | Type | Rules |
|---|---|---|
| `user_id` | String, PK, FK `users.id` ON DELETE CASCADE | one proxy per user (FR-001/002) |
| `scheme` | String(8) | CHECK in (`http`, `https`, `socks5`) |
| `host` | String(253) | hostname, IPv4 or IPv6 literal; no scheme, path, spaces or `@` |
| `port` | Integer | CHECK 1–65535 |
| `username` | String(255), nullable | plain text; empty string stored as NULL |
| `version` | Integer | `VersionMixin`; `If-Match` on PUT/DELETE |
| `created_at`, `updated_at` | String (ISO) | `TimestampMixin` |

Password: `Secret` row with `owner_kind = "proxy"`, `owner_id = user_id`; add `"proxy"` to
`models/secret.py:OWNER_KINDS`. Never serialized; API shows `SecretState` (masked last 4).
*(Implementation: no `secret_id` column — `SecretStore` already finds the secret by owner, so a
foreign key added nothing. The table is also listed in `backup/tables.py` INCLUDED.)*

## Changed tables

| Table | New column | Default | Meaning |
|---|---|---|---|
| `transcription_settings` | `use_proxy` Boolean NOT NULL | `false` | Transcription switch (FR-007) |
| `ai_settings` | `use_proxy` Boolean NOT NULL | `false` | AI switch (FR-008) |

## Derived: routing decision (not stored)

`route(user, section, target_url) -> proxy_url | None`:

| Proxy saved | Section switch | Target host | Result |
|---|---|---|---|
| no | any | any | direct |
| yes | off | any | direct (FR-011) |
| yes | on | local | direct (FR-011a) |
| yes | on | remote | via proxy, never falls back (FR-010) |

## Lifecycle

- **Create/replace**: `PUT /settings/proxy`. Password field: absent = keep, string = replace,
  `null` = remove (same convention as provider keys).
- **Delete**: `DELETE /settings/proxy` (confirmed in UI) → deletes row and its secret, sets both
  `use_proxy` to false in one transaction, returns which sections were on (FR-006).
- **User delete**: cascades.
- **Backup**: row and switches are included; password left out and listed in
  `keysLeftOut` with `kind: "proxy"` (manifest + `schemas/backup.py` Literal gain `"proxy"`).
- **Secret-store reset**: proxy secret is dropped like other keys; `password.readable=false`
  until re-entered.
