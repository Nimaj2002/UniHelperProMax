# Contract: Editor UI for Diagrams and Math

The e2e tests rely on the selectors and behaviour below.

## Drawn diagram

- Wrapper: `[data-uh="diagram"]`, `role="group"`, `tabindex="0"`, `aria-roledescription="diagram"`,
  `aria-label` set to the title or "Diagram". (Not `role="img"`: an image role makes its contents
  presentational, which would hide the "Diagram actions" button from assistive technology. The
  drawn SVG itself is `aria-hidden`.)
- `data-state` is one of `pending | drawn | error | timedOut | tooLarge | empty | allowed`.
- Keys while it has focus: **Enter** opens editing. In editing, **Escape** returns to the drawing
  and keeps focus on the wrapper.
- Action menu, a shadcn `DropdownMenu` trigger `[data-uh="diagram-actions"]` with the accessible
  name "Diagram actions". Items: Edit, Expand (P2), Export SVG (P2), Export PNG (P2), Export light
  on white (P2), Copy source, Reset decision (only shown when a decision is stored).
- Editing: `[data-uh="diagram-source"]` (CodeMirror) and under it `[data-uh="diagram-preview"]`.
  The preview updates 400 ms after the last keystroke.
- Messages: `[data-uh="render-message"]`, `role="status"`. The texts are "Diagram error: …",
  "This diagram took longer than 5 seconds to draw and is shown as code.", "This diagram is too
  large to draw (over 50,000 characters) and is shown as code.", and "Empty diagram. Press Enter
  to edit."

## Formula

- Inline: `[data-uh="math-inline"]`. Display: `[data-uh="math-block"]`. Both have
  `data-state` like a diagram, without `timedOut` or `allowed`.
- The inline source while editing: `[data-uh="math-source"]` (a text node span in the line), and
  `[data-uh="math-preview"]`, a floating popover (Radix Popover, not modal, keeps focus in the
  editor).
- A display formula is focusable (`tabindex="0"`). Enter edits and Escape returns.
- An inline formula is reached with the arrow keys (it is not a Tab stop). Its MathML is exposed
  to assistive technology.

## Decision dialog (FR-032, FR-028a)

- A shadcn `AlertDialog`, `[data-uh="diagram-decision"]`, with the title "This note's diagrams
  ask for extra permissions".
- It lists each diagram (by title or "Diagram N") with the settings that were found. For each:
  - Unsafe settings: "Allow" or "Draw safely" (default focus).
  - Theme settings: "Use diagram theme" or "Keep app theme" (default focus). An AA warning is
    shown when the diagram's colours fail contrast.
- "Apply to all" options at the top. The dialog is not modal for the note: until the user
  answers, diagrams are drawn safely and in the app theme.
- It is offered once each time the note is opened, as a non-blocking banner
  `[data-uh="diagram-decision-banner"]` with a "Review" button that opens the dialog. Diagrams
  already decided are not listed.

## Expand viewer (P2)

- A shadcn `Dialog`, `[data-uh="diagram-viewer"]`. Buttons: Zoom in (`+`), Zoom out (`-`),
  Reset (`0`). Arrow keys pan. Escape closes it and focus returns to the diagram wrapper.

## Toolbar (P2)

- `[data-uh="insert-diagram"]` with the accessible name "Insert diagram", and
  `[data-uh="insert-formula"]` with the accessible name "Insert formula". Both sit right after
  the existing Insert code block button and are hidden when the editor isn't editable.
- No new keyboard shortcuts.
