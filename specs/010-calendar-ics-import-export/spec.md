# Feature Specification: Calendar Import and Export (.ics)

**Feature Branch**: `events`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Add 'Import and export' to Settings, for the calendar, working like Google Calendar's: users can bring classes and events in from an iCalendar (.ics) file, including files exported by Google Calendar, and export their calendar to an .ics file that Google Calendar, Apple Calendar and Outlook can import. Only the schedule is covered: notes, recordings, PDFs and annotations are never imported or exported." (Full description covers: location in Settings; export; import steps — choose file, preview, destination, confirm and result with undo; what is read; safety and repeated imports; keyboard and accessibility; out of scope.)

**Related**: Feature 001 (classes, repetition rules, edit scopes, years/semesters/courses, color
palette, links), 009 (events, the reserved events folder, the Trash, quick-create Undo), 005
(Settings, theme import/export as a precedent for file import/export), 002/003/006/007 (session
notes, recordings and documents, which this feature never touches). Constitution 1.2.0
Principle I (no lost work) and Principle II (readable storage folders, the database is never the
only copy of user work) constrain imports; Principle III (versioned API) means file reading and
writing goes through the API; Principle V (themes, keyboard, contrast) applies to every screen.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import a semester's timetable from Google Calendar (Priority: P1)

The student keeps their timetable in Google Calendar. They export it from Google as an .ics
file, open Settings → Import and export, choose "Import calendar (.ics)" and drop the file in.
The preview lists "Linear Algebra" (24 entries, Mon/Wed 10:00–11:30, FENS G032) and
"Physics II" (14 entries, Tue 13:40–15:30) as repeating groups, already selected as Class, and
"Dentist" as a one-time group, not selected, set to Event. They pick 2026 / "Fall 2026", see
that "Linear Algebra" will use their existing course and "Physics II" will be a new course with
a new color, and confirm. The result screen says 38 classes created, 0 updated, 2 skipped
(all-day). The classes appear on the calendar and on the course timelines.

**Why this priority**: Typing a whole semester's timetable by hand is the biggest barrier to
starting with the app; most students already have it in another calendar.

**Independent Test**: Import a Google Calendar export containing two weekly series, a one-time
event and an all-day event into an existing semester; confirm the preview defaults, the course
mapping, the created sessions and folders, and the result counts and skip reasons.

**Acceptance Scenarios**:

1. **Given** Settings, **When** the user opens it, **Then** an "Import and export" section shows
   "Import calendar (.ics)" and "Export calendar (.ics)".
2. **Given** the import screen, **When** the user chooses a file with the button or drops it on
   the drop area, **Then** the file is read and checked and nothing in the calendar changes yet.
3. **Given** a valid file, **When** the preview opens, **Then** entries are grouped by title,
   and each group shows how many entries it would create, its weekdays and times, its location
   and an "Import as" choice (Class or Event).
4. **Given** the preview, **When** it first opens, **Then** repeating groups are selected and set
   to Class, and one-time groups are not selected and set to Event; the user can select,
   deselect or change the type of any group.
5. **Given** the destination step, **When** the user picks an existing year and semester or types
   the name of a new one, **Then** the import can proceed; with no semester chosen, or a new one
   without a name, it cannot.
6. **Given** a group imported as Class whose title matches a course in the destination semester
   (ignoring case and surrounding spaces), **When** the preview shows its mapping, **Then** it
   maps to that course; otherwise it maps to a new course of that name; the user can change the
   mapping to another course of the semester or rename the new course.
7. **Given** new courses created by the import, **When** they are created, **Then** each gets a
   different color from the app's palette, one color per course; imported events get the
   default event color.
8. **Given** the user confirms, **When** the import finishes, **Then** a result screen shows how
   many classes and events were created, updated and skipped, and lists each skipped entry with
   its reason.
9. **Given** imported classes and events, **When** the user opens them, **Then** they behave
   exactly like entries created by hand: same workspace, same storage folders, same editing,
   deleting and Trash behavior.

