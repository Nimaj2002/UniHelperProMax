# Feature Specification: Simple UI Mode

**Feature Branch**: `026-simple-ui-mode`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "I want a completely new UI for the app, but I want users to be able to choose between them. The current UI should be called Ultimate, the new UI is called Simple. The new UI should look like Claude or GPT websites: a simple bar on the left and the main section on the right. The ordering of the left panel sections should be general."

## Clarifications

### Session 2026-11-24

- Q: Should the interface choice be saved on the account or only per device? → A: Per account, synced across devices (backend setting).
- Q: What should the main area show when a Simple user opens the app? → A: The calendar (not an AI chat box).
- Q: How should courses and classes be listed in the Simple sidebar? → A: A single "Courses" sidebar section (no tree); selecting it shows a grid of course boxes (Moodle-style) in the main area.
- Q: How should a class session's tools be arranged in Simple? → A: Opening a session changes the sidebar: it keeps Calendar and adds sections mirroring Ultimate's right-hand panel (Recordings, Chat, Teacher, Time) plus Notes and PDFs/Documents sections; the main area keeps Ultimate-style tabs.
- Q: Which top-level areas does Simple include? → A: Core only: Calendar (events are created and viewed there, no separate Events entry), Courses, Tasks, AI chat, Settings. The Graph view stays Ultimate-only for now.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use the app through a Simple, sidebar-style interface (Priority: P1)

A student who finds the current interface busy switches to the Simple interface. They see a single slim sidebar on the left and one large main area on the right, like a modern AI chat website. The sidebar lists everything they can reach (calendar, AI chat, courses and classes, notes, tasks, recordings, settings), ordered from most general to most specific. Selecting an item shows it in the main area.

**Why this priority**: This is the feature itself: a complete alternative layout that makes every existing capability reachable.

**Independent Test**: Choose Simple, then reach every top-level area (calendar, AI chat, courses, class sessions with notes/PDFs/recordings, tasks, settings) using only the sidebar and the main area.

**Acceptance Scenarios**:

1. **Given** Simple is active, **When** the app loads, **Then** the screen shows only a left sidebar and a main content area, with no other persistent panels or rails.
2. **Given** Simple is active, **When** the user selects any sidebar item, **Then** that area opens in the main section and the item shows as selected.
3. **Given** Simple is active, **When** the user opens a class session, **Then** the sidebar changes to a session sidebar (Calendar, Recordings, Chat, Teacher, Time, Notes, PDFs) and the main area shows Ultimate-style tabs, with the same capabilities as in Ultimate.
4. **Given** Simple is active, **When** the user views the sidebar, **Then** sections run general → specific: global actions first (e.g. search, AI chat), then workspace-wide areas (calendar, tasks), with the calendar shown by default, then Courses (one entry that opens a grid of course boxes in the main area), with account and settings at the bottom.

---

### User Story 2 - Choose between Ultimate and Simple (Priority: P1)

A user can pick which interface to use, at any time, from a clearly labelled setting. The current interface is named **Ultimate**; the new one is named **Simple**. The choice is remembered, and switching never changes or loses their data.

**Why this priority**: Choice is the user's core requirement; without it the existing users would be forced onto a new layout.

**Independent Test**: Switch Simple → Ultimate → Simple; confirm the layout changes each time, persists across reload and sign-in, and no notes, tasks, recordings or chats are altered.

**Acceptance Scenarios**:

1. **Given** a user in Ultimate, **When** they open the interface setting and choose Simple, **Then** the app switches to Simple immediately without a full sign-out or data loss.
2. **Given** a user chose Simple, **When** they reload or sign in again (including on another device), **Then** Simple is shown.
3. **Given** an existing user who never chose, **When** they open the app after this feature ships, **Then** they see Ultimate exactly as before.
4. **Given** the user is on a specific page (e.g. a note), **When** they switch interface, **Then** they land on the equivalent page in the other interface.
5. **Given** a user has unsaved note edits, **When** they switch interface, **Then** the edits are saved or preserved and not lost.

---

### User Story 3 - Switch interface from where you are (Priority: P2)

The interface switch is reachable from the sidebar's account/settings area in Simple and from the existing account/settings area in Ultimate, so a user who lands in the wrong one can always get back.

**Why this priority**: Prevents users getting stuck, but the setting alone (Story 2) already delivers the choice.

**Independent Test**: From each interface, switch to the other in no more than two interactions without opening unrelated pages.

**Acceptance Scenarios**:

1. **Given** Simple is active, **When** the user opens the account menu at the bottom of the sidebar, **Then** an option to switch to Ultimate is present.
2. **Given** Ultimate is active, **When** the user opens its account menu or settings, **Then** an option to switch to Simple is present.

---

### User Story 4 - Comfortable on small screens and with keyboard (Priority: P3)

On narrow screens the Simple sidebar collapses into a toggleable drawer; on any screen the sidebar can be collapsed to give the main area more room. Everything is operable by keyboard and works in light, dark and custom themes.

**Why this priority**: Polish and accessibility expectations; the interface is usable without it on desktop.

**Independent Test**: Resize to phone width and use only the keyboard to open the sidebar, navigate, and close it.

**Acceptance Scenarios**:

