# Feature Specification: Diagrams and Math in Notes

**Feature Branch**: `013-note-diagrams-math`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Show diagrams and mathematical formulas in notes. In the note editor, a fenced code block whose language is "mermaid" (a diagram written in Mermaid syntax) is shown as a rendered diagram, and LaTeX formulas written between dollar signs are shown as rendered math. Notes stay plain Markdown: this changes how notes look and edit, not how they are stored." (Full description covers: Priority 1 — diagrams, math, saving without damage, errors, stable layout and speed, themes, safety, offline, everywhere else in the editor, accessibility; Priority 2 — expand, export, insert, math blocks; out of scope.)

**Related**: Feature 002 (note editor: live and raw mode, autosave and save states, find in note,
conflict handling, unsaved-changes warnings, read-only mode, import and export of notes),
Feature 004 (transcripts appended to a note), Feature 005 (light, dark and custom themes),
Feature 012 (quick notes on tasks — explicitly not covered here).

## Clarifications

### Session 2026-10-19

- Q: When "find in note" matches text inside a drawn diagram or formula, what should the editor do? → A: The match is counted; when the user steps to it, that diagram or formula opens as source with the match highlighted, and returns to its drawn view when find moves to another match or closes.
- Q: If a diagram's source sets its own settings (Mermaid `%%{init}%%` directives or a settings header), should the app follow them? → A: Follow every setting the source gives. If any setting is unsafe (it would turn off Mermaid's safety mode, allow HTML labels, enable click actions, callbacks or links, or load external resources), first show a warning dialog and let the user choose to allow it or draw the diagram safely. If the source sets its own theme or colours, ask in a dialog whether to use the diagram's theme or keep the app theme; change it only if the user agrees.
- Q: When the cursor is inside an inline formula, how should its source and the drawn result appear? → A: The source replaces the drawing inline, with a small floating preview of the result just under it while editing.
- Q: When a diagram is exported as an image, which look should it have? → A: The current app theme (with its background) by default, plus a "Light, white background" choice in the export menu.
- Q: If one formula defines a command (e.g. `\newcommand`), can other formulas in the same note use it? → A: Yes; a command defined in a formula is available to all later formulas in the same note (document order), as in Obsidian.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See diagrams in a note (Priority: P1)

A student writes a diagram in a note as a fenced block marked `mermaid` (for example a flowchart
of an algorithm from a lecture). In the note editor the block is shown as the drawn diagram,
centered and scaled to fit the note width. To change it, the student clicks the diagram, moves
the cursor into it with the keyboard, or presses Enter on it: the source text appears for
editing, with a live preview of the diagram under it that refreshes shortly after typing stops.
Leaving the block or pressing Escape shows the diagram again.

**Why this priority**: Diagrams are the headline of the feature; lecture notes in technical
courses rely on flowcharts, sequence and state diagrams.

**Independent Test**: Open a note containing a mermaid flowchart, a sequence diagram and a Gantt
chart; each shows as a drawn diagram; edit one and see the preview update; leave it and see the
updated diagram; the saved file contains the edited source and nothing else changed.

**Acceptance Scenarios**:

1. **Given** a note with a fenced block whose language is `mermaid` and valid source, **When** the note opens in the editor, **Then** the block is shown as the drawn diagram, centered, no wider than the note area, and the page does not scroll horizontally.
2. **Given** a drawn diagram, **When** the user clicks it, moves the cursor into it with the arrow keys, or focuses it and presses Enter, **Then** the block's source is shown for editing with the drawn preview under it.
3. **Given** the source is being edited, **When** the user stops typing, **Then** the preview updates within about half a second.
4. **Given** the source is being edited, **When** the cursor leaves the block or the user presses Escape, **Then** the drawn diagram is shown again and reflects the latest source.
5. **Given** sources for flowchart, sequence, class, state, ER, Gantt, mind map and timeline diagrams, **When** the note is shown, **Then** each is drawn.
6. **Given** a note with no diagrams and no formulas, **When** it opens, **Then** nothing related to diagrams or math is loaded or downloaded and opening is as fast as before.

