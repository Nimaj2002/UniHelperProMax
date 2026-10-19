# Data Model: Diagrams and Math in Notes

**Feature**: 013-note-diagrams-math | **Date**: 2026-10-19

There are no new database tables, migrations or API schemas. The note file stays plain Markdown
(Constitution II). Everything below is either an editor node that exists only in memory, a cache
in memory, or a small convenience stored in the browser.

## Editor nodes (Lexical, in memory only)

All of them are serialised back to Markdown through the `uhRaw` export path ([research R2](./research.md#r2--keeping-source-text-exact-through-mdxeditors-export)).
None of them stores a drawn result.

### DiagramNode (block, DecoratorNode)

| Field | Type | Rule |
|---|---|---|
| `fence` | string | The opening fence exactly as written, e.g. "```", "````" or "~~~". The closing fence is written with the same characters |
| `info` | string | The info string exactly as written. Its first word, ignoring case, is `mermaid` |
| `value` | string | The body exactly as written, with line breaks kept and nothing escaped |

- `getTextContent()` returns `fence + info + "\n" + value + "\n" + fence`.
- Derived when drawn (not stored): `title` (front-matter `title`, or `accTitle`), `settings`
  (parsed directives), `flags = {unsafe: string[], theme: string[]}`.

### MathBlockNode (block, DecoratorNode)

| Field | Type | Rule |
|---|---|---|
| `form` | `"dollar-multiline" \| "dollar-oneline" \| "fence"` | How it was written |
| `raw` | string | The full source exactly as written, delimiters included (`$$…$$`, or the whole fenced block for `form = "fence"`) |
| `fence`, `info` | string? | Only for `form = "fence"` (FR-045), as in DiagramNode |

- The LaTeX that gets drawn is `raw` without its delimiters. `raw` itself never changes when the
  note is saved.

### InlineMathNode (inline, DecoratorNode) ⇄ InlineMathSourceNode (inline, TextNode subclass)

| Field | Type | Rule |
|---|---|---|
| `raw` | string | `$…$` (or `$$…$$` written inside a line) exactly as written. It must match the recognition rule in [markdown-syntax](./contracts/markdown-syntax.md) |

States and how they change ([research R4](./research.md#r4--lexical-nodes-and-editing-behaviour)):

```text
InlineMathNode (drawn) ──caret enters / click──▶ InlineMathSourceNode (editing, floating preview)
InlineMathSourceNode ──selection leaves──▶ InlineMathNode   if the text is still valid math
                                      └──▶ TextNode         if it is no longer valid (becomes plain text)
```

These swaps are tagged `history-merge`, so they never become undo steps of their own.

## Draw state (every diagram and formula, in memory)

```text
idle ──near viewport──▶ pending ──ok──▶ drawn
                          │ ├─error──▶ error      (source and message shown, FR-019)
                          │ └─>5 s───▶ timedOut   (plain code and message, FR-021; diagrams only)
idle ──source > 50 000 chars──▶ tooLarge          (plain code and message, FR-022)
idle ──source empty──▶ empty                      (placeholder, FR-020)
any ──source / themeKey / commands change──▶ idle
diagram with flags ──no decision yet──▶ drawn in safe mode and app theme, then the dialog is offered
```

## RenderCache (in memory, one per browser tab)

- Key: the item's kind, source, `themeKey` and (formulas) `commandsHash`.
- Value: `{output: svg | html, width, height, error?}`.
- LRU of 300 entries. Cleared when the page reloads.

## Note math commands (in memory, one per open note)

- An ordered list of the *definer* formulas (`\newcommand`, `\renewcommand`, `\providecommand`,
  `\def`, `\gdef`, `\let`), in the order they appear in the note.
- `commandsBefore(i)` is the KaTeX macro table built by running the definers before formula *i*.
  `commandsHash(i)` is part of formula *i*'s cache key (FR-011a, FR-025).
- Rebuilt whenever a definer is added, edited or removed. Only the formulas after it are marked
  out of date.

## DiagramDecision (browser localStorage, through `lib/storage.ts`)

Key: `uh.diagramDecisions.<noteId>`

```json
{
  "<hash of DiagramNode source + info>": { "unsafe": "allow" | "safe", "theme": "own" | "app", "at": "2026-10-19T10:00:00Z" }
}
```

- `unsafe` is present only if the diagram had unsafe settings, and `theme` only if it had theme
  settings.
- A decision is looked up by the hash of the current source. Once the source is edited, the
  hash no longer matches, so the old decision stops applying and the dialog is offered again
  (FR-032a).
- Up to 100 decisions per note and 200 notes. The oldest `at` is removed first. Removed for a
  note when that note is permanently deleted, if the delete happens in this browser.
- Never written to the note file or to the server ([research R10](./research.md#r10--diagram-decisions-fr-032a-where-they-are-kept)).

## DiagramHeightHint (browser localStorage)

- Key `uh.diagramHeights`, a map from the diagram's source hash to `heightPx`. LRU of 500.
- Used only to reserve space before a diagram is drawn (FR-023, SC-010).

## Settings found in a diagram (derived, not stored)

| Group | Settings found | Effect |
|---|---|---|
| unsafe | `securityLevel` (any value other than `strict`), `htmlLabels` / `flowchart.htmlLabels: true`, `secure`, `dompurifyConfig`, `click`, `callback` and `href` lines, `link`/`links` (in some diagram types), `url(` or `@import` in `themeCSS` | Needs "Allow" (FR-032) |
| theme | `theme`, `themeVariables`, `themeCSS`, `darkMode`, colour properties in `style`, `classDef` and `linkStyle` lines | Needs "Use diagram theme" (FR-028a) |
| other | everything else (layout, spacing, curve, direction, font size, …) | Always followed |