1. **Given** a narrow viewport, **When** the app loads in Simple, **Then** the sidebar is hidden behind a visible menu button and opens as an overlay.
2. **Given** a wide viewport, **When** the user collapses the sidebar, **Then** the main area expands and the collapsed state is remembered.

---

### Edge Cases

- A user's saved preference is missing or unrecognised: fall back to Ultimate.
- A feature that exists only in a panel of Ultimate (e.g. course side panels, activity pills, guided tour, teacher): Simple must still expose it somewhere in the main area or a sidebar entry, or explicitly list it as out of scope.
- Deep links and bookmarks to any page open correctly in whichever interface is active.
- Many courses: the course grid wraps and can be filtered by semester/search, and the sidebar stays short.
- Active background work (a recording in progress, a transcription, a streaming AI answer) continues uninterrupted when the user switches interface.
- Desktop (Electron) and the browser demo mode both offer the same choice.
- A user with no courses or classes sees a helpful empty state in the sidebar rather than blank space.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST offer two selectable interfaces named **Ultimate** (the current interface, unchanged in behaviour) and **Simple** (new).
- **FR-002**: Simple MUST present a single left sidebar plus one main content area, in the visual style of mainstream AI chat websites (minimal chrome, generous whitespace, one primary column).
- **FR-002a**: On opening the app (or its root address), Simple MUST show the calendar in the main area; the AI chat is a sidebar entry like any other.
- **FR-002b**: The sidebar MUST contain a "Courses" section; selecting it MUST show one box (card) per course in the main area, and selecting a box opens that course with its class sessions. The sidebar itself MUST NOT list individual courses or classes.
- **FR-002c**: When a class session (or event) is open, the Simple sidebar MUST switch to a session sidebar that still includes Calendar and adds entries for the tools Ultimate shows in its right panel (Recordings, Chat, Teacher, Time) and for the session's Notes and PDFs/Documents. Selecting an entry opens or focuses that tool in the main area, and the main area MUST present open items as tabs behaving like Ultimate's workspace tabs. The sidebar MUST offer a clear way back to the general (non-session) sidebar.
- **FR-003**: Every capability reachable in Ultimate MUST be reachable in Simple, except the Graph view, which is out of scope for Simple in this feature. Events are reached and managed through the calendar.
- **FR-004**: The Simple sidebar MUST order its sections from general to specific: global actions, workspace-wide areas, Courses, then account and settings.
- **FR-005**: Users MUST be able to switch interface at any time from a labelled setting, and from the account menu of each interface.
- **FR-006**: The chosen interface MUST be saved on the user's account (a backend-stored setting) and persist across reloads, sign-ins and devices; the browser demo, which has no backend, keeps it in its in-memory store.
- **FR-007**: Existing users MUST default to Ultimate; the default for newly created accounts is Ultimate unless decided otherwise at planning.
- **FR-008**: Switching interface MUST NOT modify, delete or lose any user data, and MUST NOT interrupt a recording, transcription or AI response in progress.
- **FR-009**: Switching interface MUST preserve the current location (the equivalent page) and any unsaved edits.
- **FR-010**: Simple's sidebar MUST be collapsible, remember its collapsed state, and become an overlay drawer on narrow screens.
- **FR-011**: Simple MUST support light, dark and custom themes, be fully keyboard-operable, and meet WCAG AA, as Ultimate does.
- **FR-012**: Simple MUST show helpful empty states and loading states for the sidebar and main area.
- **FR-013**: The interface choice MUST work identically in the web app, the desktop app and the browser demo.
- **FR-014**: Both interfaces MUST share the same routes/URLs so links work regardless of the active interface.

### Key Entities

- **Interface preference**: The user's chosen interface (Ultimate or Simple), stored per user, defaulting to Ultimate.
- **Sidebar sections**: Ordered navigation entries in Simple (global actions, workspace areas, Courses, account/settings) and the collapsed/expanded state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can switch between Ultimate and Simple in under 10 seconds from either interface, with zero data changes.
- **SC-002**: 100% of top-level areas (except Graph) and per-session tools available in Ultimate are reachable in Simple, verified by a feature-parity checklist.
- **SC-003**: A first-time Simple user can open a class note, a task, and the calendar within 30 seconds without guidance.
- **SC-004**: Simple shows at most one persistent navigation region (the sidebar) at any time on desktop.
- **SC-005**: The saved choice is applied on 100% of reloads and sign-ins, including after a switch on another device.
- **SC-006**: Simple passes the same accessibility checks (automated and keyboard-only) as Ultimate at phone, tablet and desktop widths.

## Assumptions

- Ultimate is the existing interface renamed only in what users see; its behaviour and layout do not change.
- The preference is stored on the user's account so it follows them across devices; a device-local fallback applies before sign-in.
- Both interfaces share the same pages, data and URLs; Simple is a different layout and navigation, not a different set of features.
- Spec 023 guided tour, 022 AI teacher and 025 media editor remain available in Simple; any needing layout-specific adaptation is handled during planning.
- Visual inspiration is Claude/ChatGPT-style layouts; no copying of their branding or assets.
- Default for new accounts remains Ultimate (can be revisited in clarify).
