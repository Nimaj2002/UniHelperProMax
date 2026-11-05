# Feature Specification: Proxy for Transcription and AI Provider Requests

**Feature Branch**: `021-provider-proxy`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "add proxy to the api requests. so in the setting for trascript and llm section,in setting add a page called proxy where user can add their proxy. in the transcript and llm section add a button asking to use proxy or not"

**Related**: Feature 005 (Settings → Transcription providers) and Feature 014 (Settings → AI
providers) own the provider requests that this feature can route through a proxy. Constitution
Principle IV (pluggable providers, secrets encrypted server-side, never returned in full, never
logged) applies to proxy credentials exactly as it does to API keys.

## Clarifications

### Session 2026-11-05

- Q: Should requests to a provider on a local address go through the proxy when "Use proxy" is on? → A: No — local addresses (this computer or private-network addresses, as defined in Feature 005) always connect directly; the proxy applies only to non-local provider addresses.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save a proxy in Settings → Proxy (Priority: P1)

A student on a network that blocks or throttles AI and transcription services opens Settings and
sees a new "Proxy" page. They choose the proxy type, enter the proxy address and port, and, if
their proxy needs it, a username and password. They press "Test proxy", see it succeed, and save.

**Why this priority**: Nothing can be routed through a proxy until one is saved; this is the
foundation for the other stories.

**Independent Test**: Enter a reachable proxy, test, save, reload Settings → Proxy, and confirm
the address, port and type are kept and the password is shown only masked.

**Acceptance Scenarios**:

1. **Given** no proxy is saved, **When** the user opens Settings → Proxy, **Then** they see an
   empty form with: proxy type (HTTP, HTTPS, SOCKS5), host, port, and optional username and
   password, plus "Test proxy" and "Save" actions.
2. **Given** a filled form, **When** the user presses "Test proxy", **Then** within 15 seconds
   they see success or a specific failure (proxy unreachable, proxy rejected the credentials,
   proxy reached but could not reach the internet, timed out).
3. **Given** a malformed host or a port outside 1–65535, **When** the user tests or saves,
   **Then** it is refused with an inline message next to the field.
4. **Given** a saved proxy password, **When** Settings → Proxy is opened again, **Then** the
   password is shown only masked with "Replace" and "Remove" actions; the full password is never
   shown or sent back to the browser.
5. **Given** a saved password, **When** the user changes only the host or port and saves,
   **Then** the stored password is kept without re-entering it.
6. **Given** a saved proxy, **When** the user deletes it and confirms, **Then** the proxy is
   removed and every section that was set to use it is switched back to direct connection, with
   the page saying which sections were affected.

---

### User Story 2 - Turn the proxy on for transcription (Priority: P1)

In Settings → Transcription the student sees a "Use proxy" switch. They turn it on and save.
From then on, connection tests and transcriptions for their transcription provider go through
the saved proxy.

**Why this priority**: Transcription is the main reason users need a proxy (large uploads to a
hosted provider that may be blocked on campus networks).

**Independent Test**: With a proxy saved, turn "Use proxy" on in Transcription, run "Test
connection" and a transcription, and confirm the provider is reached through the proxy; turn it
off and confirm requests go direct again.

**Acceptance Scenarios**:

1. **Given** no proxy is saved, **When** the user opens Settings → Transcription, **Then** the
   "Use proxy" switch is shown off and disabled, with a link to Settings → Proxy explaining a
   proxy must be added first.
2. **Given** a saved proxy, **When** the user turns "Use proxy" on in Transcription and saves,
   **Then** "Test connection" and every transcription request for that user go through the proxy,
   unless the provider address is local (then they go direct).
3. **Given** "Use proxy" is on, **When** the proxy is unreachable during a transcription,
   **Then** the transcription fails with a message that names the proxy as the cause (not the
   provider), the recording is untouched, and the user can retry; the request is never silently
   sent direct instead.
4. **Given** "Use proxy" is off, **When** a transcription runs, **Then** it connects directly,
   exactly as before this feature.

---

### User Story 3 - Turn the proxy on for AI chat (Priority: P1)

In Settings → AI the student sees the same "Use proxy" switch. When it is on, model listing,
connection tests and chat requests for their AI providers go through the saved proxy.

**Why this priority**: Equal value to transcription; AI providers are commonly region-blocked.

**Independent Test**: With a proxy saved, turn "Use proxy" on in AI settings, test a provider
and send a chat message, and confirm both go through the proxy; turn it off and confirm direct.

**Acceptance Scenarios**:

1. **Given** no proxy is saved, **When** the user opens Settings → AI, **Then** the "Use proxy"
   switch is shown off and disabled with a link to Settings → Proxy.
2. **Given** a saved proxy and "Use proxy" on in AI, **When** the user tests a provider, loads
   its model list, or sends a chat message, **Then** each request to a non-local provider goes
   through the proxy, including streamed replies; requests to local providers go direct.
3. **Given** "Use proxy" is on, **When** the proxy fails mid-chat, **Then** the chat shows an
   error naming the proxy as the cause, the user's message and any partial reply are kept as the
   chat feature already does for provider failures, and nothing is sent direct.