---

### User Story 2 - See formulas in a note (Priority: P1)

A student writes math in a note: inline formulas such as `$E = mc^2$` within a sentence, and
display formulas between `$$ ... $$`, on their own lines or on one line. Inline formulas flow
with the text; display formulas are centered on their own line. Clicking a formula or moving the
cursor into it shows its LaTeX source for editing (inline: in the line, with a floating preview
under it; display: with the drawn result under it);
leaving it shows the result. Ordinary dollar signs such as prices stay plain text.

**Why this priority**: Math is the other half of the feature and is needed daily in STEM
courses.

**Independent Test**: Open a note with inline formulas, a multi-line display formula, a one-line
display formula, and the sentence "it costs $5 and $10"; formulas are drawn, the sentence stays
plain text; arrow keys move across an inline formula without getting stuck.

**Acceptance Scenarios**:

1. **Given** text `the energy $E = mc^2$ is`, **When** shown, **Then** the formula is drawn inline within the sentence.
2. **Given** `$$` on its own line, formula lines, and `$$` on its own line, or `$$x^2$$` on one line, **When** shown, **Then** the formula is drawn centered on its own line.
3. **Given** a drawn formula, **When** the user clicks it or moves the cursor into it with the keyboard, **Then** its LaTeX source is shown for editing — for an inline formula the source replaces the drawing in the line with a small floating preview just under it; for display math the drawn result is under the source; **When** the cursor leaves, **Then** the drawn result is shown.
4. **Given** the cursor just before an inline formula, **When** the user presses Right repeatedly, **Then** the cursor enters the formula source, moves through it one character at a time, and exits after the closing dollar; Left behaves the same in reverse; Up and Down move to adjacent lines; the cursor never stays stuck.
5. **Given** the text "it costs $5 and $10", a lone `$`, `$ x$`, `$x $`, or `$x$5`, **When** shown, **Then** they stay plain text.
6. **Given** dollar signs inside an inline code span or a code block, **When** shown, **Then** they stay plain code text.
7. **Given** an escaped dollar `\$`, **When** shown, **Then** it is a literal dollar sign and does not open or close a formula.
8. **Given** a formula defining `\newcommand{\R}{\mathbb{R}}` followed later in the note by `$x \in \R$`, **When** shown, **Then** the later formula draws using the command; a formula above the definition that uses `\R` shows an error; **When** the definition is edited, **Then** the later formula is redrawn accordingly.

---

### User Story 3 - Notes are saved without damage (Priority: P1)

The student trusts that formulas and diagram sources are stored exactly as written. Opening a
note and saving it without editing changes nothing. Backslashes, underscores, asterisks,
brackets and line breaks inside formulas and diagrams are kept, so the note opens the same in
other Markdown tools.

**Why this priority**: Constitution Principle I (user work is never lost) and Principle II
(plain Markdown files). A renderer that silently rewrites `\frac` or `a_1` would corrupt notes.

**Independent Test**: Take a set of real notes with formulas and diagrams written in GitHub,
Obsidian and VS Code; open each, wait for autosave, and compare the files byte for byte before
and after; then edit only ordinary text and check that only that text changed.

**Acceptance Scenarios**:

