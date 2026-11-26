# Data Model: Simple UI Mode

No new tables or migrations.

**Preferences (extended)** – existing per-user JSON object (`ui_preferences.data`):

| Field | Type | Rules |
|---|---|---|
| `uiMode` | `"ultimate" \| "simple" \| null` | Optional. Absent/null ⇒ Ultimate. Any other value ⇒ 422. Per user; PATCH merges like other fields. |

**Sidebar state (client only, `localStorage`, per browser)**: `uh.simple.sidebarCollapsed: boolean`.
Not synced; losing it falls back to expanded.

**Derived sidebar model (not stored)**:
- General entries, in order: Calendar, AI chat, Courses, Tasks; footer: Settings, account (incl.
  interface switch).
- Session entries (when a session or event route is open): Calendar, Notes, PDFs/Documents,
  Recordings, Chat, Teacher, Time, back to general.