---

### User Story 2 - Export the calendar to other calendar apps (Priority: P1)

The student wants their timetable on their phone. In Settings → Import and export they choose
"Export calendar (.ics)", limit it to 2026 / "Fall 2026" and save the file. They import it into
Apple Calendar and Google Calendar: every class and event shows on the same days at the same
times, weekly classes show as one repeating event, the moved lecture shows in its new slot and
the cancelled one is missing.

**Why this priority**: Students need their timetable where they already look (phone, Outlook);
it also gives them a portable backup of their schedule.

**Independent Test**: Export a semester containing a weekly class with one moved and one
cancelled session, a one-time event and a repeating event; import the file into Google Calendar,
Apple Calendar and Outlook and compare each entry's day, time, title, location and links.

**Acceptance Scenarios**:

1. **Given** the export action, **When** the user opens it, **Then** they can export everything
   or limit the export to one year and semester.
2. **Given** classes and events in scope, **When** the user exports, **Then** one .ics file is
   saved whose name contains the app name and the export date.
3. **Given** a weekly class, **When** exported, **Then** it appears in the file as one repeating
   event with its weekdays, interval and end date, titled with the course name, with its time
   zone, location and links.
4. **Given** a session or event that was changed or moved with "This one only", **When**
   exported, **Then** it appears as a modified occurrence of its series at its new time; a
   cancelled or deleted single occurrence appears as an excluded occurrence.
5. **Given** an exported file, **When** imported into Google Calendar, Apple Calendar or Outlook,
   **Then** it imports without errors and every entry appears on the same dates at the same
   wall-clock times as in the app, including weeks after a daylight-saving change.
6. **Given** nothing in the chosen scope, **When** the user exports, **Then** they are told there
   is nothing to export and no file is created.
7. **Given** a session with notes, recordings or documents, **When** exported, **Then** the file
   contains only its schedule data; no note text, recording, document or annotation is included.

---

### User Story 3 - Re-import safely, restore an app export, and undo (Priority: P2)

Mid-semester the student exports a newer version of the Google calendar and imports it again.
The preview shows which entries will be updated and which will be skipped because they already
hold notes. Nothing is duplicated. Later, on a new computer, they import a file exported from the
app itself: each entry returns as a class or event in its original year, semester and course with
its color. After a test import into the wrong semester they press "Undo import" and the entries
it created disappear.

**Why this priority**: Without duplicate protection and undo, importing is risky enough that
students would avoid it; round-tripping through the app's own export makes the export a real
backup.

**Independent Test**: Import a file, add a note to one imported session, import an edited
version of the same file, and confirm updates, skips and the absence of duplicates; export from
the app, import into an empty account and compare; run "Undo import" and confirm only content-free
created items are removed.

**Acceptance Scenarios**:

1. **Given** entries created by an earlier import, **When** the same file or a newer export of
   the same calendar is imported, **Then** entries matching by their identifier from the file are
   updated (title, time, location, links, repetition) and no duplicates are created.
2. **Given** a matching entry that has notes, recordings or documents, **When** the import would
   change or move it, **Then** it is left unchanged and reported as skipped with that reason.
3. **Given** an earlier imported entry that is missing from the newer file, **When** importing,
   **Then** it is left as it is.
4. **Given** a file exported by this app, **When** previewed, **Then** each group shows its saved
   type, year, semester, course and color, and importing restores them (see Assumptions for how
   the destination choice combines with saved semesters).
5. **Given** the result screen, **When** the user chooses "Undo import" and confirms, **Then** the
   classes, events and courses created by this import that have no notes, recordings or
   documents are removed; entries that were updated, and created entries that now have content,
   are kept and listed as not undone.
6. **Given** an import fails part-way (for example, storage is unavailable), **When** the failure
   occurs, **Then** nothing in the calendar or storage is changed and the user sees a clear error.

---

### User Story 4 - Decide what to do with entries the app cannot represent (Priority: P2)