1. **Given** a note with formulas and diagrams, **When** it is opened and left (or autosave runs) without edits, **Then** the file on disk is byte-for-byte unchanged.
2. **Given** a formula containing `\`, `_`, `*`, `[`, `]`, `{`, `}` and line breaks, **When** the note is saved after editing other text, **Then** the formula is saved exactly as written.
3. **Given** a diagram source containing the same characters and blank lines, **When** saved, **Then** it is saved exactly as written.
4. **Given** a note with formulas and diagrams, **When** the user switches to raw mode, uses find in note, exports, or imports the note, **Then** each works on the exact source text.
5. **Given** a drawn formula or diagram is selected (alone or as part of a larger selection), **When** the user copies, **Then** the clipboard holds its Markdown source.
6. **Given** find in note is open and a match lies inside a drawn formula or diagram, **When** the user steps to that match, **Then** the item opens as source with the match highlighted; **When** the user steps to the next match elsewhere or closes find, **Then** the item returns to its drawn view.
7. **Given** a note written in GitHub, Obsidian or VS Code with `$...$`, `$$...$$` and mermaid blocks, **When** opened, **Then** it is shown correctly.

---

### User Story 4 - Errors, limits and safety (Priority: P1)

When a diagram or formula has a mistake, the student sees its source and a clear message saying
what is wrong; the rest of the note works normally and nothing is lost. Diagram and formula text
is treated as untrusted, so a note copied from the internet cannot run code or reach the
network unless the student is warned first and explicitly allows it for that diagram.

**Why this priority**: Students will make syntax errors constantly while typing; a broken
diagram must never break the editor. Imported notes make safety mandatory.

**Independent Test**: Open a note with an invalid diagram, an invalid formula, an empty diagram,
an empty formula, a 60,000-character diagram source, and a diagram containing click handlers,
links and script-like content; verify messages, placeholders, plain-code fallbacks, and that no
script runs and no network request is made.

**Acceptance Scenarios**:

1. **Given** a diagram or formula with a syntax error, **When** shown, **Then** its source stays visible with a message describing the problem, and the rest of the note keeps working.
2. **Given** an empty mermaid block or empty `$$ $$`, **When** shown, **Then** a placeholder is shown that invites editing.
3. **Given** a diagram that takes longer than 5 seconds to draw, **When** the limit is reached, **Then** it is shown as plain code with a message that it took too long; typing is not blocked meanwhile.
4. **Given** a diagram or formula source longer than 50,000 characters, **When** shown, **Then** it is shown as plain code with a message that it is too large to draw.
5. **Given** a diagram whose source contains unsafe settings or content (turning off Mermaid's safety mode, HTML labels, click actions, callbacks, links, or external resources), **When** it is about to be drawn, **Then** a warning dialog lists what is unsafe and offers "Allow" or "Draw safely"; until the user chooses, and if they choose "Draw safely", the diagram is drawn with those settings ignored and nothing runs, loads or opens.
6. **Given** the user chose "Allow" for a diagram, **When** it is drawn, **Then** Mermaid's own settings from the source apply for that diagram only; other diagrams and the editor are unaffected.
7. **Given** a formula with commands that would load URLs or include HTML, **When** shown, **Then** no script runs, no network request is made, no external file is loaded and no link opens.
8. **Given** the device is offline, **When** a note with diagrams and formulas is shown, **Then** everything draws, with all fonts and styles available.

---

### User Story 5 - Smooth, stable and themed (Priority: P1)

Long notes with many diagrams and formulas remain smooth to type in and scroll. The page does
not jump while diagrams are drawn. Diagrams and formulas follow the active theme and switch with
it.

**Why this priority**: A long semester note can hold dozens of diagrams and hundreds of
formulas; jank or unreadable colors would make the feature unusable.

**Independent Test**: Open a note with 20 diagrams and 200 formulas; type and scroll and check
responsiveness; switch between light, dark and a custom theme and check colors update within one
second and meet AA contrast.

**Acceptance Scenarios**:

1. **Given** a diagram not yet drawn, **When** the note is shown, **Then** a placeholder with a reserved height is shown so surrounding content does not move noticeably when the drawing appears.
2. **Given** a note with 20 diagrams and 200 formulas, **When** the user types and scrolls, **Then** typing and scrolling stay smooth; only items near the visible area are drawn; unchanged items are not redrawn.
3. **Given** a drawn note, **When** the user switches between light, dark and custom themes, **Then** diagrams (except those the user chose to keep in their own theme) and formulas update to the new theme within one second without reloading the note, and text and lines meet WCAG AA contrast against the background.
3a. **Given** a diagram whose source sets its own theme or colours, **When** it is about to be drawn, **Then** a dialog asks whether to use the diagram's own theme or keep the app theme; until the user answers, and if they decline, it is drawn in the app theme; if they accept, it is drawn with its own theme and colours.
4. **Given** the note is open in read-only mode, **When** shown, **Then** diagrams and formulas are drawn but cannot be edited.
5. **Given** a transcript is appended to a note with diagrams and formulas, or a save conflict occurs, **When** handled, **Then** it behaves exactly as before and formulas and diagrams are untouched.

---

### User Story 6 - Accessible diagrams and formulas (Priority: P1)

A student using a keyboard or a screen reader can reach each diagram, hear its name, open it for
editing with Enter and return with Escape. Formulas are read as math, and their source is
reachable.

**Why this priority**: Constitution Principle V requires full keyboard and AA accessibility on
every screen.

**Independent Test**: With keyboard only and a screen reader, tab through a note with diagrams
and formulas; check names, math reading, Enter/Escape, focus visibility and reduced-motion
behaviour.

**Acceptance Scenarios**:

1. **Given** a drawn diagram, **When** it receives focus, **Then** it shows a visible focus indicator and is announced with its title if it has one, otherwise "Diagram".
2. **Given** a focused diagram or formula, **When** the user presses Enter, **Then** its source opens for editing; **When** the user presses Escape, **Then** it returns to the drawn view and focus stays on it.
3. **Given** a drawn formula, **When** a screen reader reads it, **Then** it is exposed as readable math (not only as an image) and its LaTeX source is available to assistive technology.
4. **Given** the user prefers reduced motion, **When** diagrams appear or switch views, **Then** no animations play.
5. **Given** the existing editor shortcuts, **When** this feature is active, **Then** no existing shortcut changes behaviour.

---

### User Story 7 - Expand and export a diagram (Priority: P2)

A student opens a large diagram in a viewer with zoom and panning to study it, and saves a
diagram as an image (SVG or PNG) to use in slides or a report.

**Why this priority**: Valuable for large diagrams and sharing, but the editor is useful without
it.

**Independent Test**: Expand a large flowchart, zoom and pan with pointer and keyboard, close
with Escape and check focus returns; export as SVG and PNG and open both files.

**Acceptance Scenarios**:

1. **Given** a drawn diagram, **When** the user chooses "Expand", **Then** it opens large in a viewer with zoom in, zoom out, reset and panning by pointer and keyboard.
2. **Given** the viewer is open, **When** the user presses Escape or closes it, **Then** it closes and focus returns to the diagram.
3. **Given** a drawn diagram, **When** the user chooses export as SVG or PNG, **Then** an image file of the diagram, in its current look with the theme's background, is saved to the user's device, and the note is unchanged.
3a. **Given** the app is in a dark theme, **When** the user chooses export with "Light, white background", **Then** the saved image shows the diagram in the light theme on solid white.
4. **Given** a diagram that failed to draw, **When** the user looks for Expand or export, **Then** those actions are unavailable.

---

### User Story 8 - Insert diagrams and formulas, and math blocks (Priority: P2)

A student uses "Insert diagram" or "Insert formula" from the toolbar or command list to add an
editable example with the cursor inside it. Fenced blocks marked `math` are shown as display
math, as on GitHub.

**Why this priority**: Convenience; users can type the syntax by hand.

**Independent Test**: Use each insert command in an empty note and in the middle of a paragraph;
check the example is inserted and the cursor is inside it; open a note with a ```` ```math ````
block and check it is drawn as display math and saved unchanged.

