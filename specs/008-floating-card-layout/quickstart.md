# Quickstart: Validating the Floating Card Layout

**Feature**: 008-floating-card-layout. Contract: [contracts/ui-layout.md](./contracts/ui-layout.md),
state: [data-model.md](./data-model.md).

## Prerequisites

- Backend and frontend run as for earlier features (see `README.md`). There are no new dependencies,
  migrations or settings.
- Have a user with at least one course and one past, one current or one upcoming session, a note,
  and a recording.
- A custom theme saved before this feature, and an older exported theme file (from Feature 005).

## Automated checks

```bash
cd frontend
npm run lint && npm run typecheck
npx vitest run                      # unit: layout widths, focus mode, chip, pills, reopen indicator, theme pairs
npx playwright test layout.spec.ts  # new layout e2e (light + dark projects)
npx playwright test                 # full suite incl. updated side-panel, responsive, a11y-themes, settings, notes
cd ../backend && pytest             # unchanged; must stay green (critical flows)
```

## Manual walkthrough (1366 × 768, then light, dark and the custom theme)

1. **Cards (US1)**:
   - Open a session. You see three cards with about 8 px gaps and 14 px corners, and no bar across
     the window.
   - The window never scrolls, but each card scrolls on its own.
   - Expected: the left card shows app name/close, search, Courses + "+", Sessions and notes, and
     Account/Settings at the bottom.
2. **Tab row (US1)**:
   - The only fixed bar is about 40 px tall.
   - The chip shows the date and time. On an upcoming session it shows "Upcoming".
   - Clicking the chip shows course, location, links and status.
   - Typing a note shows "Saving…" → "Saved" in the floating chip at the bottom right, and the text
     doesn't move.
3. **Close and reopen (US2)**:
   - Close the left card. It becomes a 44 px rail with reopen, mark, Account and Settings.
   - Close the audio card. "Show audio panel" appears in the tab row.
   - Reload: both states are kept.
   - Use `[` and Alt+] to do the same.
4. **Activity (US2, US5)**:
   - Start a recording, close the audio card, and go to the calendar.
   - The recording pill (time, "Go to session", Stop) floats at the bottom center of the main card.
     "Show audio panel" in the session shows a pulsing dot.
   - Start a transcription. A second pill (with Cancel) stacks below, and Cancel works.
5. **Focus mode (US4)**:
   - Press `\` (not in the editor's text). Both side cards and the rail hide. Press `\` again: the
     previous arrangement returns.
   - Repeat with the button, and with all four open/closed combinations.
   - Pills stay visible throughout.
   - Typing `\` inside a note inserts a backslash and doesn't toggle.
6. **Calendar and course (US3)**:
   - The calendar toolbar (Today, arrows, range, New class, view switcher, focus) is inside the
     main card.
   - The course page is inside the main card, with no audio card.
7. **Narrow window (US7)**:
   - Resize to 1000 × 700 and reload. There is no rail and no audio card, and "Show side panel"
     sits at the left of the top bar.
   - Opening a card floats it over the main card without changing the main card's width. Escape
     closes it and focus returns to the button.
   - Settings is reachable after opening the left card.
   - Resize back to 1366: the remembered wide states return.
8. **Minimum width**:
   - At 1100 px, widen the left and audio cards to their maximum by pointer and by keyboard. The
     main card never gets narrower than 480 px.
9. **Themes (US6)**:
   - In each theme the window color is "Background", cards are "Surface / card", and borders are
     "Border".
   - Apply the old custom theme and import the old exported file: both work unchanged.
   - In the editor, set Border close to Background. The "Border on Background — card edges"
     warning appears, and saving still works after confirming.
   - Theme switches are instant.
10. **Accessibility**:
    - Tab through everything. Focus is always visible, including near card corners.
    - Every icon button announces a name.
    - Turn on reduced motion in the OS: cards open and close instantly.
    - The axe scan (a11y-themes spec) reports no violations, and the landmarks "Side panel",
      "Workspace" and "Audio" are present.
11. **Mockup comparison (SC-010)**: compare with `design/layout-mockups/*.png` at 1366 × 768.
    Deviations are allowed only where the spec says so: no rail below 1100 px, pills, and the
    Border color.