The student's file contains a monthly club meeting, a daily gym session, an all-day holiday and a
cancelled lecture. The preview marks the monthly and daily series as "not supported" and lets
them import each one as a single entry (first occurrence only) or skip it. The all-day holiday is
listed as skipped ("all-day events are not supported yet") and the cancelled lecture is skipped.

**Why this priority**: Real calendars contain such entries; the user must see what will happen to
them instead of having data silently dropped or guessed.

**Independent Test**: Import a file containing daily, monthly, yearly and "every 2nd Tuesday of
the month" rules, an all-day event, a multi-day event and a cancelled event; confirm each is
reported in the preview and result with the documented choice or reason.

**Acceptance Scenarios**:

1. **Given** a series whose repetition the app cannot represent, **When** previewed, **Then** it
   is shown as "not supported" with the choice "Import first occurrence only" or "Skip", and
   nothing is imported for it until the user chooses.
2. **Given** an all-day or multi-day event, **When** previewed and imported, **Then** it is
   skipped with the reason "all-day events are not supported yet".
3. **Given** an event marked as cancelled in the file, **When** importing, **Then** it is skipped
   and reported.
4. **Given** a repeating entry with no end, **When** previewed, **Then** it shows an end date the
   user can change, defaulting to 16 weeks after its first entry.
5. **Given** an event with a time in UTC or in a named time zone, **When** imported, **Then** it
   appears at the correct local time in the user's time zone; a weekly series keeps the same local
   time before and after a daylight-saving change.

---

### User Story 5 - Import a large file with keyboard and screen reader (Priority: P3)

A keyboard and screen reader user imports a 3 MB file with 4,000 events. Progress is announced
while it is read; they cancel once, start again, move through the groups with the keyboard,
change types and mappings, confirm, and hear the result summary.

**Why this priority**: Required by the constitution for every screen; large files must not freeze
the app or trap the user.

**Independent Test**: With keyboard only and a screen reader, import a large file, cancel during
reading, restart, change one group's type and mapping, confirm, and undo.

**Acceptance Scenarios**:

1. **Given** any step of import or export, **When** used with keyboard only, **Then** every
   control is reachable and operable with a visible focus indicator and no keyboard trap, in
   light, dark and custom themes.
2. **Given** a large file, **When** it is being read or checked, **Then** progress is shown and
   announced, and the user can cancel; cancelling changes nothing.
3. **Given** the final confirmation, **When** the user has confirmed, **Then** the import runs to
   completion or fails as a whole; it is not cancellable part-way.
4. **Given** the import completes or fails, **When** the result appears, **Then** the summary is
   announced to assistive technology and focus moves to the result.

### Edge Cases

- File is empty, not iCalendar, larger than 5 MB, or has more than 5,000 events: rejected before
  the preview with a message naming the problem; nothing changes.
- File is valid iCalendar but contains no events, or only entries that would all be skipped: the
  preview says so and the import cannot be confirmed with nothing selected.
- Two groups with the same title but different weekdays or times: grouped together under one
  title; the group shows each distinct weekday/time combination.
- A title is empty after removing spaces: the group is shown as "(No title)"; it can be imported
  as an Event only after the user types a title, or as a Class only after choosing or naming a
  course.
- A title or location contains markup or script-like text: shown and stored as plain text,
  never interpreted.
- Links using schemes other than http/https (mailto:, file:, javascript:, tel:): dropped.
- A Google event with an automatic "join this meeting" block in its description: the block is
  ignored; the Meet link itself is kept as a link.
- A course name from the file equals the reserved events folder name: the name is refused as for
  manual course creation, and the user must rename the course in the preview before confirming.
- A course name or event title that would collide with an existing folder name: folders are made
  unique in a readable way, as for entries created by hand; no file is overwritten.
- A matching entry from an earlier import is now in the Trash: it is not restored or recreated;
  it is reported as skipped ("in the Trash").
