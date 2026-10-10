# UI Contract: Floating Card Layout

**Feature**: 008-floating-card-layout. This contract is the source of truth for landmarks, control
names, shortcuts and the action inventory (SC-002). Tests select elements by these roles and names.

## 1. Geometry

| Property | Value |
|---|---|
| Window padding / gap between cards | 8 px |
| Card corner radius | 14 px |
| Card border | 1 px `--border` |
| Card surface / window background | `--surface-elevated` / `--surface` |
| Card inner padding (content never touches the edge) | ≥ 8 px |
| Left card width (docked, open) | 240–480 px, default 280 |
| Left rail width (docked, closed) | 44 px |
| Audio card width (docked, open) | 260–640 px, default 300 |
| Main card minimum width | 480 px |
| Workspace tab row height | 40 px (only fixed bar in a notes tab) |
| Overlay breakpoint | < 1100 px |
| Supported minimum window width | 800 px |
| Open/close animation | ≤ 200 ms; none under `prefers-reduced-motion: reduce` |

## 2. Landmarks

| Region | Element / role | Accessible name | id |
|---|---|---|---|
| Left card (open or rail) | `aside` (complementary) | "Side panel" | `course-panel` |
| Main card | `main` | "Workspace" | `main` |
| Audio card (session workspace only) | `aside` (complementary) | "Audio" | `workspace-audio-panel` |
| Activity pills (inside main card) | `region` | "Activity" | — |
| Course list (inside left card) | `nav` | "Courses" | — |
| Session timeline (inside left card) | `nav` | "Sessions of this course" | — |

There are no `header`/`banner` or `contentinfo` landmarks spanning the window.

## 3. Left card

Top to bottom:

1. **Header**:
   - App name link "UniHelperProMax" (name "Go to home").
   - Icon button "Hide side panel" (`aria-controls="course-panel"`, `aria-keyshortcuts="BracketLeft"`).
2. **Search**: input `#course-search` (label "Search courses", `aria-keyshortcuts="/"`).
3. **Course list**: collapsible section "Courses" (formerly "Academic years") with icon button "New class" beside its heading.
4. **"Sessions and notes"** (shown when a course or session is open): collapsible sections, in order:
   - Notes (with "New note")
   - Documents (Feature 007)
   - Sessions (timeline: past normal, upcoming muted, current highlighted)
5. **Footer** (pinned): button "Account menu" (label "Account", opens the existing menu: Signed in
   as…, Settings, Change password, Time zone…, Manage accounts [owner], Sign out) and icon button
   "Settings".

**Rail** (docked, closed), 44 px:
- Icon button "Show side panel"
- App mark (link "Go to home")
- Footer: icon buttons "Account menu" and "Settings"

**Narrow window (< 1100 px)**:
- The left card is hidden completely when closed.
- An open overlay takes focus itself (not its first button, whose tooltip would swallow the first
  Escape) and is modal: the page behind it is hidden from assistive technology until it closes.
- Icon button "Show side panel" sits at the left end of the main card's top bar.
- When open, the card floats over the main card. It closes with Escape or "Hide side panel", and
  focus returns to the opener.

## 4. Main card top bars

The right end of every top bar holds the toggle button "Enter focus mode" / "Leave focus mode"
(`aria-pressed`, `aria-keyshortcuts="Backslash"`).

| Page | Fixed bar contents (start → end) |
|---|---|
| Calendar | ["Show side panel" (narrow)] · Today · Previous / Next · range heading (h1) · "New class" · Day/Week/Month · focus mode |
| Course page | ["Show side panel" (narrow)] · … · focus mode |
| Settings, Accounts | ["Show side panel" (narrow)] · … · focus mode |
| Session workspace | ["Show side panel" (narrow)] · tablist "Open notes and documents" (scrolls horizontally; each tab: name, then its save state as an icon with the words for screen readers) · Live/Raw · session chip · split toggle (icon, name "Split", Alt+\) · ["Show audio panel" (audio card closed)] · focus mode |

### Session chip

- A button whose visible text is `EEE d MMM · HH:mm–HH:mm`, plus an "Upcoming" marker when the
  session is upcoming.
- Name pattern: "Session details: {full date}, {start}–{end}{, upcoming}".
- It opens a popover (dialog semantics) with:
  - the course (link to the course page)
  - the title
  - the location (only if set)
  - the links (only if any; open in a new tab)
  - the status (Upcoming / In progress / Past; "No longer scheduled" when it applies).

### "Show audio panel"