**Acceptance Scenarios**:

1. **Given** the cursor in a note, **When** the user chooses "Insert diagram", **Then** a mermaid block with a small example flowchart is inserted on its own lines and opened for editing with the cursor inside its source.
2. **Given** the cursor in a note, **When** the user chooses "Insert formula", **Then** an example formula is inserted at the cursor and opened for editing with the cursor inside its source.
3. **Given** a fenced block whose language is `math`, **When** shown, **Then** its content is drawn as display math, follows the same editing, error, safety and saving rules as `$$` math, and is saved unchanged.
4. **Given** the note is read-only, **When** the user looks for the insert commands, **Then** they are unavailable.

---

### Edge Cases

- Dollar signs: `$5 and $10`, `$$` with nothing between, `$` at the end of a line, `\$`, unclosed `$x`, and a formula spanning a soft line break inside one paragraph: only pairs meeting the recognition rule become math; an inline formula does not cross a paragraph boundary; anything else stays plain text.
- Dollars inside code spans, code blocks, link URLs and the mermaid block itself are never math.
- An unclosed `$$` display block: shown as plain text, not as a formula swallowing the rest of the note.
- A mermaid fence with different casing or extra info (`Mermaid`, `mermaid title`), or with `~~~` instead of backticks: treated as a diagram when the first word of the info string is `mermaid` (case-insensitive); otherwise it is an ordinary code block.
- A mermaid block nested in a list or quote: drawn in place, indented with its container.
- A very wide or very tall diagram: scaled down to the note width; if text would become unreadably small, it is shown at a readable minimum size inside its own horizontally scrollable frame (the page itself never scrolls sideways), with Expand available.
- The user edits a diagram's source into an invalid state while typing: the preview shows the error message and the last valid drawing is not presented as current; the source is never lost.
- A note is changed outside the app (conflict) while a diagram is open for editing: existing conflict handling applies; the feature does not resolve conflicts itself.
- Undo/redo across editing a formula or diagram restores the exact previous source.
- A selection that starts in ordinary text and ends inside a formula: copying yields the exact Markdown source of the selected range.
- A note with many diagrams that need a safety or theme decision: one dialog lists them and can answer for all at once, rather than one dialog per diagram.
- The user edits an allowed diagram's source: the decision is discarded and the dialog is shown again if the new source still has unsafe or theme settings (drawn safely and in the app theme meanwhile).
- Read-only mode with a diagram needing a decision: the dialog is still offered, since it changes only how the diagram is shown, not the note.
- A custom theme with very low contrast: diagrams and formulas use the theme's text and background tokens; the existing theme editor's AA warning still applies.
- Switching notes while diagrams are still being drawn: unfinished drawings are discarded and do not appear in the new note.
- Printing or exporting the whole note: out of scope; the exported note is the plain Markdown source.