- A modified occurrence in the file points to a date the series does not produce: imported as a
  one-time entry of the same group and noted in the result.
- An excluded date in the file has no matching occurrence: ignored.
- Repetition with a count instead of an end date: converted to the matching end, as the app's
  "after N occurrences" option allows.
- Repeating entry ending before it starts, or event ending before or at its start: skipped with
  the reason "invalid times".
- The destination semester has no start/end dates: imported series keep their own end dates;
  the semester's dates are not changed.
- Export of a series whose sessions were individually edited in many ways: each edited session is
  a modified occurrence; series-wide properties stay on the series.
- Export of entries in the Trash: not exported.
- Export while the user's time zone has a daylight-saving change inside the semester: times stay
  at the same wall-clock time on both sides of the change.
- The user leaves Settings during the preview: nothing is imported; reopening starts over.
- Undo after the user has since edited an imported entry: the entry is still removed if it has
  no notes, recordings or documents; Undo's confirmation says how many entries will be removed.
- Undo fails (server unavailable): nothing is removed and the user is told Undo did not happen and
  can retry.

## Requirements *(mandatory)*

### Functional Requirements

**Location**

- **FR-001**: Settings MUST include an "Import and export" section with two actions: "Import
  calendar (.ics)" and "Export calendar (.ics)".
- **FR-002**: Import and export MUST cover only schedule data (classes, events, their courses,
  semesters and years); notes, recordings, documents and annotations MUST never be read from or
  written to a file by this feature.

**Export**

- **FR-003**: Export MUST produce one file in standard iCalendar format containing the user's
  classes and events, either all of them or, if the user chooses, only those of one year and
  semester. Entries in the Trash MUST NOT be exported.
- **FR-004**: Each class or event MUST be written as one calendar event with: title (a class uses
  its course name), start, end, time zone, location and links.
- **FR-005**: A repeating class or event MUST be written as a single repeating event with its
  repetition rule (weekdays, interval) and end date, not as separate events.
- **FR-006**: An occurrence changed or moved with "This one only" MUST be written as a modified
  occurrence of its series; a cancelled or deleted single occurrence MUST be written as an
  excluded occurrence.
- **FR-007**: Each exported entry MUST carry, in application-specific fields that other calendar
  apps ignore: its year, semester, course (for classes), color, and whether it is a class or an
  event, plus a stable identifier that stays the same across exports.
- **FR-008**: Times MUST be written so that each entry keeps its wall-clock time in the user's
  time zone, including across daylight-saving changes.
- **FR-009**: The file name MUST include the app name and the export date.
- **FR-010**: If the chosen scope contains no classes or events, the user MUST be told and no
  file MUST be created.
- **FR-011**: An exported file MUST import without errors into Google Calendar, Apple Calendar and
  Outlook, showing the same entries at the same dates and times as in the app.

**Import — choosing and checking the file**

- **FR-012**: The user MUST be able to choose a .ics file with a button or by dragging and
  dropping it.
- **FR-013**: The file MUST be read and checked completely before anything is changed. Files
  that are not valid iCalendar, are empty, are larger than 5 MB or contain more than 5,000 events
  MUST be rejected with a message that names the reason.
- **FR-014**: While a file is read and checked, progress MUST be shown and announced, and the user
  MUST be able to cancel; cancelling MUST change nothing.

**Import — preview**

- **FR-015**: The preview MUST group the file's events by title (after removing surrounding
  spaces) and show for each group: how many entries it would create, its weekdays and times, and
  its location.
- **FR-016**: Each group MUST have an "Import as" choice of Class or Event and a selection control.
  Repeating groups MUST default to Class and selected; one-time groups MUST default to Event and
  not selected. The user MUST be able to change any group's selection and type.
- **FR-017**: For a file exported by this app, each group MUST default to the saved type, year,
  semester, course and color carried in the file; the user MAY still change them.
- **FR-018**: The preview MUST show which entries will be created, which will update an earlier
  import, and which will be skipped and why, before the user confirms.
