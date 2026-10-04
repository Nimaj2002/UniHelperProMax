# Feature Specification: Settings — Transcription Providers & Themes

**Feature Branch**: `005-settings-providers-themes`

**Created**: 2026-10-04

**Status**: Draft

**Input**: User description: "A settings area lets users choose a transcription provider: \"Voice Studio\" (default, needs only a server address) or \"OpenAI-compatible\" (server address, API key, model name). Users can test the connection. Themes: built-in light and dark, plus user-created themes where users customize colors; themes can be saved, exported to a file, and imported from a file. The selected theme applies across the whole app."

**Related**: Feature 004 (Transcription) uses the provider configured here. Constitution
Principles IV (pluggable providers, server-side keys) and V (light, dark, user-created themes,
WCAG AA) apply directly.

## Clarifications

### Session 2026-10-04

- Q: Should transcription provider settings belong to each user separately, or be one shared setup for everyone using this installation? → A: Per user — each user configures their own provider, address, key, model, and language; no shared/admin provider settings.
- Q: In the custom theme editor, should users pick only a few key colors with the rest derived, or edit every named color? → A: Simple by default (4 key colors: background, surface, text, accent; all others derived automatically), with an "Advanced" toggle to adjust any individual color.
- Q: If the OpenAI-compatible server address is plain `http://`, should the app still send the API key to it? → A: Only for local addresses (this computer or private-network addresses); public addresses MUST use `https://` when an API key is set.
- Q: Should the chosen theme follow the user to every device, or be remembered per device/browser? → A: Per account — one theme choice applied on every device the user signs in on; no per-device override.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Voice Studio (Priority: P1)

The student opens Settings → Transcription. "Voice Studio" is already selected as the default
provider. They enter the server address, press "Test connection", see it succeed, and save.
Transcription (Feature 004) now works.

**Why this priority**: Transcription cannot run without a configured provider, and Voice Studio
is the default path.

**Independent Test**: Enter a reachable Voice Studio address, test, save, reload Settings, and
confirm the address is kept and the provider shows as configured.

**Acceptance Scenarios**:

1. **Given** no provider has been configured, **When** the user opens Settings → Transcription,
   **Then** "Voice Studio" is preselected and only a server address field is shown.
2. **Given** a server address, **When** the user presses "Test connection", **Then** within 15
   seconds they see either success or a specific failure (address invalid, server unreachable,
   server responded but is not a compatible transcription service, timed out).
3. **Given** a valid address, **When** the user saves, **Then** the provider is shown as
   configured and Transcribe actions (Feature 004) use it.
4. **Given** a malformed address (not a valid web address), **When** the user tries to save or
   test, **Then** it is refused with an inline message.

---

### User Story 2 - Configure an OpenAI-compatible provider (Priority: P1)

The student switches the provider to "OpenAI-compatible", enters a server address, an API key,
and a model name, tests the connection, and saves. Later they see only the last 4 characters of
the key.

**Why this priority**: Users without a Voice Studio server need a hosted alternative; key
handling is security-critical.

**Independent Test**: Configure with valid values, test, save; reload and confirm the key is
masked and never retrievable in full; enter a wrong key and confirm the test reports invalid
credentials.

**Acceptance Scenarios**:

1. **Given** Settings → Transcription, **When** the user selects "OpenAI-compatible", **Then**
   fields for server address, API key, and model name are shown, all required.
2. **Given** entered values, **When** the user presses "Test connection", **Then** they see
   success or a specific failure (unreachable, invalid credentials, model not found, timed out).
3. **Given** a saved API key, **When** Settings is opened again, **Then** the key is shown only
   masked (e.g., "••••••••abcd") with "Replace" and "Remove" actions; the full key is never
   shown or sent back to the browser.
4. **Given** a saved key, **When** the user changes only the model name or address and saves,
   **Then** the stored key is kept without re-entering it.
5. **Given** the user switches provider from OpenAI-compatible to Voice Studio and saves,
   **When** they later switch back, **Then** the previously saved OpenAI-compatible settings
   (address, masked key, model) are still there.
