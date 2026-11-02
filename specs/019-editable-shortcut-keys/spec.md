# Feature Specification: Editable Shortcut Keys

**Feature Branch**: `019-editable-shortcut-keys`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "add the feature of editing the shortcut keys"

## Context

Settings → Keyboard shortcuts already lists every shortcut in the app, grouped by area (General,
Notes workspace, AI chat, Calendar, Task board, Recording player, PDF annotations, Diagram viewer),
but the list is read-only. Some defaults clash with keys people already rely on (other apps, the
operating system, non-US keyboard layouts), and people cannot change them. This feature makes
every shortcut on that page editable.

## Clarifications

### Session 2026-11-02

- Q: Should the keys that only work inside one tool also be editable, or only the app-wide commands? → A: Everything on the shortcuts page is editable, including arrows, Enter, Esc and Space inside each tool (task board, calendar grid, recording player, PDF annotations, diagram viewer, chat box).
- Q: When can two commands share a combination? → A: Two commands conflict only if they can fire from the same place: two app-wide commands, or two commands in the same tool. An app-wide key also conflicts with any in-tool key it would override.
- Q: Should a command be able to have more than one shortcut? → A: Up to two per command (a main key and an alternate), each edited, removed and reset on its own.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Change a shortcut (Priority: P1)

A student opens Settings → Keyboard shortcuts, picks a command (for example "New note", today
Alt+N), presses the new key combination they want, and from then on that combination performs
the command everywhere the old one did. The old combination no longer does it.

**Why this priority**: This is the feature. Everything else supports it.

**Independent Test**: Change "New note" to another free combination, go to a session workspace,
press the new combination and see a new note open; press the old one and see nothing happen.

**Acceptance Scenarios**:

1. **Given** the shortcuts page, **When** the user chooses to edit "New note" and presses
   Alt+Shift+M, **Then** the page shows Alt+Shift+M for "New note" and the change is saved
   without a separate save step.
2. **Given** "New note" was changed to Alt+Shift+M, **When** the user presses Alt+Shift+M in a
   session workspace, **Then** a new note is created; **When** they press Alt+N, **Then** no new
   note is created.
3. **Given** the user is recording a new combination, **When** they choose "Cancel" or move
   focus away, **Then** the edit is cancelled and the previous shortcut stays. (Esc is recorded
   like any other key, so it can itself be assigned.)
4. **Given** a changed shortcut, **When** the user hovers or focuses the control that runs that
   command (tooltip, keyboard hint), **Then** the hint shows the new combination, not the default.
5. **Given** a changed shortcut, **When** the user signs in on another device or after a
   restart, **Then** the changed shortcut is still in effect.

---

### User Story 2 - Prevent and resolve conflicts (Priority: P1)

When the user picks a combination that another command in the same area already uses, the app
says which command uses it and does not silently give two commands the same keys.

**Why this priority**: A silent clash would make one of the commands unreachable, which is worse
than having no editing at all.

**Independent Test**: Try to set "Close the current tab" to the combination used by "New note";
see the conflict message naming "New note" and the two choices.

**Acceptance Scenarios**:

1. **Given** "New note" uses Alt+N, **When** the user tries to set "Close the current tab" to
   Alt+N, **Then** the app names "New note" as the current owner and offers to either reassign
   (New note loses its shortcut and shows "Not set") or cancel.
2. **Given** the user picks a combination reserved by the app or the system (see FR-007),
   **Then** the app refuses it with a short reason and keeps the previous shortcut.
3. **Given** the user picks a single key with no modifier (for example "Q") for a command that
   also works while typing (the Notes workspace commands), **Then** the app refuses it and
   explains that the key would type text instead.

---

### User Story 3 - Reset to defaults (Priority: P2)

The user can undo their customisation: reset one shortcut, or reset all of them at once.

**Why this priority**: Makes experimenting safe, but the feature is usable without it.

**Independent Test**: Change two shortcuts, reset one, check it shows its default again; then
reset all and check both show defaults.

**Acceptance Scenarios**:

1. **Given** a changed shortcut, **When** the user chooses "Reset" on it, **Then** it returns to
   its default — unless another command now uses that default, in which case the conflict flow
   of User Story 2 applies.
2. **Given** several changed shortcuts, **When** the user chooses "Reset all" and confirms,
   **Then** every shortcut returns to its default.
3. **Given** the shortcuts page, **Then** each changed shortcut is visibly marked as changed
   from its default.

---

### User Story 4 - Remove a shortcut (Priority: P3)

The user can clear a shortcut so the command has no key combination at all (it stays reachable
through its button or menu).

**Why this priority**: Useful when a shortcut keeps firing by accident; least common need.

**Independent Test**: Clear "Toggle focus mode", press "\" and see nothing happen; the focus
mode button still works.

**Acceptance Scenarios**:

1. **Given** a shortcut, **When** the user chooses "Remove", **Then** that slot shows
   "Not set" and pressing the old keys does nothing.
2. **Given** play/pause has Space (main) and K (alternate), **When** the user removes the
   alternate, **Then** Space still plays/pauses and K does nothing.

### Edge Cases

- The user presses only a modifier (Alt, Shift, Ctrl) while recording: nothing is recorded yet;
  the app waits for a non-modifier key.
- Two in-tool commands in different tools (for example the Recording player and PDF annotations,
  both open in one session workspace) may share a combination, because each fires only while
  its own tool has keyboard focus.
- A single-key shortcut (no modifier) must keep today's rule: it is ignored while the user types
  in a text field.