## Requirements *(mandatory)*

### Functional Requirements

**Diagrams**

- **FR-001**: The editor MUST show a fenced code block whose info string's first word is `mermaid` (case-insensitive, backtick or tilde fence) as a drawn diagram.
- **FR-002**: A drawn diagram MUST be centered and scaled to fit the note area's width; the page MUST NOT scroll horizontally because of a diagram.
- **FR-003**: Clicking a diagram, moving the cursor into it with the keyboard, or pressing Enter while it is focused MUST show its source for editing with a drawn preview under it.
- **FR-004**: The preview MUST update within about 500 ms after typing stops.
- **FR-005**: Moving the cursor out of the block or pressing Escape MUST return to the drawn diagram showing the latest source.
- **FR-006**: All standard diagram types the diagram library supports (at least flowchart, sequence, class, state, ER, Gantt, mind map and timeline) MUST be drawn.

**Math**

- **FR-007**: The editor MUST show `$...$` as inline math that flows with surrounding text.
- **FR-008**: The editor MUST show `$$...$$` as display math, centered on its own line, whether the delimiters are on their own lines or on the same line as the formula.
- **FR-009**: An inline formula MUST be recognized only when the opening `$` is directly followed by a non-space character, the closing `$` is directly preceded by a non-space character and not directly followed by a digit, and both are in the same paragraph. An escaped `\$` MUST NOT open or close a formula.
- **FR-010**: Dollar signs in inline code spans, fenced or indented code blocks (including mermaid blocks) and link destinations MUST NOT be treated as math.
- **FR-011**: Clicking a formula or moving the cursor into it with the keyboard MUST show its LaTeX source for editing; leaving it MUST show the drawn result. For an inline formula, the source (with its `$` delimiters) MUST replace the drawing in the line, and a small floating preview of the result MUST appear just under it while editing, without covering the line being edited. For display math, the source MUST be shown in place with the drawn result under it.
- **FR-011a**: A command defined in a formula (with `\newcommand`, `\renewcommand`, `\def` or equivalent) MUST be available to every later formula in the same note, in document order, and MUST NOT be available to earlier formulas or to other notes. Editing or removing a definition MUST redraw the later formulas that depend on it.
- **FR-012**: Left/Right arrow keys MUST move through an inline formula's source one character at a time, entering and exiting it at its delimiters; Up/Down MUST move between lines; the cursor MUST never become stuck at or inside a formula.

