# Implementation Plan: Diagrams and Math in Notes

**Branch**: `013-note-diagrams-math` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-note-diagrams-math/spec.md` (5 clarifications of
2026-10-19).

## Summary

The note editor (MDXEditor/Lexical) draws ```` ```mermaid ```` blocks as diagrams and `$…$`,
`$$…$$` and ```` ```math ```` as KaTeX math. Notes stay plain Markdown, and every formula and
diagram is saved exactly as written.

Technical approach:

- **Exact saving**: one custom MDXEditor realm plugin (`diagramMathPlugin`) adds a micromark
  extension for the spec's dollar rule, import visitors that turn formulas and diagrams into
  Lexical nodes holding their exact source slice, and an export path (`uhRaw`) that writes that
  source back unchanged.
- **Inline editing**: inline formulas switch between a drawn node and a source text node, so the
  caret walks through `$…$`.
- **Diagram drawing**: Mermaid runs in a **sandboxed renderer frame**. This keeps diagram code
  away from the app, makes the 5 s limit enforceable (the frame is removed), and keeps typing
  responsive.
- **Formula drawing**: KaTeX runs on the main thread with `trust: false` and commands shared in
  document order.
- **Loading and caching**: both libraries load only when a note needs them. Results are cached
  by source and theme.
- **Theme**: colours come from the app's theme tokens.
- **Permissions**: diagrams that ask for unsafe settings or their own theme are drawn safely
  until the user answers a non-blocking decision dialog. The answer is remembered per diagram in
  this browser.

## Technical Context

**Language/Version**: TypeScript 5.9 / React 19.3 (frontend); Python 3.12+ (backend, for small
server changes only).

**Primary Dependencies**: **new, pinned exactly** (research R1): `mermaid@12.1.0`, `katex@0.19.0`,
`dompurify` (an exact version at least 14 days old). Existing: `@mdxeditor/editor` 4.3.2 (Lexical
0.48, mdast-util-from/to-markdown, its bundled CodeMirror), shadcn/ui (Dialog, AlertDialog,
DropdownMenu, Popover, Button, Tooltip), Phosphor icons, `lib/storage.ts`, `app/theme.tsx`.

**Storage**: no change to SQLite or files. Notes stay `.md` files. Browser localStorage keys
`uh.diagramDecisions.<noteId>` and `uh.diagramHeights` (data-model.md).

**Testing**:
- Vitest:
  - scanner
  - round trips through MDXEditor import/export with 30 fixture notes
  - `\$` handling
  - directive classifier
  - decision store
  - shared commands
  - lazy-loading check
- pytest: asset CORS header and the allowed frame's CSP.
- Playwright on chromium-light and chromium-dark, plus a custom theme:
  - drawing and editing
  - arrow keys
  - hostile diagrams with network monitoring
  - offline
  - the 20-diagram / 200-formula performance note
  - theme switch
  - axe

**Target Platform**: evergreen desktop browsers. The process isolation of the renderer frame
(SC-005) is checked in Chromium.

**Project Type**: Web application (existing `backend/` and `frontend/`).

**Performance Goals**:
- Keystrokes appear in under 50 ms with 20 diagrams and 200 formulas (SC-005).
- The preview updates within 0.5 s (400 ms debounce, SC-004).
- A theme switch finishes in under 1 s for visible items (SC-007).
- A note with no math or diagrams is no slower than before (within 5%) and loads no extra bytes
  (SC-006).

**Constraints**:
- Byte-for-byte fidelity of formulas and diagrams (FR-013/014).
- Nothing new is rewritten in ordinary text (FR-015).
- Works offline with bundled fonts (FR-034).
- 5 s render limit and 50,000-character limit.
- The CSP stays strict for the app itself.
- Constitution v1.2.0, principles I, II, V, VI and VII.

**Scale/Scope**: up to about 20 diagrams and 200 formulas per note. Two editor panes can show the
same note.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|---|---|---|
| I. User work never lost | Sources are kept exactly (R2). Drawing failures never change content (FR-019). Autosave, drafts, conflict handling and append-only transcripts are unchanged. Appending exports the note again, but the `uhRaw` export keeps formulas and diagrams exact. No new destructive action. "Reset decision" only resets how a diagram is shown | ✅ |
| II. Data ownership and open formats | The notes stay plain `.md`. Drawn output is never stored. Decisions are browser-only display state, never kept in the database or the note (R10) | ✅ |
| III. Frontend/backend separation | No new endpoints, so no API change. The frontend still reaches the backend only through `/api/v1` | ✅ |
| IV. Transcription and secrets | Not affected | ✅ |
| V. UI quality and accessibility | Built from shadcn primitives. Diagrams get their colours from theme tokens (R8). Keyboard: Enter, Escape and arrow keys, with visible focus. Formulas use MathML. Reduced motion is respected. AA is checked with axe. **One justified exception**: a diagram the user explicitly agreed may use its own theme shows the author's colours (FR-028a). This is the user's own content, shown after consent and with an AA warning (Complexity Tracking) | ✅ (justified) |
| VI. Tests | There are no new endpoints. The server changes (CORS header, the frame's CSP) get pytest coverage. The critical flows are unchanged, and the existing transcription-append integration test gains a note with formulas (to check formulas stay exact on append) | ✅ |
| VII. Simplicity and spec discipline | Three new frontend dependencies, a second HTML page and a frame-based renderer, all justified below. Find in note and a read-only mode are **not** built because they are outside this spec (R12) | ✅ (justified) |

**Post-design re-check (after Phase 1)**: unchanged. The design adds no table, no service and no
endpoint. The deviations are listed in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/013-note-diagrams-math/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── markdown-syntax.md
│   ├── diagram-sandbox-protocol.md
│   └── ui-contract.md
├── checklists/requirements.md
└── tasks.md              # /speckit-tasks
```

