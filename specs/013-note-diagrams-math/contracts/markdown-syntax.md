# Contract: Markdown Syntax for Diagrams and Math

The micromark extension (on import) and the Lexical transform (while typing) share one
recogniser, `mathScanner.ts`, so both follow these rules. The unit tests in
`tests/unit/math-scanner.test.ts` check every example in the tables below.

## Diagram block

- A fenced code block (CommonMark fence: three or more ```` ` ```` or `~`) whose info string's
  first word, ignoring case, is `mermaid`. Indented code blocks are never diagrams.
- It is written back exactly: the same fence characters and count, the same info string and
  the same body.
- An unclosed fence follows CommonMark: it runs to the end of its container. In that case it is
  drawn only if the body is not empty.

## Math fence (P2, FR-045)

- The same as a diagram block, but the first word of the info string is `math`. It is drawn as
  display math.

## Display math `$$`

| Form | Example | Result |
|---|---|---|
| Several lines | `$$` on its own line, then LaTeX lines, then `$$` on its own line | MathBlockNode, `form = dollar-multiline` |
| One line, alone | A line containing only `$$x^2$$` (spaces around it allowed) | MathBlockNode, `form = dollar-oneline` |
| Inside text | `area is $$\pi r^2$$ here` | InlineMathNode, drawn with display-style maths but kept in the line |
| No closing `$$` | `$$` on its own line with no closing `$$` before the container ends | Plain text, not math |

- The opening `$$` line can't carry other text after it in the several-line form. Text after it
  turns the line into ordinary paragraph text.
- `$$$$` (empty) gives an empty MathBlockNode with a placeholder (FR-020).

## Inline math `$…$`

A span from an opening `$` to a closing `$` is math only if **all** of the following hold:

1. The opening `$` is not escaped (`\$`), and the character right after it is not a space and
   not `$`.
2. The closing `$` is not escaped, the character right before it is not a space, and the
   character right after it is not a digit (0–9).
3. Both are in the same paragraph (soft line breaks are allowed; a blank line ends the
   paragraph).
4. Neither is inside a code span, a code block, an autolink, a link destination, or HTML. A code
   span binds tighter than math, as in CommonMark. A code span that starts inside a formula is
   kept whole, so a `$` inside it can't close the formula (`$a `b$` c$` is one formula).
5. The closing `$` is the first `$` after the opening one that satisfies 2. The scan goes left to
   right and does not backtrack.

| Input | Math? |
|---|---|
| `$E = mc^2$` | yes |
| `it costs $5 and $10` | no (`$10`: the second `$` follows a space, so it can't close) |
| `$5` / lone `$` | no |
| `$ x$` | no (space after the opening `$`) |
| `$x $` | no (space before the closing `$`) |
| `$x$5` | no (a digit follows the closing `$`) |
| `` `$x$` `` | no (code span) |
| `\$x\$` | no (both escaped) |
| `$a_1 * b_2$` | yes; source saved exactly |
| `$x$, $y$` | yes, two formulas |
| ``it costs $5 and $10, a lone $ and `$x$` code.`` | no (the only valid closing `$` is inside a code span) |

## Writing back (export)

- Every diagram, math fence, display formula and inline formula is written back **exactly as it
  was written**, character for character.
- In ordinary text, a `$` gets a `\` added only if leaving it bare would make the text a valid
  formula when the note is opened again (research R3). No other rule for ordinary text changes.