**Saving and source fidelity**

- **FR-013**: The source of every formula and diagram MUST be saved exactly as written, character for character, including backslashes, underscores, asterisks, brackets, braces, dollar signs and line breaks.
- **FR-014**: Opening a note containing formulas or diagrams and saving it without editing MUST leave the file byte-for-byte unchanged.
- **FR-015**: The feature MUST NOT introduce any new rewriting of ordinary note text; content outside formulas and diagrams MUST be saved exactly as the editor saves it today.
- **FR-016**: Raw mode, note import, note export and find in note MUST operate on the exact source text, including text inside formulas and diagrams.
- **FR-016a**: Find in note MUST count matches inside diagrams and formulas. When the user steps to such a match, that item MUST open as source with the match highlighted (as if the cursor had moved into it), and MUST return to its drawn view when find moves to a match outside it or find is closed.
- **FR-017**: Copying a selection that includes a drawn formula or diagram MUST put its Markdown source (with delimiters or fences) on the clipboard.
- **FR-018**: Notes using the same syntax written in GitHub, Obsidian or VS Code MUST be shown correctly and saved unchanged.

**Errors and limits**

- **FR-019**: When a diagram or formula cannot be drawn, its source MUST stay visible with a message describing the problem; the rest of the note and the editor MUST keep working and no content may be lost.
- **FR-020**: An empty diagram or formula MUST show a placeholder.
- **FR-021**: A diagram that does not finish drawing within 5 seconds MUST be shown as plain code with a message saying it took too long; typing MUST NOT be blocked while it is being drawn.
- **FR-022**: A diagram or formula source longer than 50,000 characters MUST be shown as plain code with a message saying it is too large, without attempting to draw it.

**Layout and performance**

- **FR-023**: While a diagram is being drawn, a placeholder with a reserved height MUST be shown so surrounding content does not visibly jump.
- **FR-024**: Diagrams and formulas MUST be drawn only when they are near the visible area of the note.
- **FR-025**: A drawn result MUST be reused, not redrawn, while its source, the active theme and (for formulas) the command definitions before it in the note are unchanged.
- **FR-026**: Drawing MUST never block typing or scrolling.
- **FR-027**: The diagram and math capabilities (including math fonts and styles) MUST be loaded only when the open note contains a diagram or a formula respectively; notes without them MUST load nothing extra.

**Themes**

