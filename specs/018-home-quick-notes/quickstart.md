# Quickstart: validate Home General Notes (018)

## Prerequisites

- Backend dependencies installed (`backend/`), frontend dependencies installed (`frontend/`).
- The constitution has been amended for `General Notes` (research R8).

## Automated checks

```sh
cd backend && pytest tests/contract/test_general_notes.py tests/integration/test_general_notes_flow.py
cd backend && pytest            # full suite: existing note, search, timeline and backup tests must stay green
cd frontend && npm run gen:api && npm run typecheck && npm run lint && npm test
```

Expected coverage in the new tests ([contract](contracts/general-notes-api.md)):

- create, then list: the file exists at `<user>/General Notes/<name>.md`
- duplicate name, both on create and on rename → `409 name_taken`
- save with a stale version, or after an outside edit → `412` / `409`; the file is unchanged
- a file dropped in the folder appears in the list; a file removed outside the app disappears
- user A cannot see, open or save user B's general note (`404`)
- a year named "General Notes" gets a different folder name
- session notes, search and timeline are unaffected by notes with no session
- the database migration upgrades a copy of a current database

## Manual run (desktop or `start.sh`)

1. Open the home page. Under the Tasks panel there is a **General notes** section with a
   description and an empty state.
2. Click **New general note**. A pop-up box opens with a "General note" badge, and the cursor is
   in the editor.
3. Type text, including a math block. The save state goes from saving to saved.
4. Press Escape. The note is listed, and its name is the first line of the text.
5. Open the user's data folder: `General Notes/<name>.md` holds the text.
6. Click New, then close without typing. Nothing is added to the list or the folder.
7. Rename the note, then delete it (a confirmation is asked). The list and the folder both
   follow.
8. Collapse the section and reload: it stays collapsed. Repeat steps 1–7 in dark theme and
   using only the keyboard.