6. **Given** a successful test, **When** the user saves, **Then** they can also choose the
   default spoken language for transcription (default "Auto-detect").

---

### User Story 3 - Choose a theme (Priority: P1)

The student switches from the light theme to dark. The whole app — calendar, course panel,
notes editor, player, dialogs — changes immediately, and the choice is remembered next time
they sign in.

**Why this priority**: The constitution requires every screen to support light and dark
themes; selecting them is the base of all theming.

**Independent Test**: Select each built-in theme and "Match system", confirm every main screen
changes immediately and the choice persists after sign-out/sign-in.

**Acceptance Scenarios**:

1. **Given** Settings → Appearance, **When** opened, **Then** the user sees "Light", "Dark",
   "Match system", and any user-created themes, each with a preview swatch, and the active one
   marked.
2. **Given** a theme is selected, **When** the user picks it, **Then** it applies immediately
   across the whole app without reload.
3. **Given** "Match system", **When** the operating system switches between light and dark,
   **Then** the app follows it.
4. **Given** a chosen theme, **When** the user signs in again (on the same or another browser),
   **Then** the same theme is applied from the first screen, without a flash of a different
   theme.

---

### User Story 4 - Create and edit a custom theme (Priority: P2)

The student creates "Sabancı Night" starting from the dark theme, changes the background,
accent, and text colours, sees a live preview with a contrast warning on one pair, fixes it,
and saves.

**Why this priority**: Personalisation is valued but not essential for core study flows.

**Independent Test**: Create a theme from a built-in base, change colours, observe live preview
and contrast warnings, save, apply it, then edit and delete it.

**Acceptance Scenarios**:

1. **Given** Settings → Appearance, **When** the user chooses "New theme", **Then** they name it
   and pick a starting point (Light, Dark, or an existing custom theme), and an editor opens with
   all its colours prefilled.
2. **Given** the theme editor in simple mode, **When** the user changes one of the 4 key
   colours (background, surface, text, accent) by picker or by typing a colour value, **Then**
   all other colours are re-derived and a live preview of representative UI (calendar block,
   note text, buttons, dialog, player) updates immediately.
3. **Given** the theme editor, **When** the user turns on "Advanced", **Then** every colour in
   the colour set is shown and can be changed individually; overridden colours are marked and
   can be reset to their derived value.
4. **Given** colour pairs that fall below WCAG AA contrast (e.g., text on background), **When**
   shown in the editor, **Then** each failing pair is flagged with its contrast ratio and the
   required minimum.
5. **Given** a theme with contrast warnings, **When** the user saves, **Then** they are told
   which pairs fail and must confirm; the theme is saved and marked "Low contrast".
6. **Given** a custom theme, **When** the user edits, renames, duplicates, or deletes it (with
   confirmation), **Then** the change is saved; deleting the active theme switches the app to
   the theme it was based on (Light or Dark).
7. **Given** unsaved changes in the editor, **When** the user leaves, **Then** they are asked to
   save or discard.
8. **Given** built-in Light and Dark, **When** the user tries to edit or delete them, **Then**
   it is not allowed; they can duplicate them instead.

---

### User Story 5 - Export and import themes (Priority: P3)

The student exports "Sabancı Night" to a file, sends it to a friend, and the friend imports it
into their own app.

**Why this priority**: Sharing themes is a convenience on top of custom themes.

**Independent Test**: Export a custom theme, delete it, import the file, and confirm the
restored theme is identical; import a corrupt file and confirm a clear error.

**Acceptance Scenarios**:

1. **Given** a custom theme, **When** the user chooses "Export", **Then** a single,
   human-readable theme file named after the theme is downloaded.
2. **Given** a valid theme file, **When** the user chooses "Import" and selects it, **Then**
   the theme appears in the list with identical colours, and the user can apply it.
3. **Given** an imported theme whose name already exists, **When** it is imported, **Then** it
   is added with a distinct name (e.g., "Sabancı Night (2)"); nothing is overwritten.