- Non-US keyboard layouts and macOS Option characters: a shortcut recorded by key position must
  keep working on the layout where it was recorded; the displayed label shows the key the user
  pressed.
- An app update adds a new command whose default is already used by one of the user's custom
  shortcuts: the user's choice wins, the new command starts as "Not set", and the shortcuts page
  marks it so the user can pick a combination.
- An app update removes or renames a command: a stored custom shortcut for it is dropped without
  error.
- Saving the change fails (offline, server error): the page shows that the change was not saved
  and the previous shortcut stays in effect.
- Backup and restore: custom shortcuts are part of the user's settings and come back after a
  restore.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Settings → Keyboard shortcuts page MUST let the user edit every shortcut it
  lists.
- **FR-002**: The editable set MUST be every command on the page, in every group: General, Notes
  workspace, AI chat (send, new line, stop generating), Calendar (including the arrow-key, range
  and Enter/Esc keys of the calendar grid), Task board, Recording player, PDF annotations and
  Diagram viewer. A row that today covers several commands (for example "← / →" for previous /
  next period) MUST be split so each command is edited on its own.
- **FR-002a**: Each command MUST have two shortcut slots, main and alternate. Today's second keys
  (for example K for play/pause, J/L for skip, Esc for finish editing) become the alternate
  default. Each slot MUST be editable, removable and resettable on its own, and the conflict
  rules (FR-006) apply to each slot.
- **FR-003**: To edit, the user MUST be able to start recording on a command, press the new
  combination, and have it captured from that key press, with no typing of key names. Recording
  MUST be cancelled by a visible "Cancel" control or by moving focus away; Esc MUST be
  recordable as a key.
- **FR-004**: A changed shortcut MUST take effect immediately, without reload, and the old
  combination MUST stop running that command.
- **FR-005**: Every place that shows a command's shortcut (tooltips, inline key hints, the
  calendar's "?" shortcut list, and accessibility shortcut announcements) MUST show the user's
  current combination, or nothing if it is not set.
- **FR-006**: Each command MUST have a scope: app-wide (General, Notes workspace, Calendar
  actions) or one tool (task board, calendar grid, recording player, PDF annotations, diagram
  viewer, chat box), where it fires only while that tool has keyboard focus. Two commands
  conflict when they share a combination and either (a) both are app-wide, (b) both are in the
  same tool, or (c) one is app-wide and the other is in a tool where the app-wide key would
  override it. Commands in different tools never conflict. The app MUST NOT allow a conflict:
  on a clash it MUST name the other command and offer reassign or cancel.
- **FR-007**: The app MUST refuse combinations that cannot work or would break basic use:
  modifier-only presses; Tab and Shift+Tab (needed to move between controls); and the operating
  system's and browser's common reserved combinations (copy, paste, cut, undo, redo, select all,
  close window, quit, reload).
- **FR-007a**: Every in-tool command MUST keep a way to be performed without its shortcut (a
  button, menu item or pointer action), so removing or remapping a key never leaves a tool
  unusable. If a command that exists only as a key would lose that guarantee, the app MUST
  refuse to remove its last remaining shortcut.
- **FR-008**: Commands that also work while typing in the editor (Notes workspace) MUST require
  at least one of Alt, Ctrl or Cmd; commands that are ignored while typing MAY use a single key.
- **FR-009**: The user MUST be able to reset one shortcut, reset all shortcuts (with
  confirmation), and remove a shortcut so it shows "Not set".
- **FR-010**: The page MUST mark each shortcut that differs from its default.
- **FR-011**: Custom shortcuts MUST be saved to the user's account automatically when changed,
  apply on every device the user signs in on, and be included in the user's backup and restore.
- **FR-012**: If saving fails, the page MUST say so and the last saved shortcut MUST stay in
  effect.
- **FR-013**: The editor MUST be fully usable by keyboard and screen reader: the recording state
  is announced, and the result (saved, conflict, refused) is announced.

### Key Entities

- **Command**: an action the user can run by shortcut. Has a name, the area it belongs to, a
  scope (app-wide or one tool, see FR-006), a default combination (or none), and whether it also
  works while typing.
- **Custom shortcut**: the user's override for one slot (main or alternate) of one command: a
  combination, or "Not set". Only overrides are stored; a slot without one uses its default.
- **Combination**: a key (by position on the keyboard) plus modifiers (Alt, Ctrl/Cmd, Shift),
  with a readable label of what the user pressed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can change a shortcut, from opening the shortcuts page to using the new
  combination, in under 30 seconds.
- **SC-002**: 100% of editable commands run on their new combination and not on their old one
  right after a change, with no reload.
- **SC-003**: No reachable state contains a conflict as defined in FR-006.
- **SC-004**: After signing in on a second device or restoring a backup, 100% of custom
  shortcuts are present.
- **SC-005**: Every key hint shown in the app for an editable command matches the user's current
  combination.

## Assumptions

- Shortcuts are per user account, like themes, and are stored with the user's other settings
  (which already sync across devices and are part of backup).
- Text editing keys inside the note editor itself (typing, cursor movement, formatting) are not
  on the shortcuts page and are out of scope.
- More than two combinations per command and two-step chord shortcuts are out of scope.
- Import/export of shortcut sets and named presets are out of scope.
- The desktop app and the web app use the same editable set; system-wide (outside the app
  window) shortcuts are out of scope.
- The existing automated conflict check over default bindings stays and also covers defaults
  added later.