The base name changes with activity:

| Activity | Accessible name | Visual |
|---|---|---|
| None | "Show audio panel" | — |
| Recording | "Show audio panel, recording in progress" | Pulsing danger dot |
| Transcribing | "Show audio panel, transcription running" | Spinning ring (static under reduced motion) |
| Both | Both suffixes | Both indicators |

### Floating elements

- **Save chip**: at the bottom-right of each editor pane. It is a live region, polite, with the
  labels "Saved", "Saving…", "Not saved — retrying", "Conflict". It takes no layout space.
- **Activity pills**: at the bottom center, stacked with recording above transcription. They keep
  clear of the save chip and stay visible in focus mode. The transcription pill gains the Cancel
  control the spec asks for (the old bar only offered it under the recording).
  - Recording pill: dot, elapsed time, label, "Go to session" (when not on that session), "Stop".
  - Transcription pill: "Transcribing", recording → note, progress, "Go to session", "Cancel".

## 5. Audio card

- **Header**: h2 "Audio" · button "Record" · icon button "Upload audio" · icon button "Hide audio panel"
  (`aria-keyshortcuts="Alt+BracketRight"`).
- **Body**: the recordings list with players and Transcribe buttons, unchanged.
- **Resize handle**: "Resize audio panel" (WAI-ARIA separator). Arrows, Home/End and Enter work as
  today. It stops at the main card's 480 px minimum.

## 6. Keyboard shortcuts (inventory, all unchanged except one addition)

| Key | Scope | Action | Status |
|---|---|---|---|
| `\` | global, not while typing, no modifiers | Toggle focus mode | **new** |
| `[` | global, not while typing | Toggle the left card (docked: open ↔ rail; narrow: overlay) | unchanged |
| `/` | global, not while typing | Focus course search; opens the left card first if it is closed (new: before 008 the key did nothing while the panel was hidden) | extended |
| t d w m j k ← → n ? | calendar | Today, Day/Week/Month, previous/next, New class, help | unchanged |
| Alt+N, Alt+Shift+N, Alt+W, Alt+PageDown/PageUp | workspace | New note, …, close tab, next/previous tab | unchanged |
| Alt+[ | workspace | Collapse/expand the workspace sections in the left card (opens it if needed) | unchanged |
| Alt+] | workspace | Toggle the audio card | unchanged |
| Alt+\ | workspace | Toggle split view | unchanged |
| Mod+E, Mod+Enter, Esc, Tab, Mod+F … | note editor | Editor keymap | unchanged |
| Ctrl/Cmd+F, + − 0, Z, Shift+Z, Ctrl+Y, PageUp/PageDown, Home/End, Esc, Enter | PDF reader | Reader keymap | unchanged |
| Space/K, J/←, L/→, ↑/↓, M | audio player | Player keymap | unchanged |
| ←/→ Home End Delete Shift+F10 | tab list | Tab navigation and menu | unchanged |
| Arrows, Home/End, Enter | resize handles | Resize and reset | unchanged |
| Alt+↑/↓ | course list years | Reorder | unchanged |

Focus mode interplay: `[` and Alt+] pressed during focus mode leave focus mode first, then apply
their toggle.

## 7. Action inventory (SC-002)

Every action below must be reachable by keyboard and pointer after the change. The "before" column
records where it was.

| Action | Before | After |
|---|---|---|
| Toggle side panel | TopBar button, `[` | Left card header / rail / narrow main-bar button, `[` |
| Go home | TopBar app name | Left card app name, rail app mark |
| New class | TopBar action, `n` on calendar | Course list heading "+", calendar toolbar, `n` |
| Settings | TopBar gear, Account menu item | Left card footer / rail, Account menu item |
| Account menu items, Sign out | TopBar Account menu | Left card footer / rail Account menu |
| Calendar navigation and views | TopBar toolbar slot | Calendar card toolbar |
| Back to course | Workspace header link | Session chip details → course link; course list |
| Session date/location/status | Workspace header | Session chip + details |
| Show/hide audio | Header right toggle, Alt+] | Audio card close button, tab row "Show audio panel", Alt+] |
| Show/hide workspace sections (narrow) | Header left toggle, Alt+[ | Left card (overlay), Alt+[ |
| Stop recording / Go to session | Activity bar | Recording pill |
| Cancel transcription / Go to session | Activity bar | Transcription pill |
| Split view, tabs, Live/Raw | Tab row | Tab row (unchanged) |
| Focus mode | — | Focus mode button, `\` |