- **FR-028**: Diagrams and formulas MUST take their colors from the active theme (light, dark or custom) and MUST NOT use hard-coded colors that bypass theme tokens, except a diagram whose source sets its own theme or colours and for which the user accepted that theme (FR-028a).
- **FR-028a**: When a diagram's source sets its own theme or colours, the app MUST ask in a dialog whether to use the diagram's theme or keep the app theme. Until the user answers, and if they decline, the diagram MUST be drawn in the app theme. If they accept, the diagram MUST be drawn with its own theme and colours and no longer follows theme switches. The dialog MUST warn when the diagram's colours would fail AA contrast against the note background.
- **FR-029**: Diagram and formula text and lines MUST meet WCAG AA contrast in every built-in theme.
- **FR-030**: When the theme changes, diagrams and formulas MUST update within one second without reloading the note.

**Safety and offline**

- **FR-031**: Formula sources MUST be treated as untrusted: they MUST NOT be able to run scripts, make network requests, load external files, embed raw HTML, or open links, regardless of their content.
- **FR-032**: Diagram sources MUST be treated as untrusted. All settings a diagram source gives (Mermaid directives and settings headers) MUST be honoured, except that unsafe settings or content — turning off Mermaid's safety mode, HTML labels, click actions, callbacks, links, tooltips that run code, or loading external resources — MUST only take effect after the user allows them in a warning dialog that lists what is unsafe and offers "Allow" or "Draw safely". Until the user chooses, and after "Draw safely", the diagram MUST be drawn with those settings ignored so that it cannot run scripts, make network requests, load external files or open links. An allowed diagram's settings MUST affect only that diagram.
- **FR-032a**: The user's answer to a safety or theme dialog MUST be remembered for that diagram in that note and MUST NOT be asked again until the diagram's source changes. The decision MUST NOT be written into the note file. When a note contains several diagrams needing a decision, the user MUST be able to answer for all of them at once. A remembered decision MUST be reversible from the diagram's actions.
- **FR-033**: Imported notes MUST be subject to the same safety rules and dialogs.
- **FR-034**: Diagrams and formulas MUST draw with no network connection; all fonts and styles MUST be bundled with the app.

**Rest of the editor**

- **FR-035**: Read-only mode MUST show drawn diagrams and formulas without allowing edits.
- **FR-036**: Appending transcripts, conflict handling, save states and unsaved-changes warnings MUST behave exactly as before.

**Accessibility**

- **FR-037**: Each drawn diagram MUST be keyboard-focusable with a visible focus indicator and MUST have an accessible name: its title if it declares one, otherwise "Diagram".
- **FR-038**: Each drawn formula MUST be exposed to assistive technology as readable math, with its LaTeX source available.
- **FR-039**: Enter MUST open a focused diagram or formula for editing and Escape MUST return to the drawn view, keeping focus on the item; no new shortcut may conflict with existing editor or app shortcuts.
- **FR-040**: When the user prefers reduced motion, the feature MUST NOT play animations.
- **FR-041**: All behaviour MUST work with keyboard and pointer in light, dark and custom themes.

**Priority 2 — extras**

- **FR-042**: Each drawn diagram MUST offer an "Expand" action opening a larger viewer with zoom in, zoom out, reset and panning, operable by pointer and keyboard; Escape MUST close it and return focus to the diagram.
- **FR-043**: A drawn diagram MUST be exportable as an SVG and as a PNG image file without changing the note. By default the image uses the diagram's current look (app theme, or its own accepted theme) with that theme's background; the export menu MUST also offer "Light, white background", which draws it in the light theme on solid white. Expand and export MUST be unavailable for diagrams that failed to draw.
- **FR-044**: "Insert diagram" and "Insert formula" MUST be available as toolbar buttons and editor commands; each inserts an editable example and places the cursor inside its source. They MUST be unavailable in read-only mode.
- **FR-045**: A fenced block whose language is `math` MUST be shown as display math, following the same editing, error, safety, saving and accessibility rules as `$$` math.

### Key Entities