4. **Given** "Use proxy" is on for AI and off for Transcription (or the reverse), **When** both
   are used, **Then** each follows its own switch independently.

---

### Edge Cases

- The proxy is edited (new host/port/credentials) while "Use proxy" is on: the next request in
  each enabled section uses the new values; requests already in progress finish with the old ones.
- The provider address is local (this computer or a private-network address, e.g., a local Voice
  Studio): requests go direct even when "Use proxy" is on, and the settings page notes that local
  providers bypass the proxy. A user with one local and one remote AI provider gets direct for the
  local one and proxied for the remote one.
- The proxy needs credentials but none are saved: requests fail with "proxy requires
  authentication", never prompting mid-transcription.
- Password contains special characters (`@`, `:`, `/`, spaces): saved and used correctly.
- The proxy password is removed while sections still use the proxy: they keep using the proxy
  without credentials (the user chose this) and a failed request reports "proxy rejected the
  credentials".
- A backup is restored: the proxy host/port/type and switches are restored; the password follows
  the same rules as provider API keys in backups.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Settings MUST include a "Proxy" page where each user can save one proxy
  consisting of type (HTTP, HTTPS, SOCKS5), host, port, and optional username and password.
- **FR-002**: Proxy settings MUST be per user, consistent with existing provider settings; one
  user's proxy MUST never be used for another user's requests.
- **FR-003**: The Proxy page MUST offer "Test proxy", which checks the proxy can reach the
  internet within 15 seconds and reports a specific outcome (success, unreachable, credentials
  rejected, no onward connection, timed out).
- **FR-004**: The system MUST validate host and port before testing or saving and show inline
  errors for invalid values.
- **FR-005**: The proxy password MUST be handled exactly like provider API keys: encrypted at
  rest, never returned in full, shown only masked with "Replace" and "Remove", never written to
  logs, error messages, or note, audio or chat files.
- **FR-006**: Deleting the proxy MUST require confirmation and MUST switch every section using
  it back to direct connection.
- **FR-007**: Settings → Transcription MUST show a "Use proxy" switch, saved per user, that
  routes all of that user's transcription provider requests (connection tests and
  transcriptions) through the saved proxy when on.
- **FR-008**: Settings → AI MUST show a "Use proxy" switch, saved per user, that routes all of
  that user's AI provider requests (connection tests, model listing, chat including streamed
  replies) through the saved proxy when on.
- **FR-009**: The "Use proxy" switches MUST be disabled with a link to Settings → Proxy when no
  proxy is saved, and MUST default to off.
- **FR-010**: When "Use proxy" is on and the proxy fails, the request MUST fail with an error
  that identifies the proxy as the cause; the system MUST NOT fall back to a direct connection.
- **FR-011**: When "Use proxy" is off, requests MUST behave exactly as they do today.
- **FR-011a**: Requests to a local provider address (this computer or a private-network address,
  as defined in Feature 005) MUST always connect directly, even when "Use proxy" is on; FR-010's
  no-fallback rule applies only to non-local addresses.
- **FR-012**: Proxy failures MUST NOT lose user work: recordings, notes and chat messages are
  kept and the action can be retried (Constitution Principle I).
- **FR-013**: The proxy MUST apply only to the app's outgoing requests to transcription and AI
  providers; the user's browser connection to the app and other app traffic are unaffected.
- **FR-014**: The Proxy page and switches MUST be fully keyboard operable, use theme tokens, and
  meet WCAG AA in light, dark and custom themes.

### Key Entities

- **Proxy configuration** (one per user, optional): type, host, port, optional username, optional
  password (stored encrypted, exposed only as a mask), last updated time.
- **Proxy usage preference** (per user, per section): whether Transcription requests use the
  proxy; whether AI requests use the proxy. Both default to off.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can add a proxy, test it, and enable it for transcription and AI in under
  2 minutes.
- **SC-002**: With "Use proxy" on, 100% of that section's requests to non-local providers go
  through the proxy and 0% go direct, including when the proxy fails; 100% of requests to local
  providers go direct.
- **SC-003**: With "Use proxy" off, transcription and AI chat behave identically to the release
  before this feature (no regressions in existing tests).
- **SC-004**: The proxy password never appears in full in any app response, log, or user file
  (verified by the same automated leak check used for API keys).
- **SC-005**: Every proxy failure shown to the user names the proxy as the cause, so users can
  tell a proxy problem from a provider problem without outside help.

## Assumptions

- One proxy per user is enough; per-provider proxies and multiple saved proxies are out of scope.
- Supported proxy types are HTTP, HTTPS and SOCKS5; PAC files, automatic system-proxy detection
  and user-editable bypass lists are out of scope (the only bypass is the fixed local-address rule).
- "LLM section" means Settings → AI (Feature 014); one switch covers all AI providers the user has
  configured, and one switch covers the transcription provider.
- The proxy is applied by the app's backend (where provider requests originate), so it works the
  same in the browser and desktop versions.
- Proxy credentials reuse the existing encrypted secret storage for API keys; no new storage or
  infrastructure is introduced.