- **FR-019**: Repetition rules the app cannot represent MUST be shown as "not supported" with
  the choice "Import first occurrence only" or "Skip"; no such group MUST be imported until the
  user has chosen.
- **FR-020**: Repeating entries without an end MUST show an editable end date, defaulting to 16
  weeks after the first entry.

**Import — destination and mapping**

- **FR-021**: The user MUST choose a destination year and semester: an existing one, or a new
  one whose name they type (a name is required). Confirming MUST NOT be possible without a valid
  destination.
- **FR-022**: Groups imported as Event MUST be created in the destination semester.
- **FR-023**: Each group imported as Class MUST map to a course of the destination semester: an
  existing course whose name matches ignoring case and surrounding spaces, otherwise a new course
  with the group's title. The user MUST be able to change the mapping to another existing course
  or rename the new course; course names MUST follow the same rules as manual creation,
  including the reserved events folder name rule.
- **FR-024**: Each new course MUST get its own color from the app's palette, avoiding colors
  already used by courses of the destination semester while unused palette colors remain;
  imported events MUST get the default event color. A color carried from an earlier app export
  MUST take precedence over both.

**Import — what is read**

- **FR-025**: The import MUST read: title, start, end, location, repetition rule, modified single
  occurrences, cancelled (excluded) single occurrences, and links (the event's URL, Google Meet
  link and attachment links).
- **FR-026**: Web links (http and https only) found in the description MUST be kept as links;
  the rest of the description, reminders, attendees, status and availability MUST be ignored.
  Google's automatic "join this meeting" description block MUST be ignored.
- **FR-027**: Titles and locations MUST have surrounding spaces removed; all text MUST be treated
  as plain text and never interpreted as markup; only http and https links MUST be kept.
- **FR-028**: Events marked as cancelled in the file MUST be skipped and reported.
- **FR-029**: All-day and multi-day events MUST be skipped with the reason "all-day events are
  not supported yet".
- **FR-030**: Times given in UTC or in a named time zone MUST be converted to the user's time zone;
  repeating entries MUST keep the same local time across daylight-saving changes.
- **FR-031**: The app MUST NOT guess silently: every entry in the file MUST end up created,
  updated, or listed as skipped with a reason.

**Import — applying, results and undo**

- **FR-032**: On confirmation, the import MUST be applied as one unit: if any part fails, nothing
  in the calendar or storage is changed and the user sees a clear error.
- **FR-033**: The result screen MUST report the number of classes and events created, updated and
  skipped, and list each skipped entry with its reason.
- **FR-034**: The result screen MUST offer "Undo import", which, after confirmation stating how
  many items will be removed, removes only the classes, events and courses created by this import
  that have no notes, recordings or documents, plus a year or semester created by this import if
  nothing remains in it. Updated entries MUST NOT be reverted. Items kept MUST be listed with the
  reason.
- **FR-035**: Imported classes and events MUST get the same storage folders and behave exactly
  like those created by hand (workspace, editing, edit scopes, deleting, Trash).

**Import — safety and repeated imports**

- **FR-036**: Importing MUST never delete anything.
- **FR-037**: Importing MUST NOT change or move any class session or event that has notes,
  recordings or documents; such entries MUST be reported as skipped.
- **FR-038**: Each imported entry MUST remember the identifier it had in the file. Importing the
  same file again, or a newer export of the same calendar, MUST update matching entries and MUST
  NOT create duplicates. Entries missing from the newer file MUST be left as they are. Matching
  entries that are in the Trash MUST be skipped, not recreated.

**Keyboard and accessibility**

- **FR-039**: Every step of import and export MUST work with keyboard and pointer in light, dark
  and custom themes, with visible focus and no keyboard traps; the drop area MUST have an
  equivalent button.
- **FR-040**: Progress, errors and results MUST be announced to assistive technology; focus MUST
  move to the result when the import completes or fails.

### Key Entities