- **Diagram block**: A fenced code block in a note whose language is `mermaid`. Attributes: exact source text, optional title (from the source), draw state (pending, drawn, error, too large, timed out, empty).
- **Formula**: A span of note text recognized as math. Attributes: kind (inline `$...$`, display `$$...$$`, or `math` block), exact LaTeX source including delimiters, draw state (drawn, error, too large, empty).
- **Diagram decision**: The user's remembered answer for one diagram in one note: whether unsafe settings are allowed and whether its own theme is used. Tied to the diagram's exact source; discarded when the source changes. Stored as app metadata, never in the note file.
- **Drawn result**: The cached visual for a diagram or formula, valid for one combination of source, active theme and (for formulas) the preceding command definitions; never stored in the note file.
- **Note math commands**: The set of commands defined by formulas in a note, accumulated in document order; exists only while the note is shown.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a corpus of at least 30 notes containing formulas and diagrams (including notes written in GitHub, Obsidian and VS Code), 100% are byte-for-byte unchanged after being opened and autosaved without edits.
- **SC-002**: After editing only ordinary text in those notes, 100% of formulas and diagram sources are character-for-character identical to before.
- **SC-003**: 100% of a test set of ordinary dollar usages (prices, lone dollars, dollars in code, escaped dollars) remain plain text, and 100% of valid formulas in the test set are drawn.
- **SC-004**: Diagram previews update within 0.5 seconds of the user stopping typing in at least 95% of edits for diagrams under 200 lines.
- **SC-005**: In a note with 20 diagrams and 200 formulas, keystrokes appear on screen within 50 ms and scrolling shows no visible stutter on a typical student laptop.
- **SC-006**: Opening a note with no diagrams or formulas takes no longer (within 5%) than before the feature and downloads no additional resources.
- **SC-007**: After a theme switch, all visible formulas and all diagrams not kept in their own theme show the new theme within 1 second, and all meet WCAG AA contrast in the built-in themes.
- **SC-008**: A security test set of hostile diagrams and formulas (script injection, links, click handlers, external resources, safety-mode overrides) produces zero script executions, zero network requests and zero opened links unless the user explicitly chose "Allow" for that diagram; 100% of unsafe diagrams show the warning dialog before any unsafe setting takes effect.
- **SC-009**: With the network disabled, 100% of diagrams and formulas in the test notes draw correctly.
- **SC-010**: When a diagram finishes drawing, the text the user is reading or typing moves by no more than one line height; for a diagram already drawn earlier in the session it does not move at all.
- **SC-011**: A keyboard-only user can reach, open for editing, and leave every diagram and formula in a test note with no keyboard traps, and a screen reader announces every diagram's name and every formula as math.
- **SC-012**: Invalid, empty, oversized and slow diagrams and formulas never stop the user from continuing to type elsewhere in the note, in 100% of test cases.

## Assumptions

- The editor is the existing note editor from Feature 002 (live mode plus raw mode); this feature extends live mode and read-only mode only. Raw mode keeps showing plain source.
- "Mermaid" and "LaTeX" denote the syntax users write; the subset of LaTeX supported is that of a standard browser math typesetter as used by GitHub and Obsidian. Unsupported commands are shown as errors per FR-019.
- Diagram titles come from the diagram's own title declaration (for example a `title` line or front-matter title); no separate title field is stored.
- The drawn result is never written into the note file or the database; only the Markdown source is stored (Constitution Principle II).
- Drawing happens entirely in the user's browser. Diagram decisions (FR-032a) are app metadata; the plan decides whether they are kept through the versioned API or locally in the browser, and must check the theme override against Constitution Principle V (theme tokens, AA contrast) in its Constitution Check.
- "Near the visible area" means roughly one screen above and below the viewport.
- Export of a single diagram as SVG/PNG saves a file through the browser's normal download; whole-note export with drawn content is out of scope.
- The 50,000-character limit applies per diagram or formula source, not per note.
- Out of scope: visual diagram/equation editors, other diagram or math languages, diagrams or formulas in quick notes or task descriptions, exporting whole notes with drawn content, collaborative editing, and live links between diagrams and other app data.