### Source Code (repository root)

```text
frontend/
├── public/diagram-sandbox.html          # safe renderer frame page (meta CSP, no network)
├── public/diagram-sandbox-allowed.html  # live frame page for diagrams the user allowed
├── public/sandbox/                      # generated by `pnpm build:sandbox` (gitignored)
├── vite.sandbox.config.ts               # builds src/sandbox/diagramRenderer.ts as one IIFE
├── vite.config.ts                       # + katex/mermaid/dompurify/lexical in optimizeDeps
├── src/
│   ├── sandbox/diagramRenderer.ts       # frame side: safe render queue / allowed live diagram
│   ├── styles/tokens.css                # + --diagram-export-background
│   ├── index.css                        # + diagram/formula styles (tokens only)
│   └── features/sessions/editor/
│       ├── MarkdownEditor.tsx           # notePlugins(): + diagramMathPlugin, toolbar buttons, decisions banner
│       └── diagram-math/
│           ├── plugin.ts                # realm plugins: syntax, mdast, visitors, nodes, subscriptions
│           ├── mathScanner.ts           # shared $-rule recogniser
│           ├── micromarkMath.ts         # micromark constructs + exact-source mdast extension
│           ├── exactMarkdown.ts         # import/export visitors, uhRaw, \$ handling, fence closing
│           ├── nodes/                   # DiagramNode, MathBlockNode, InlineMathNode, InlineMathSourceNode
│           ├── transforms.ts            # typing, arrow keys, $$+Enter, source ⇄ drawn
│           ├── katexLoader.ts, noteCommands.ts            # lazy KaTeX, shared commands
│           ├── MathView.tsx, InlineMathPreview.tsx, BlockSourceEditor.tsx, useBlockEditing.ts
│           ├── rendererHost.ts, renderCache.ts, useNearViewport.ts, themeVars.ts, useReducedMotion.ts
│           ├── DiagramView.tsx, AllowedDiagramFrame.tsx, DiagramActions.tsx, DiagramViewer.tsx, exportImage.ts
│           ├── directives.ts, decisions.ts, DecisionDialog.tsx, editorContext.ts
│           ├── reveal.ts                # revealSource/conceal for a later find in note
│           └── InsertButtons.tsx
└── tests/
    ├── fixtures/notes/*.md              # 30-note corpus
    ├── unit/math-scanner, micromark-math, diagram-math-roundtrip, diagram-math-editor,
    │   diagram-math-clipboard, diagram-math-editing, diagram-math-lazy, diagram-math-readonly,
    │   diagram-directives, diagram-decisions, katex-commands (+ helpers/)
    └── e2e/diagrams-math.spec.ts, diagrams-math-perf.spec.ts, diagrams-math-a11y.spec.ts (+ helpers)

backend/
├── src/unihelper/main.py                # APP_CSP + SANDBOX_CSP (per-page CSP for the two frame pages)
└── tests/integration/test_sandbox_headers.py, test_transcribe_append_flow.py (+ formulas case)
```

