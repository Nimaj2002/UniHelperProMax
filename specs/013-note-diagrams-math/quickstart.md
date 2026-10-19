# Quickstart: Validating Diagrams and Math in Notes

**Feature**: 013-note-diagrams-math

## Prerequisites

- The dependencies are installed (`cd frontend && pnpm install`, `cd backend && uv sync`).
- The fixture notes are in `frontend/tests/fixtures/notes/` (30 `.md` files; see [research R15](./research.md#r15--testing)).

## Automated checks

```bash
# frontend unit: scanner, round trips, \$ handling, directive classifier, decisions, lazy loading
cd frontend && pnpm test -- math-scanner diagram-math-roundtrip diagram-directives diagram-decisions diagram-math-lazy

# backend: asset CORS header and the CSP for the allowed frame
cd backend && uv run pytest tests -k "sandbox or asset_cors"

# e2e (chromium-light and chromium-dark)
cd frontend && pnpm e2e -- diagrams-math
```

What a pass looks like: every test is green. The round-trip suite prints `30/30 notes
unchanged, 0 formula/diagram diffs` (SC-001/SC-002).

## Manual scenarios

Run `./start.sh`, open any session and create a note.

1. **Diagram**: paste a mermaid flowchart, a sequence diagram and a Gantt chart. Each is drawn,
   centered, and the page doesn't scroll sideways. Click one, change a label, and the preview
   updates in about 0.5 s. Press Escape and the diagram shows the change. → US1
2. **Math**: type `the energy $E = mc^2$ is`, a `$$`…`$$` block, and `it costs $5 and $10`. The
   formulas are drawn and the price sentence stays plain text. Use ←/→ across the inline
   formula: the caret walks through `$E = mc^2$` and comes out the other side. → US2
3. **Exact saving**: open a fixture from `tests/fixtures/notes/obsidian-*.md` with raw mode on
   and copy the text. Switch to rich text, edit a word outside any formula, and switch back to
   raw. Every formula and diagram is unchanged. → US3, [markdown-syntax](./contracts/markdown-syntax.md)
4. **Errors**: break a diagram (`flowchart LR\n A -->`). The source stays visible with a message
   and typing elsewhere still works. Paste a 60,000-character diagram and it is shown as code with
   the "too large" message. → US4
5. **Safety**: paste
   ```` ```mermaid\n%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A-->B\n click A call alert(1)\n``` ````.
   A banner offers a review. Until you choose, the diagram is drawn safely and clicking A does
   nothing. Choose "Allow" and the diagram runs live in its own frame. Edit its source and you
   are asked again. → FR-032, FR-032a, [ui-contract](./contracts/ui-contract.md)
6. **Theme**: paste a diagram with `%%{init: {"theme":"forest"}}%%`. You are asked about the
   theme. "Keep app theme" keeps it following the app. Switch light → dark → a custom theme and
   diagrams and formulas update in under 1 s. → FR-028a, SC-007
7. **Offline and lazy loading**: open a note with no math or diagrams with DevTools → Network
   open. No `mermaid`, `katex` or sandbox requests appear. Go offline (DevTools) and open a note
   with diagrams and formulas: everything draws. → FR-027, FR-034
8. **Shared commands**: put `$\newcommand{\R}{\mathbb{R}}$` first and `$x\in\R$` later. The second
   formula draws ℝ. Rename the command and the second formula shows an error. → FR-011a
9. **Accessibility**: Tab to a diagram. It has a visible focus ring and the screen reader reads
   its title or "Diagram". Enter edits and Escape returns. With reduced motion turned on in the
   OS, nothing animates. → US6
10. **P2**: Expand a diagram, zoom with `+` and `-`, pan with the arrow keys, Escape and focus
    returns. Export it as SVG, PNG and "light on white". Use "Insert diagram" and "Insert formula"
    from the toolbar. A ```` ```math ```` block is drawn as display math. → US7, US8

## Known limits to check against the spec

- There is no find in note and no read-only note mode in the app today (research R12). The
  `revealSource` and not-editable behaviour is covered by unit tests only.

## Measurements

Taken on 2026-10-19 with `pnpm build`, comparing `main` and this branch (gzip sizes):

| Chunk | `main` | this branch | Notes |
|---|---|---|---|
| `index-*.js` (app entry) | 281.2 KB | 281.3 KB | unchanged |
| `WorkspacePage-*.js` (the note editor) | 263.6 KB | 283.6 KB | +20 KB: the feature's own editor code (nodes, parser, views) |
| `katex-*.js` + `katex-*.css` + fonts | — | 76.9 KB + fonts | loaded only when a note shows a formula |
| `purify.es-*.js` (DOMPurify) | — | small | loaded only with the first diagram |
| `sandbox/diagram-renderer.js` (Mermaid) | — | 1.4 MB | loaded only inside the renderer frame, with the first diagram |

A note without diagrams or formulas loads none of KaTeX, DOMPurify, Mermaid or the frame
(unit test `diagram-math-lazy`, e2e "loads nothing extra"). The note editor chunk is 7.6 %
larger. On the app's local server that is a few milliseconds, but it is more than SC-006's 5 %
by size. Moving the diagram views behind `React.lazy` would close the gap if needed.

E2e timings from `diagrams-math-perf.spec.ts` (Chromium, this machine): keystroke p95 under the
67 ms bound (50 ms + one frame) with 20 diagrams and 200 formulas, a theme switch visible in
under 1 s, and 0 px shift when a diagram seen before is drawn again.