4. **Given** an invalid, corrupt, or unrelated file, **When** imported, **Then** the user sees a
   clear error and no theme is created.
5. **Given** a valid file from an older/newer version missing some colours or containing extra
   ones, **When** imported, **Then** missing colours are filled from the base theme, unknown
   ones are ignored, and the user is told.
6. **Given** an imported theme that fails AA contrast, **When** imported, **Then** it is marked
   "Low contrast" and the user is warned, same as in the editor.

---

### Edge Cases

- Provider test succeeds but the user changes a field afterwards: the success indicator resets
  until tested again.
- Saving without testing is allowed; the provider shows "Not tested" until a test succeeds or a
  transcription runs.
- Provider settings changed while a transcription is running (Feature 004): the running job
  finishes with the settings it started with; the next job uses the new settings.
- Removing the API key of the active OpenAI-compatible provider: the provider becomes "Not
  configured" and Transcribe explains this.
- Server address with or without trailing slash, or with a path: both forms work.
- OpenAI-compatible address using plain `http://` with an API key: accepted only when the host
  is this computer (e.g., `localhost`, loopback addresses) or a private-network address; for any
  public host, saving and testing are refused with a message asking for `https://`. A host name
  that resolves to a public address is treated as public. Voice Studio (no key) may use
  `http://` for any address.
- Test connection while offline: reports "server unreachable" rather than "invalid credentials".
- Theme file with a script, oversized content (over 100 KB), or invalid colour values: rejected.
- Theme names: empty or duplicate names are refused in the editor; very long names are
  truncated in lists with the full name on hover/focus.
- The active custom theme is deleted in another window: the app falls back to its base theme on
  next load.
- Class colours on the calendar (Feature 001) remain readable in every theme; in low-contrast
  custom themes the event text still uses a colour with adequate contrast against the class
  colour.

## Requirements *(mandatory)*

### Functional Requirements

**Settings area**

- **FR-001**: The app MUST provide a Settings area reachable from every main screen, with at
  least "Transcription" and "Appearance" sections.
- **FR-002**: Settings MUST be saved per user on the server and apply on every device/browser
  where the user signs in. Provider settings (provider, address, key, model, language) are
  strictly per user: no user can see, use, or change another user's provider settings, and
  there is no shared or admin-level provider configuration.

**Transcription provider**

- **FR-003**: Users MUST be able to choose one active transcription provider from the list the
  server offers; the first release offers "Voice Studio" and "OpenAI-compatible".
- **FR-004**: "Voice Studio" MUST be the default selection and require only a server address.
- **FR-005**: "OpenAI-compatible" MUST require a server address, an API key, and a model name.
- **FR-006**: The fields shown MUST be determined by the selected provider's declared
  requirements, so adding a provider later needs no change to the Settings screens
  (constitution Principle IV).
- **FR-007**: Server addresses MUST be validated as well-formed web addresses before saving or
  testing. When an API key is configured, the address MUST use `https://` unless its host is
  this computer or a private-network address; the API key MUST never be sent to a public host
  over plain `http://`.
- **FR-008**: Users MUST be able to test the connection with the entered (unsaved or saved)
  values; the result (success or a specific failure category) MUST appear within 15 seconds.
- **FR-009**: API keys MUST be stored only on the server, MUST never be returned to or shown in
  the browser in full after saving (at most the last 4 characters), and MUST never appear in
  logs or error messages.
- **FR-010**: Users MUST be able to replace or remove a saved API key; editing other fields MUST
  not require re-entering the key.
- **FR-011**: Settings for each provider MUST be retained when switching the active provider.
- **FR-012**: Users MUST be able to set a default transcription language ("Auto-detect" by
  default), used by Feature 004.
- **FR-013**: The provider status MUST be shown as "Not configured", "Not tested", "Connected",
  or "Last test failed: <reason>".

**Themes**

- **FR-014**: The app MUST include built-in "Light" and "Dark" themes that cannot be edited or
  deleted, plus a "Match system" option; the default for new users is "Match system".