**Structure Decision**: This is the existing web application. All the editor work goes in one new
folder, `features/sessions/editor/diagram-math/`, plugged into `MarkdownEditor.tsx` as one MDXEditor
plugin. The frame pages are extra Vite build inputs served by the existing SPA mount. The backend
changes are limited to response headers in `main.py`.

## Implementation Phases (for /speckit-tasks)

1. **Foundation**:
   - `mathScanner`, `micromarkMath` and the `uhRaw` export, with nodes that only show source.
   - The round-trip corpus passes: the fidelity gate (US3, before any drawing).
2. **Math (US2)**: KaTeX loader, MathView, inline swap and arrow keys, `$$`/one-line, shared
   commands, `\$` handling.
3. **Diagrams (US1)**: renderer frame and host, DOMPurify, DiagramView with editing and preview,
   time and size limits, placeholder and height hints, lazy loading.
4. **Errors, safety and decisions (US4)**: directive classifier, decision store and dialog,
   allowed frame, backend headers, hostile and offline e2e tests.
5. **Theme and performance (US5)**: themeVars and themeKey, near-viewport drawing, cache,
   performance e2e test.
6. **Accessibility (US6)**: roles and names, MathML, focus, reduced motion, axe.
7. **P2 (US7, US8)**: viewer, SVG/PNG/light export, insert buttons, ```` ```math ```` fences.

## Risks

- **MDXEditor's internals**: the export path for container prefixes inside lists and quotes is
  the riskiest part. The round-trip corpus includes nested cases and runs first (phase 1).
- **Sandboxed frame CSP and `'self'`**: an opaque-origin frame loading module scripts from
  `'self'` depends on how the browser resolves `'self'` for sandboxed documents and on CORS for
  `/assets`. Checked by an e2e test early in phase 3. If it fails, the fallback is to
  build the frame script as one inline IIFE bundle and allow it by hash.
- **Non-Chromium browsers** may run the frame on the main thread. Rendering is then queued for
  idle time, and the 5 s limit still applies when a render finishes late. This is accepted for
  this release.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 3 new dependencies (mermaid, katex, dompurify), plus direct pins of 7 packages MDXEditor already ships (lexical, @lexical/react, @lexical/utils, mdast-util-from/to-markdown; types: micromark-util-types, @types/mdast) | Drawing Mermaid and LaTeX is the feature itself. DOMPurify cleans the frame's SVG before it is inserted | Writing our own renderers is not realistic. Mermaid's built-in sanitizer alone doesn't protect the parent page from a compromised frame |
| A second HTML page plus a sandboxed renderer frame | Enforcing the 5 s limit (FR-021), never blocking typing (FR-026), and isolating untrusted diagram code, including code the user allowed (FR-032) | Mermaid on the main thread can't be stopped or isolated. Mermaid's `sandbox` level still renders on the main thread |
| A per-page CSP for the two frame pages | The app CSP's `frame-ancestors 'none'` would block the frames, and the allowed frame must be able to do what the diagram asks (clarification Q2) | Loosening the global CSP would weaken the whole app. CORS on `/assets` turned out not to be needed (classic script, research R6) |
| Theme-token exception for diagrams the user allowed to keep their own theme (Principle V) | Clarification Q2: the user decides, in a dialog, to keep the author's colours | Always forcing the app theme was the alternative, and the user rejected it in clarification. An AA warning is shown in the dialog |
| A custom micromark math extension instead of `micromark-extension-math` | The spec's dollar rule (no `$5 … $10` math) and no escaping of ordinary `$` (FR-009, FR-015) | The upstream extension uses a different rule and escapes every `$` on export |
