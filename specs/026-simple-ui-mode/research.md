# Research: Simple UI Mode

**R1 – Where the choice is stored (spec clarification: per account).** Decision: new optional
`uiMode` (`"ultimate" | "simple"`) on the existing `Preferences` object (`PATCH /api/v1/preferences`,
JSON in `ui_preferences.data`). Rationale: `theme`, `editorMode`, `tour` already follow this pattern;
no migration, backups already include the table, demo mode's preferences handler merges any field.
Alternatives: new `/ui-mode` endpoint or table (more surface, no benefit); localStorage only (rejected
by clarification Q1). Before preferences load, the shell renders Ultimate's skeleton, so existing
users never see a flash of Simple; absent/unknown value ⇒ Ultimate.

**R2 – One route tree, two shells.** Decision: `AppShell` stays the route element; it chooses the
chrome. Pages, URLs, `GlobalHosts` (recording, chat, transcription, tour) are shared, so a switch
never unmounts background work (FR-008/009/014). Alternative: separate route trees (duplicated
links, harder parity) rejected.

**R3 – Session workspace in Simple.** `WorkspacePage` builds a `RightCard` (SessionPanel with
Recordings/Chat/Teacher/Time) and registers it via `useRightCard`. Decision: add a `uiMode` check at
that one seam: in Simple it registers no right card; the Recordings, Chat, Teacher and Time sections
become sidebar entries that open as workspace tabs (chat and teacher are already tab kinds; add
`recordings` and `time` panel tab kinds that render the registered panel components). Notes and
Documents entries come from the same `registerSidePanelSection` registry Ultimate's left card uses.
Alternative: forking WorkspacePage (1,100 lines duplicated) rejected. Risk: recording UI must stay
mounted while its tab is closed; keep recording state in the existing global host, tab only views it.

**R4 – Sidebar content from registries, not hard-coded.** Entries (Calendar, Courses, Tasks, AI chat,
Settings) are a small ordered list in `sidebarModel.ts`; session tools come from
`useWorkspacePanels`, `useChatSection`, `useTeacherSection`, `useSidePanelSections`, so later
features appear in both shells. Graph is deliberately omitted (clarification Q5).

**R5 – Courses grid.** `useCourseTree()` already returns year → semester → course; the grid flattens
it with a semester filter (default: current/last used semester via `last_semester_id`) and search;
each card links to `/courses/:courseId`. In Ultimate `/courses` redirects to `/` so the URL is valid in
both. `/tasks` likewise: Simple renders the board components; Ultimate redirects to `/` (its panel).

**R6 (resolved in implementation) – AI chat entry.** Ultimate has no session-less chat (chats belong to a session), so Simple's general sidebar has no "AI chat" entry; the AI chat is the Chat tool in the session sidebar. The text below is the original plan.

**R6 – AI chat entry (original).** A general (non-session) chat entry opens the existing chat UI; if no
session-less chat exists today, plan treats it as opening the chat for General Notes context or the
most recent session, to be confirmed in tasks (open item: confirm what Ultimate's home offers).

**R7 – Responsive and a11y.** Sidebar is a `nav` landmark; below the wide breakpoint (`useMediaQuery`,
same `WIDE_QUERY` as Ultimate) it becomes a `Sheet` drawer opened from a menu button in the main top
bar; wide: collapsible to an icon rail, state in localStorage. Focus returns to the toggle on close.

**R8 – Tour/Yuii and shortcuts.** The tour host is a global host and works in both; its anchors
target Ultimate elements, so in Simple the auto-start is suppressed (tour stays an Ultimate feature)
unless tasks find a cheap anchor mapping. Existing keymap commands that toggle Ultimate panels are
no-ops in Simple.

**R9 – Demo mode.** The demo build already mounts the real app over MSW; Simple works unchanged.
`uiMode` flows through the existing preferences handler; verify with `e2e:demo`.

**R3 (implementation note).** The session tools (Recordings, Chat, Teacher, Time) are the items of the page's existing session-panel rail; Simple lists them in the session sidebar and opens the session panel over the main area (never docked). Chat/Teacher chats can still be expanded into main-area tabs through the existing feature. New Recordings/Time tab kinds were not added: tab kinds are persisted by the backend workspace-tabs API, so that is a larger, separate change.