- **FR-015**: The selected theme MUST apply immediately and consistently to every screen,
  component, and dialog in the app. The choice is stored per account (not per device) and
  applied on every device and browser where the user signs in; there is no per-device
  override. "Match system" resolves to light or dark using each device's own system setting.
- **FR-016**: Users MUST be able to create custom themes by name, starting from Light, Dark, or
  another custom theme.
- **FR-017**: The theme editor MUST open in a simple mode where the user sets 4 key colours
  (background, surface/card, text, accent) and every other colour is derived automatically,
  with derived text/background pairs chosen to meet WCAG AA where possible. An "Advanced"
  toggle MUST let the user override any individual colour in the app's defined colour set (at
  minimum: background, surface/card, primary text, secondary/muted text, border, primary
  accent and its text, secondary accent, focus ring, success, warning, danger, editor
  background, and calendar grid lines). Changing a key colour in simple mode MUST NOT discard
  colours the user overrode in Advanced mode without warning. The editor shows a live preview
  in both modes.
- **FR-018**: The editor MUST check WCAG AA contrast for every text/background and
  control/background pair it defines, flag each failing pair with its ratio, and require
  confirmation to save a failing theme, which is then marked "Low contrast".
- **FR-019**: Users MUST be able to rename, duplicate, edit, and delete (with confirmation)
  custom themes; deleting the active theme MUST fall back to its base built-in theme.
- **FR-020**: Users MUST be able to export a custom or built-in theme as a single human-readable
  file and import such a file to create a theme.
- **FR-021**: Import MUST validate the file, reject invalid or unsafe content with a clear
  message, never overwrite an existing theme, fill missing colours from the base theme, and
  ignore unknown entries.

**Quality**

- **FR-022**: All of Settings, including the colour editor, MUST be fully keyboard operable,
  and colour values MUST be enterable as text (not only via a visual picker).
- **FR-023**: Settings screens MUST meet WCAG AA in built-in themes and render correctly in any
  custom theme.

### Key Entities

- **User Settings**: Per user: active transcription provider, default transcription language,
  selected theme (built-in, "Match system", or a custom theme).
- **Provider Configuration**: Per user and provider: server address, credentials (stored
  server-side only, displayed masked), model name where required, last test result and time.
- **Transcription Provider (definition)**: A provider offered by the server, with its display
  name and the fields it requires.
- **Theme**: Name, base (Light or Dark), 4 key colours, the set of individually overridden
  colours (Advanced), the resulting full colour set, built-in or custom, contrast status ("OK"
  or "Low contrast").
- **Theme File**: Exported representation of one theme: name, base, key colours, overridden
  colours, full resolved colour set, format version.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can configure Voice Studio and see a successful connection test in under 1
  minute.
- **SC-002**: A user can configure the OpenAI-compatible provider and see a successful test in
  under 2 minutes.
- **SC-003**: After saving, a full API key never appears in any screen, browser response, or log
  — verified across all settings flows.
- **SC-004**: Switching themes updates every screen in under 0.5 seconds with no reload, and no
  screen shows unthemed (hard-coded) colours.
- **SC-005**: A user can create a custom theme from a base and apply it in under 3 minutes.
- **SC-006**: Exporting a theme and importing the file reproduces 100% of its colours.
- **SC-007**: 100% of colour pairs failing WCAG AA in a custom theme are flagged before saving.
- **SC-008**: Every flow in this feature can be completed using only the keyboard.

## Assumptions

- "Voice Studio" is an external transcription server the user runs or has access to; this
  feature only connects to it and does not install or manage it.
- Settings, including provider settings, are per user regardless of the account model chosen in
  Feature 001 (confirmed in Clarifications).
- Only one provider is active at a time; per-transcription provider choice is out of scope.
- Theme customisation covers colours only; fonts, spacing, corner radius, and layout are out of
  scope.
- Sharing themes happens by exchanging files outside the app; an in-app theme gallery is out of
  scope.
- Account settings (password, profile) belong to the account feature, not this one.
- This feature supersedes the settings portion of Feature 004 (User Story 4 and FR-018–FR-021),
  which now refer to this spec.