- **Calendar file (.ics)**: An iCalendar file containing calendar events; input to import, output
  of export. Never contains notes, recordings, documents or annotations.
- **Import group**: The file's events that share a title, with their count, weekdays, times,
  location, selection, "Import as" type, destination course mapping (for Class), end date for
  unbounded series, and any "not supported" decision.
- **Import source identifier**: The identifier an entry had in the file, remembered on each
  imported class or event (and on its modified occurrences) to match entries on later imports.
- **Import run**: One confirmed import — its file name, time, destination, and the lists of
  created, updated and skipped items with reasons. Used for the result screen and "Undo import".
- **App-specific export fields**: Year, semester, course, color, entry type and stable
  identifier written into exported entries so that this app can restore them on import.
- **Class / Event / Course / Semester / Year** (existing): Created or updated by import exactly as
  by hand; read by export.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A student can import a typical semester timetable (up to 10 courses) from a Google
  Calendar export into a semester in under 2 minutes, including reviewing the preview.
- **SC-002**: For a set of reference files (Google Calendar, Apple Calendar and Outlook exports
  covering weekly series, modified and cancelled occurrences, UTC and named time zones, and
  daylight-saving changes), 100% of supported entries appear at the same dates and wall-clock
  times as in the source calendar.
- **SC-003**: 100% of files exported by the app import without errors into Google Calendar, Apple
  Calendar and Outlook, with every entry at the same date and time as in the app.
- **SC-004**: Exporting and re-importing into an empty account restores 100% of classes and events
  with their type, year, semester, course, color, times, location, links and repetition.
- **SC-005**: Importing the same file twice creates 0 duplicate entries.
- **SC-006**: 0 notes, recordings or documents are lost, changed or detached by any import, failed
  import or "Undo import".
- **SC-007**: Every entry in an imported file is accounted for on the result screen as created,
  updated or skipped with a reason (0 silently dropped entries).
- **SC-008**: A file at the limits (5 MB, 5,000 events) reaches the preview in under 10 seconds
  with progress shown, and the app stays responsive while it is read.
- **SC-009**: Every import and export step can be completed using only the keyboard, in light,
  dark and a custom theme.

## Assumptions

- The user's time zone is the app's single time zone (Feature 001: all times are in the user's
  local time zone); imports are converted into it and exports are written in it.
- The app can represent: one-time entries, and weekly repetition on one or more weekdays, every N
  weeks, ending on a date or after N occurrences. Daily, monthly, yearly and other rules are "not
  supported" in the sense of FR-019. Weekly rules with additional limits the app cannot represent
  (e.g., specific set positions) are also "not supported".
- Destination with app-exported files: entries carrying a saved year and semester go back to that
  year and semester (created with the same names if missing), and their saved course is matched
  by name in that semester or recreated. The destination choice applies to entries without saved
  semester data. The user can override a group's semester in the preview, which makes it follow
  the destination choice.
- Grouping by title is for presentation; a group may contain several series and one-time entries,
  and each is created with its own repetition.
- Links from the file have no label unless the file provides one (e.g., an attachment's name);
  the Meet link is labelled "Google Meet".
- Re-import updates overwrite the schedule fields of content-free matched entries even if the user
  edited them in the app since the earlier import; the preview lists these as "will update" so the
  user can deselect the group.
- "Undo import" is available on the result screen of the import just run; it removes items
  directly (not via the Trash) because it only removes items with no notes, recordings or
  documents. It does not appear again after the user leaves the result screen.
- Reading and checking the file happen on the server through the versioned API, as required by
  Constitution Principle III; the file itself is not kept after the import.
- The 5 MB and 5,000-event limits count every event component in the file, including modified
  occurrences.
- Out of scope: live synchronization with Google Calendar, signing in to or reading from Google
  accounts, subscribing to calendar links (webcal), importing attendees or reminders, formats
  other than .ics, exporting notes, recordings or documents, sharing calendars with other users,
  and all-day events.
