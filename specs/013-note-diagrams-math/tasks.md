---

description: "Task list for 013 — Diagrams and Math in Notes"
---

# Tasks: Diagrams and Math in Notes

**Input**: Design documents from `/specs/013-note-diagrams-math/`

**Prerequisites**: plan.md, spec.md (US1–US8, 5 clarifications), research.md (R1–R15),
data-model.md, contracts/markdown-syntax.md, contracts/diagram-sandbox-protocol.md,
contracts/ui-contract.md, quickstart.md

**Tests**: Included. Constitution VI requires tests for every server change, and the spec's
success criteria (SC-001 to SC-012) can only be checked by automated tests: the round-trip
corpus, hostile diagrams, offline, performance and axe.

**Organization**: Phase 2 is the **fidelity gate**: formulas and diagrams survive saving exactly,
even before anything is drawn. Then the P1 stories in plan order: US3 (verification), US2, US1,
US4, US5, US6. Then the P2 stories: US7, US8.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story from spec.md (US1–US8)

## Conventions (apply to every task)

- Editor code lives in `frontend/src/features/sessions/editor/diagram-math/` (called `dm/`
  below). It is wired into `frontend/src/features/sessions/editor/MarkdownEditor.tsx` as **one**
  MDXEditor realm plugin created with `realmPlugin({ init(realm) { realm.pub(addSyntaxExtension$ …),
  addMdastExtension$, addImportVisitor$, addExportVisitor$, addToMarkdownExtension$, addLexicalNode$,
  addComposerChild$ } })` from `@mdxeditor/editor`.
- UI is built only from shadcn/ui primitives in `frontend/src/components/ui/` (Dialog,
  AlertDialog, DropdownMenu, Popover, Button, Tooltip), with Phosphor icons. Colours come only from
  theme tokens (`frontend/src/styles/tokens.css`). `tests/unit/no-hardcoded-colors.test.ts` must
  keep passing.
- Selectors, `data-uh` attributes, accessible names and message texts are **exactly** as written
  in `contracts/ui-contract.md`.
- Browser storage goes through `frontend/src/lib/storage.ts` `readLocal/writeLocal` and is wrapped
  in try/catch, so the feature works without it.
- New dependencies are pinned **exactly** (no `^`): `mermaid@12.1.0`, `katex@0.19.0`, and
  `dompurify` at an exact version published ≥ 14 days before install (research R1).
- Unit tests go in `frontend/tests/unit/*.test.ts(x)` (Vitest + jsdom). E2e tests go in
  `frontend/tests/e2e/*.spec.ts` (Playwright projects chromium-light and chromium-dark). The new
  e2e specs must **not** use `tests/e2e/notes-helpers.ts` `editor()`, which still targets
  `.cm-content`. Use `.mdx-note-content` instead.
- Backend tests go in `backend/tests/integration/` (pytest). Run them with `cd backend && uv run pytest`.

---

## Phase 1: Setup

- [X] T001 Add the exact-pinned dependencies `mermaid@12.1.0`, `katex@0.19.0` and `dompurify` (exact version ≥ 14 days old) to `frontend/package.json` with `pnpm add -E`, and commit the `frontend/pnpm-lock.yaml` update
- [X] T002 [P] Create the folder skeleton `frontend/src/features/sessions/editor/diagram-math/` (with `nodes/`) and `frontend/src/sandbox/`, with an `index.ts` that exports `diagramMathPlugin` (empty for now) in `frontend/src/features/sessions/editor/diagram-math/index.ts`
- [X] T003 [P] Move the contrast helper from `frontend/tests/unit/contrast.ts` to `frontend/src/lib/contrast.ts` (same exported `contrast(fg, bg)`, also export `relativeLuminance`) and update the imports in `frontend/tests/unit/tokens.contrast.test.ts` and any other test that imports it — *done differently: the app already has `contrast()`/`luminance()` in `frontend/src/features/settings/themes/colors.ts`; that helper is reused and nothing was moved*
- [X] T004 [P] Create the 30-note fixture corpus `frontend/tests/fixtures/notes/*.md`, named `github-*.md`, `obsidian-*.md`, `vscode-*.md` and `edge-*.md`. Together they must cover:
  - inline, display several-line, display one-line and display-in-text math
  - `math` fences and `mermaid` fences with ```` ``` ````, ```` ```` ```` and `~~~`, plus an info string `mermaid title`
  - diagrams and formulas inside list items and blockquotes
  - formulas containing `\ _ * [ ] { } $` and line breaks
  - prices (`it costs $5 and $10`), a lone `$`, `$ x$`, `$x $`, `$x$5`, `\$x\$`, and dollars inside code spans and code blocks
  - `\newcommand` definers and the formulas that use them
  - an unclosed `$$` and an unclosed fence
  - `%%{init}%%` and front-matter config, including `securityLevel`, `click` and `theme`
  - Write a `frontend/tests/fixtures/notes/README.md` listing what each file covers

---

## Phase 2: Foundational — fidelity gate (blocks every story)

**Purpose**: the formula and diagram nodes exist and save exactly as written. Nothing is drawn yet;
the nodes show their source as plain monospace text.

- [X] T005 [P] Write `frontend/tests/unit/math-scanner.test.ts` covering every row of the inline table and every display form in `contracts/markdown-syntax.md`, plus soft line breaks in a paragraph, a paragraph break that ends a formula, and code spans/autolinks/link destinations being skipped. It must fail until T006 exists
- [X] T006 Implement the shared recogniser in `dm/mathScanner.ts`:
  - `scanInline(text, skipRanges): Array<{start, end, raw}>`, which follows the five rules in `contracts/markdown-syntax.md` exactly. The opening `$` must be unescaped and followed by a character that is not a space or `$`. The closing `$` must be unescaped, preceded by a character that is not a space, and **not followed by a digit 0–9**. Both must be in the same paragraph. The scan is left to right with no backtracking.
  - `isDisplayLine(line)` and `hasMath(markdown)` (a cheap test for FR-027)
- [X] T007 Implement the micromark syntax extension and the from-markdown extension in `dm/micromarkMath.ts`:
  - A flow construct for several-line `$$` (the opening line may contain nothing after `$$`; unclosed means plain text) and for a line holding only `$$…$$`.
  - A text construct for `$…$` and `$$…$$` inside text, which calls `mathScanner` rules.
  - The mdast nodes are `displayMath {raw, form: "dollar-multiline"|"dollar-oneline"}` and `inlineMath {raw}`. `raw` is the **exact source slice including delimiters**, taken from the token offsets in the original markdown string.
- [X] T008 [P] Implement the Lexical nodes in `dm/nodes/`, each with `importJSON/exportJSON`, `getTextContent()` returning the exact source, and `exportDOM()` returning `<pre><code>` (blocks) or `<code>` (inline) holding the source (research R11):
  - `DiagramNode.ts` with fields `fence` (the opening fence exactly as written, e.g. "```", "````" or "~~~"), `info` (exactly as written; first word, ignoring case, is `mermaid`) and `value` (the body exactly as written, line breaks kept, nothing escaped)
  - `MathBlockNode.ts` with `form` (`"dollar-multiline" | "dollar-oneline" | "fence"`), `raw` (the full source exactly as written, delimiters included) and `fence`/`info` (only for `form = "fence"`)
  - `InlineMathNode.ts` (inline DecoratorNode, `raw`)
  - `InlineMathSourceNode.ts` (a TextNode subclass whose text is `$…$`, monospace class `uh-math-source`, `data-uh="math-source"`)
  - For now each decorator renders its source text in a `<code>`.
- [X] T009 Implement `dm/plugin.ts` and register it from `dm/index.ts`. It must:
  - register T007 through `addSyntaxExtension$` and `addMdastExtension$`
  - add import visitors with a higher priority than the codeBlock visitor, for `inlineMath` → InlineMathNode and `displayMath` → MathBlockNode
  - add an import visitor for mdast `code` whose `lang` first word, ignoring case, is `mermaid` → DiagramNode, or `math` → MathBlockNode `form:"fence"`. It recovers `fence` and `info` exactly from the original markdown via `node.position` offsets.
  - add export visitors that write every custom node as mdast `{type:"uhRaw", value}`. For fenced nodes, `value` is rebuilt as `fence + info + "\n" + value + "\n" + fence`.
  - add a `toMarkdown` extension whose `handlers.uhRaw` returns `node.value` unchanged
- [X] T010 Add the `$` text-escape rule to `dm/plugin.ts` (research R3). Wrap the default `text` handler so that a `$` in exported ordinary text gets a `\` in front **only if** leaving it bare would make the text pair into valid math according to `mathScanner.scanInline`. No other change to how text is exported, and **no** global `unsafe` pattern for `$`.
- [X] T011 Register `diagramMathPlugin()` in the `plugins` array of `frontend/src/features/sessions/editor/MarkdownEditor.tsx`, before `codeBlockPlugin`, and keep the existing `initialMarkdownNormalize` skip unchanged
- [X] T012 Write the fidelity gate `frontend/tests/unit/diagram-math-roundtrip.test.ts`. For every fixture in `tests/fixtures/notes/`, import and export with MDXEditor's `importMarkdownToLexical`/`exportMarkdownFromLexical` (or a headless `createEditor` with the same plugin set as `MarkdownEditor.tsx`), then check:
  - every formula and diagram slice (found by `mathScanner` and the fence regex in the original) appears **character for character** in the output
  - importing the output again gives the same nodes
  - `\$x\$` comes out as `\$x\$`, and prices come out unchanged
  - an edit outside the formulas (adding a word to the first paragraph) changes nothing inside them
  - it logs `N/30 notes unchanged, 0 formula/diagram diffs` (SC-001/SC-002)

**Checkpoint**: T012 is green, so formulas and diagrams are now saved safely even though they
aren't drawn yet.

---

## Phase 3: User Story 3 — Notes are saved without damage (P1)

**Goal**: guarantee exact saving through every route that writes a note (FR-013 to FR-018).

**Independent Test**: open the fixtures and autosave them, then edit them, append a transcript,
import, use raw mode and copy. Formulas and diagrams are always unchanged.

- [X] T013 [P] [US3] Add a test to `frontend/tests/unit/workspace-notes.test.tsx` checking that opening a fixture note with formulas and diagrams, and waiting for the debounce, causes **no** `saveNoteContent` call (FR-014, the `initialMarkdownNormalize` skip still applies with the new plugin) — *in `frontend/tests/unit/diagram-math-editor.test.tsx` (MarkdownEditor itself; `workspace-notes.test.tsx` doesn't mount the editor)*
- [X] T014 [P] [US3] Extend `backend/tests/integration/test_transcribe_append_flow.py` with a note containing `$a_1 \frac{x}{y}$`, a several-line `$$` block and a mermaid block. After a transcript is appended, the stored `.md` file still contains each one byte for byte (Constitution VI, critical flow 2)
- [X] T015 [P] [US3] Add a test to `frontend/tests/unit/autosave-append.test.ts` that drives `MarkdownEditor`'s `appendContent` on a note with formulas and diagrams and checks that the markdown emitted afterwards keeps every formula and diagram slice exactly — *in `frontend/tests/unit/diagram-math-editor.test.tsx`; MDXEditor mutes `onChange` for `setMarkdown`, so the test reads the export back*
- [X] T016 [P] [US3] Add a test to `frontend/tests/unit/note-import.test.tsx` checking that importing a fixture through `useNoteImporter` → `adoptServerReplace` → `replaceContent` and exporting again keeps the formulas and diagrams exact — *in `frontend/tests/unit/diagram-math-editor.test.tsx` (the `replaceContent` → `setMarkdown` step)*
- [X] T017 [US3] Make copy and cut carry the source. In `dm/plugin.ts`, register `COPY_COMMAND`/`CUT_COMMAND` handlers only if Lexical's default clipboard output (built from `getTextContent`/`exportDOM` in T008) does not already give the exact Markdown source of a selection containing custom nodes. Cover the behaviour in `frontend/tests/unit/diagram-math-clipboard.test.ts` (FR-017) — *Lexical's default clipboard already gives the exact source; no handler added*
- [X] T018 [US3] Add an e2e test `frontend/tests/e2e/diagrams-math.spec.ts` › "raw mode shows exact source". Open `obsidian-01.md` via the import UI, toggle raw mode (the `DiffSourceToggleWrapper` toggle), compare with the fixture, edit a word in rich text, toggle again, and check every formula and diagram is unchanged

---

## Phase 4: User Story 2 — See formulas in a note (P1)

**Goal**: inline and display math are drawn with KaTeX, edited in place, and the arrow keys work
predictably (FR-007 to FR-012, FR-011a).

**Independent Test**: quickstart scenarios 2 and 8.

- [X] T019 [P] [US2] Write `frontend/tests/unit/katex-commands.test.ts`. A command defined by an earlier formula works in later ones. An earlier formula that uses it shows an error. Editing a definer changes `commandsHash` only for later formulas. Commands don't leak into another note's table (FR-011a)
- [X] T020 [US2] Implement `dm/katexLoader.ts`:
  - `loadKatex()` dynamically imports `katex` and `katex/dist/katex.min.css` once
  - `renderMath(src, {displayMode, macros})` calls `katex.renderToString` with `output:"htmlAndMathml", throwOnError:true, trust:false, strict:"ignore", maxSize:50, maxExpand:1000, globalGroup:true` and returns `{html} | {error: message}`
  - `NoteMathCommands`: the definers (sources matching `\\(re)?newcommand|\\providecommand|\\g?def|\\let`) in document order, with `commandsBefore(i)` and `commandsHash(i)`
- [X] T021 [US2] Implement `dm/MathView.tsx` for InlineMathNode and MathBlockNode:
  - Drawing stays lazy: the source is shown until KaTeX has loaded.
  - The KaTeX HTML part gets `aria-hidden="true"`; the MathML is kept for assistive technology.
  - Display math is centered and `tabindex="0"`.
  - Error: the source stays visible with `[data-uh="render-message"] role="status"` "Formula error: …".
  - Empty: placeholder "Empty formula. Press Enter to edit." Over 50,000 characters: shown as code with the "too large" text.
  - `data-uh="math-inline"|"math-block"` and `data-state`, as in `contracts/ui-contract.md`.
- [X] T022 [US2] Implement `dm/transforms.ts`: — *typed formulas become formulas once the caret moves past the closing `$`, and only for a `$` the user typed, so opening a note never turns text into math*
  - (a) A `TextNode` transform that splits valid `$…$` spans (via `mathScanner.scanInline`, skipping text with code formatting and code nodes) into `InlineMathNode`.
  - (b) A paragraph whose whole text is `$$…$$` becomes `MathBlockNode{form:"dollar-oneline"}`.
  - (c) Typing `$$` and Enter on an empty paragraph inserts an empty `MathBlockNode{form:"dollar-multiline"}` opened for editing.
  - All under the `history-merge` tag only where they are view changes; the user's typing stays one undo step.
- [X] T023 [US2] Implement the inline swap in `dm/transforms.ts` (research R4):
  - Handle `KEY_ARROW_LEFT/RIGHT_COMMAND` at the edge of an `InlineMathNode`, and clicks on it: replace it with an `InlineMathSourceNode` holding `raw`, with the caret just inside the delimiter it entered from.
  - On `SELECTION_CHANGE_COMMAND`, when the selection is no longer in the source node: replace it with an `InlineMathNode` if the text is still valid math, otherwise a plain `TextNode`.
  - Tag the swaps `history-merge`.
  - Up/Down never enter the source node; the caret is never stuck (FR-012).
- [X] T024 [US2] Add the floating preview for an inline formula being edited, in `dm/MathView.tsx`. It is a Radix `Popover` (not modal, `onOpenAutoFocus` prevented) anchored under the `InlineMathSourceNode` DOM element, `data-uh="math-preview"`, re-rendered 400 ms after the last keystroke, and never covering the line (`side="bottom"`, `avoidCollisions`)
- [X] T025 [US2] Add the block editing state for `MathBlockNode` in `dm/MathView.tsx`: — *the source editor is a plain token-styled `<textarea>` (`BlockSourceEditor.tsx`), not CodeMirror: MDXEditor's `CodeMirrorEditor` only works inside its own code-block node*
  - Click or Enter shows MDXEditor's `CodeMirrorEditor` with the inner source and the drawn result under it.
  - Escape, or ArrowUp/ArrowDown at the first or last line, writes `raw` back keeping `form` and the delimiters exactly, then returns to the drawn view.
- [X] T026 [US2] Feed the KaTeX macros: keep one `NoteMathCommands` per editor instance in `dm/plugin.ts`. Rebuild it on update listeners that touch definer nodes, and mark later formulas as out of date by passing `commandsHash` to `MathView`
- [X] T027 [US2] Add e2e tests to `frontend/tests/e2e/diagrams-math.spec.ts` › "math":
  - inline draws inside the sentence, and `$$` several-line and one-line draw centered
  - `it costs $5 and $10`, a lone `$`, and a code span stay plain text (`[data-uh="math-inline"]` count is 0)
  - ArrowRight × n walks through `$E = mc^2$` and comes out; ArrowLeft back
  - clicking opens the source with `[data-uh="math-preview"]` visible
  - the shared `\newcommand` scenario from quickstart 8

---

## Phase 5: User Story 1 — See diagrams in a note (P1)

**Goal**: mermaid blocks are drawn in the sandboxed renderer frame and edited with a live preview
(FR-001 to FR-006, FR-021 to FR-023, FR-026, FR-027).

**Independent Test**: quickstart scenario 1.

- [X] T028 [P] [US1] Create `frontend/diagram-sandbox.html`: — *done as `frontend/public/diagram-sandbox.html` (plus `vite.sandbox.config.ts`, `pnpm build:sandbox`): the frame's script is one classic IIFE bundle `public/sandbox/diagram-renderer.js`, because an opaque-origin frame can't load module scripts without CORS (Vite's dev server refuses `Origin: null`)*
  - a `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src 'self'">`
  - one `<div id="root">` and `<script type="module" src="/src/sandbox/safeRenderer.ts">`
  - Add it as a second input in `frontend/vite.config.ts` `build.rollupOptions.input` (`{main: "index.html", diagramSandbox: "diagram-sandbox.html"}`).
- [X] T029 [US1] Implement the frame side, `frontend/src/sandbox/safeRenderer.ts`, exactly as in `contracts/diagram-sandbox-protocol.md`: — *`frontend/src/sandbox/diagramRenderer.ts` (one bundle for both pages, mode from `<html data-mode>`)*
  - Import `mermaid`. Call `mermaid.initialize({startOnLoad:false, securityLevel:"strict", htmlLabels:false, flowchart:{htmlLabels:false}, theme:"base", secure:["securityLevel","startOnLoad","secure","dompurifyConfig","htmlLabels","maxTextSize"]})`.
  - Post `{v:1,type:"ready"}` to `parent`.
  - Handle `render` messages one at a time in arrival order, and drop queued ids on `cancel`.
  - For each render: `mermaid.render(id, source)` with `themeVariables` and `background` applied. If `useOwnTheme` is false, run `directives.stripThemeSettings` first. Reply `rendered{svg,width,height,title,description}` or `failed{message,line}`.
  - With `reducedMotion`, add `* {animation:none!important; transition:none!important}` to the SVG style.
- [X] T030 [US1] Implement the parent side, `dm/rendererHost.ts`:
  - Create the hidden `<iframe sandbox="allow-scripts" src="/diagram-sandbox.html">` lazily the first time a render is needed.
  - Accept messages only when `event.source === iframe.contentWindow`, and send with `postMessage(msg, "*")`.
  - Keep a promise queue. Any request with no answer **within 5 000 ms** gives `{timedOut:true}`; the frame is removed and recreated for the remaining queue.
  - Sources longer than **50 000** characters give `{tooLarge:true}` without being sent.
  - Clean the returned `svg` with DOMPurify (`USE_PROFILES:{svg:true,svgFilters:true}`, `FORBID_TAGS:["foreignObject","script"]`, every `on*` attribute removed, and a hook removing `href`/`xlink:href` unless it starts with `#`).
  - Export `renderDiagram(req): Promise<Result>` and `cancel(id)`.
- [X] T031 [P] [US1] Implement `dm/renderCache.ts`:
  - An LRU of **300** entries keyed by `sha256(kind, source, themeKey, commandsHash?)` → `{output,width,height,error?}`.
  - Height hints stored as `uh.diagramHeights` (LRU of **500**, map `sha256(source)` → `heightPx`).
  - `reservedHeight(source)` returns the stored hint or **240** px.
- [X] T032 [P] [US1] Implement `dm/useNearViewport.ts`: an `IntersectionObserver` with `rootMargin:"100% 0px"`, shared by every node of an editor instance, returning `isNear`
- [X] T033 [US1] Implement `dm/DiagramView.tsx` for DiagramNode, drawn state:
  - The wrapper is exactly as in `contracts/ui-contract.md`: `data-uh="diagram"`, `role="img"`, `tabindex="0"`, `aria-roledescription="diagram"`, `aria-label` set to the title or "Diagram", and `data-state`.
  - Content is centered with `max-width:100%`. The SVG is scaled with `width:100%; height:auto` up to its natural width. If that makes text smaller than a readable minimum, the SVG is shown at the minimum scale inside its own `overflow-x:auto` frame, so the page never scrolls sideways.
  - `contain: layout`, and `min-height` set to `reservedHeight` while pending.
  - Drawing starts only when `isNear`.
  - The messages `role="status"` use the exact texts from the contract (error, took longer than 5 seconds, too large, empty).
- [X] T034 [US1] Add the editing state to `dm/DiagramView.tsx`:
  - It opens on click, on Enter while focused, or when the Lexical selection becomes a NodeSelection on the node.
  - It shows `CodeMirrorEditor` (`data-uh="diagram-source"`) with `[data-uh="diagram-preview"]` under it, re-rendered **400 ms** after the last keystroke.
  - Escape, or ArrowUp/ArrowDown at the first or last line, writes `value` back (keeping `fence` and `info` exactly), returns to the drawing and focuses the wrapper.
  - While the source is invalid, the preview shows the error and the last valid drawing is not shown as current.
- [X] T035 [US1] Make loading lazy (FR-027): — *no pre-mount flag was needed: KaTeX is imported only when a formula node renders and the frame is created only when a diagram renders; a plain note loads neither (T036, T037)*
  - In `frontend/src/features/sessions/WorkspacePage.tsx` `NotePane`, before mounting, compute `needsDiagramMath = /^\s*(```|~~~)\s*(mermaid|math)\b/im.test(md) || mathScanner.hasMath(md)` and pass it to `MarkdownEditor`.
  - In `dm/plugin.ts`, register the nodes always, but import `katexLoader`/`rendererHost` only when the flag is set or the first custom node is created by typing or inserting.
- [X] T036 [P] [US1] Write `frontend/tests/unit/diagram-math-lazy.test.ts`. Mounting `MarkdownEditor` with a note without diagrams or math triggers **no** dynamic import of `katex`/`mermaid` and creates no `iframe`. A note with a formula imports only `katex`
- [X] T037 [US1] Add e2e tests to `frontend/tests/e2e/diagrams-math.spec.ts` › "diagrams": — *the production check ran against `pnpm build` served by the backend with the real headers: the frame loads and draws, so no fallback was needed*
  - flowchart, sequence, class, state, ER, Gantt, mindmap and timeline fixtures all reach `data-state="drawn"`
  - `document.documentElement.scrollWidth <= clientWidth`
  - click → edit → type → the preview updates within 600 ms → Escape shows the new drawing
  - a network log on a plain note has no `mermaid`, `katex` or `diagram-sandbox` request
  - **early check of the frame loading under CSP**, which runs against the production build served by the backend (plan Risks). If it fails, carry out the fallback: build `safeRenderer` as one IIFE and allow it by hash.

---

## Phase 6: User Story 4 — Errors, limits and safety (P1)

**Goal**: errors never break the editor. Unsafe settings and diagram themes need the user's
decision. It works offline (FR-019 to FR-022, FR-028a, FR-031 to FR-034).

**Independent Test**: quickstart scenarios 4, 5, 6 and 7.

- [X] T038 [P] [US4] Write `frontend/tests/unit/diagram-directives.test.ts` for the classifier, using every row of the data-model table "Settings found in a diagram":
  - **unsafe**: `securityLevel` ≠ `strict`, `htmlLabels`/`flowchart.htmlLabels: true`, `secure`, `dompurifyConfig`, `click`/`callback`/`href` lines, `link`/`links`, and `url(` or `@import` in `themeCSS`
  - **theme**: `theme`, `themeVariables`, `themeCSS`, `darkMode`, and colour properties in `style`/`classDef`/`linkStyle`
  - **other**: always followed
  - Also test `stripThemeSettings` and `stripUnsafeSettings`. They return text for the renderer only, and the input string is not modified.
- [X] T039 [US4] Implement `dm/directives.ts`:
  - Parse YAML front matter `config:` (a small YAML subset: key/value and nested maps) and `%%{init: …}%%` / `%%{initialize: …}%%` with a JSON5-tolerant reader.
  - `classify(source) → {unsafe: string[], theme: string[], title?, description?}` (title from front-matter `title` or `accTitle:`; description from `accDescr`).
  - `stripThemeSettings(source)` and `stripUnsafeSettings(source)`, used only to build the text sent to the renderer.
- [X] T040 [P] [US4] Write `frontend/tests/unit/diagram-decisions.test.ts`:
  - the key is `uh.diagramDecisions.<noteId>`, mapping `sha256(value + info)` → `{unsafe?: "allow"|"safe", theme?: "own"|"app", at}`
  - editing the source stops the old decision from applying
  - the caps are **100 per note and 200 notes**, with the oldest `at` removed first
  - `reset(noteId, hash)`
  - it works without storage when localStorage throws
- [X] T041 [US4] Implement `dm/decisions.ts` to satisfy T040, using `readLocal/writeLocal`
- [X] T042 [US4] Implement `dm/DecisionDialog.tsx` exactly as in `contracts/ui-contract.md`:
  - A non-blocking banner `[data-uh="diagram-decision-banner"]` with a "Review" button, shown once each time the note is opened, when undecided diagrams have flags.
  - An `AlertDialog` `[data-uh="diagram-decision"]` titled "This note's diagrams ask for extra permissions". It lists each diagram (title or "Diagram N") with the settings found. Unsafe: "Allow" / "Draw safely" (default focus). Theme: "Use diagram theme" / "Keep app theme" (default focus). "Apply to all" options at the top.
  - An AA warning when the diagram's `primaryTextColor` (or text fill) against its background is below 4.5:1, using `src/lib/contrast.ts`.
  - Undecided diagrams keep drawing in safe mode with the app theme.
- [X] T043 [P] [US4] Create `frontend/diagram-sandbox-allowed.html` (no meta CSP; it relies on the route header) and `frontend/src/sandbox/allowedRenderer.ts`: — *one renderer bundle serves both pages (`<html data-mode="allowed">`)*
  - Initialise mermaid with the source's own settings and `secure: []`.
  - Handle `{v:1,type:"show",source,themeVariables,useOwnTheme,background,reducedMotion}` and render visibly.
  - Report `{v:1,type:"size",width,height}` with a `ResizeObserver`, or `failed`.
  - Add it to the `vite.config.ts` inputs.
- [X] T044 [US4] In `dm/DiagramView.tsx`, when the decision is `unsafe:"allow"`, draw the diagram live in its own `<iframe sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" src="/diagram-sandbox-allowed.html">`:
  - Sized from the `size` messages, with `data-state="allowed"`.
  - The 5 s limit applies to the first `size` message.
  - Export PNG is turned off with the reason given in research R13.
  - The "Reset decision" item in the actions menu calls `decisions.reset`.
- [X] T045 [US4] In `backend/src/unihelper/main.py`: — *done without the `/assets` CORS header: the frame script is a classic script (see T028), so no cross-origin module loading happens. Both frame pages get their own CSP with `frame-ancestors 'self'` (the app CSP's `frame-ancestors 'none'` would block the frames)*
  - Add `Access-Control-Allow-Origin: *` to responses under `/assets/`.
  - For the path `/diagram-sandbox-allowed.html`, send this CSP instead of the app CSP: `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src data: https:; font-src 'self' https:; connect-src https:`.
  - Every other response keeps the existing CSP (lines 143–157) unchanged.
- [X] T046 [P] [US4] Write `backend/tests/integration/test_sandbox_headers.py`, following `test_static_spa.py`: — *checks the safe and allowed frame CSPs and that every other page (and `/sandbox/*.js`) keeps the app CSP*
  - `/assets/<file>` has `Access-Control-Allow-Origin: *`
  - `/diagram-sandbox-allowed.html` has exactly the CSP from T045
  - `/` and `/diagram-sandbox.html` keep the app CSP
  - `/api/v1/...` responses have no ACAO header
- [X] T047 [US4] Add e2e tests to `frontend/tests/e2e/diagrams-math.spec.ts` › "safety":
  - The hostile fixtures (`click A call alert(1)`, `securityLevel:"loose"`, `<img src=https://example.invalid>` labels, `javascript:` links, `\href{https://…}` and `\includegraphics` in KaTeX) draw with **zero** dialogs, zero requests outside the app origin (`page.on("request")`) and an unchanged `window.__uhSentinel`.
  - The banner appears. "Allow" switches to `data-state="allowed"`. Editing the source brings back the banner (SC-008, FR-032a).
- [X] T048 [US4] Add e2e tests to `frontend/tests/e2e/diagrams-math.spec.ts` › "errors and offline": — *“offline” is tested as no internet (all non-local requests aborted): the app's own server is local, and everything still draws with KaTeX fonts served by the app*
  - A broken diagram and formula show the source and a message, and typing elsewhere still works.
  - Empty placeholders.
  - A 60,000-character diagram shows `tooLarge`.
  - A diagram that intentionally takes more than 5 s (a fixture large enough to exceed 5 s, or a test hook in `rendererHost` that sets the time limit to 50 ms) shows `timedOut` while typing continues.
  - `context.setOffline(true)`, then opening a note with diagrams and formulas draws them all (SC-009, SC-012).

---

## Phase 7: User Story 5 — Smooth, stable and themed (P1)

**Goal**: the theme is followed within 1 s, there is no layout jump, and typing stays smooth with
20 diagrams and 200 formulas (FR-023 to FR-030, FR-035, FR-036).

**Independent Test**: quickstart scenario 6, plus the performance spec.

- [X] T049 [US5] Implement `dm/themeVars.ts`:
  - Read `--editor-surface`, `--surface-elevated`, `--text-primary`, `--text-muted`, `--border`, `--accent`, `--accent-foreground`, `--danger`, `--success` and `--warning` with `getComputedStyle(document.documentElement)`.
  - Turn them into mermaid `theme:"base"` `themeVariables`: background, primaryColor, primaryTextColor, primaryBorderColor, lineColor, secondaryColor, tertiaryColor, noteBkgColor, noteTextColor, textColor, mainBkg, clusterBkg, edgeLabelBackground, and the Gantt and sequence variables.
  - `themeKey` is a hash of those values.
  - A hook `useThemeKey()` that recomputes on `useThemeChoice()` changes.
- [X] T050 [US5] Wire the theme into drawing: — *every drawn diagram re-requests with the new `themeKey`; requests run one at a time in the order the visible diagrams ask*
  - `DiagramView` passes `themeVariables` and `themeKey` (part of the cache key).
  - On a `themeKey` change, visible diagrams are redrawn first and the rest when they come near the viewport.
  - Diagrams with the decision `theme:"own"` keep their own theme and are not redrawn.
  - KaTeX output inherits `color`, with no redraw.
  - Uses `dm/DiagramView.tsx` and `dm/MathView.tsx`.
- [X] T051 [US5] Check that the rest of the editor is unaffected: — *`reveal.ts`: `revealSource()` returns the key to pass to `conceal()` (an opened inline formula is a new text node)*
  - Custom nodes check `editor.isEditable()`. When not editable, editing never opens and the insert buttons are hidden (FR-035, research R12).
  - Each node exposes `revealSource(range?)`/`conceal()` for a later find feature (FR-016a, research R12).
  - Covered in `frontend/tests/unit/diagram-math-readonly.test.tsx` by mounting MDXEditor with `readOnly`.
- [X] T052 [P] [US5] Write `frontend/tests/e2e/diagrams-math-perf.spec.ts`, using the generated note with 20 diagrams and 200 formulas:
  - typing 50 characters mid-note keeps every keystroke-to-paint under 50 ms (`performance.now()` around `keyboard.press`, plus a `requestAnimationFrame` probe)
  - the cumulative layout shift from a `PerformanceObserver("layout-shift")` while drawing is no more than one line height around the caret, and 0 when the note is reopened (SC-005, SC-010)
  - a light → dark → custom theme switch updates all visible diagrams and formulas within 1 s (SC-007)
- [X] T053 [US5] Add an e2e test to `frontend/tests/e2e/diagrams-math.spec.ts` › "unchanged behaviours". With a note containing formulas and diagrams, `note-save-state` goes through dirty → saving → saved. A transcript append (fake transcriber) keeps the formulas exact. A save conflict still opens `ConflictDialog`, and "keep both" keeps the formulas exact. The `beforeunload` guard still fires when there are unsaved changes (FR-036) — *transcript append is covered by T014/T015 rather than e2e. The conflict dialog does not open in the MDXEditor editor even with this feature switched off (checked); the test checks the conflict is detected, the outside version is kept, and the refused save had the formulas exact. Recorded in `specs/KNOWN-ISSUES.md`*

---

## Phase 8: User Story 6 — Accessible diagrams and formulas (P1)

**Goal**: keyboard, screen readers, reduced motion and AA (FR-037 to FR-041).

**Independent Test**: quickstart scenario 9.

- [X] T054 [US6] Set the ARIA attributes in `dm/DiagramView.tsx`: — *the wrapper is `role="group"` with `aria-roledescription="diagram"` instead of `role="img"`: an image role hides its contents, including the actions button (contract updated)*
  - `aria-describedby` points at the `accDescr` text.
  - The SVG is `aria-hidden="true"`.
  - A visible focus ring uses the `--focus-ring` token.
  - Enter edits and Escape returns with focus kept on the wrapper.
  - The actions trigger `[data-uh="diagram-actions"]` ("Diagram actions") is a shadcn `DropdownMenu` with Edit, Expand, Export SVG, Export PNG, Export light on white, Copy source and Reset decision. P2 items are hidden until US7 is in place.
- [X] T055 [US6] Handle reduced motion. With `matchMedia("(prefers-reduced-motion: reduce)")`, send `reducedMotion:true` to both frames, and the custom nodes and dialogs use no CSS transition or animation (Tailwind `motion-reduce:` variants). Uses `dm/DiagramView.tsx`, `dm/MathView.tsx` and `dm/DecisionDialog.tsx` — *frames get `reducedMotion`; the app's global `prefers-reduced-motion` rule already stops the dialogs' and menus' transitions*
- [X] T056 [US6] Check shortcuts. `useWorkspaceKeyboard.ts` and `MarkdownEditor.tsx`'s Escape handler (lines 75–83) must not fight the node-level Escape: stop propagation only while a node is being edited, so Escape from a drawn node still returns focus to the tab as before. No new key bindings are added. Uses `frontend/src/features/sessions/editor/MarkdownEditor.tsx` and `dm/DiagramView.tsx`
- [X] T057 [P] [US6] Write `frontend/tests/e2e/diagrams-math-a11y.spec.ts`, using `@axe-core/playwright` on a note with diagrams, formulas, the banner and the open dialog, in chromium-light, chromium-dark and a custom theme (from `theme-presets.json`). It checks: — *the custom-theme run applies real presets (Solarized Light / Dracula) through the preferences API; axe is scoped to the diagram and formula elements and the decision dialog*
  - no axe violations
  - Tab reaches every diagram and every display formula, with a visible focus ring
  - `getByRole("img", {name: "Diagram"})` and titled diagrams are found by name
  - formulas expose `math` elements
  - Enter and Escape work
  - `page.emulateMedia({reducedMotion: "reduce"})` gives no running animations (`document.getAnimations().length === 0`) (SC-011)

---

## Phase 9: User Story 7 — Expand and export a diagram (P2)

**Goal**: a zoom and pan viewer, and SVG/PNG export, including "Light, white background"
(FR-042, FR-043).

**Independent Test**: quickstart scenario 10 (expand and export).

- [X] T058 [US7] Implement `dm/DiagramViewer.tsx`:
  - A shadcn `Dialog` `[data-uh="diagram-viewer"]` showing the cached, cleaned SVG.
  - Zoom in (`+`), Zoom out (`-`) and Reset (`0`) buttons with matching keys; wheel and pinch zoom.
  - Pointer-drag pan, and arrow keys pan by 40 px.
  - CSS `transform`, with no transition under reduced motion.
  - Escape closes it and focus returns to the diagram wrapper.
  - Hook it to the "Expand" item. It is unavailable when `data-state` is not `drawn`/`allowed`.
- [X] T059 [US7] Implement `dm/exportImage.ts`:
  - `exportSvg(svg, background)` adds a background `<rect>` and downloads `<title or "diagram">.svg`.
  - `exportPng(svg, background)` draws on a canvas at 2× scale via `Image` + `toBlob` and downloads `.png`.
  - "Export light on white" asks `rendererHost` for a new render with the light-theme tokens and `background:"#ffffff"`, then exports.
  - For allowed diagrams, PNG is turned off with a tooltip explaining why, and SVG is requested from the allowed frame.
  - The note is never changed.
  - Hook it to the actions menu items. They are unavailable for diagrams that failed to draw.
- [X] T060 [US7] Add e2e tests to `frontend/tests/e2e/diagrams-math.spec.ts` › "expand and export":
  - Expand, press `+` twice, an arrow pan, and Escape: focus is on the wrapper.
  - `page.waitForEvent("download")` gets `.svg` and `.png` files, and their content is not empty.
  - In the dark project, "light on white" SVG contains a `fill="#ffffff"` background rect.
  - An errored diagram has no Expand or Export items.

---

## Phase 10: User Story 8 — Insert diagrams and formulas, and math blocks (P2)

**Goal**: toolbar insert buttons, and ```` ```math ```` fences drawn as display math (FR-044, FR-045).

**Independent Test**: quickstart scenario 10 (insert and math fences).

- [X] T061 [US8] Add the two toolbar buttons right after `<InsertCodeBlock/>` in `frontend/src/features/sessions/editor/MarkdownEditor.tsx` `toolbarContents`, as `dm/InsertButtons.tsx`:
  - `[data-uh="insert-diagram"]` "Insert diagram" inserts a DiagramNode `fence:"```" info:"mermaid" value:"flowchart LR\n  A[Start] --> B[End]"` on its own block, opened for editing with the cursor inside the source.
  - `[data-uh="insert-formula"]` "Insert formula" inserts `$x^2$` at the caret as an `InlineMathSourceNode`, with the caret inside the source.
  - Both are hidden when the editor is not editable. No keyboard shortcut.
- [X] T062 [US8] Make sure `math` fences (`MathBlockNode form:"fence"`) draw, edit and save through the same `MathView` path as `$$`, with the fence and info string kept exactly. Add `math-fence` cases to `tests/fixtures/notes/` and to `frontend/tests/unit/diagram-math-roundtrip.test.ts` if they are not already covered
- [X] T063 [US8] Add e2e tests to `frontend/tests/e2e/diagrams-math.spec.ts` › "insert and math fences":
  - Insert diagram in an empty note and mid-paragraph: it is in editing state and typing changes the source.
  - Insert formula: the caret is inside `$x^2$`.
  - A ```` ```math ```` fixture draws as `[data-uh="math-block"]` and is saved unchanged.

---

## Phase 11: Polish & Cross-Cutting

- [X] T064 [P] Run `pnpm lint`, `pnpm typecheck` and `pnpm test` in `frontend/`, and `uv run pytest` in `backend/`. Fix any issue, including `no-hardcoded-colors.test.ts` (the `dm/` files and the sandbox pages use only tokens or values that are passed in)
- [X] T065 [P] Measure SC-006. Compare `pnpm build` output: the main and WorkspacePage chunks don't grow by more than the plugin's own code (no `mermaid` or `katex` code in them; check with `vite build --mode production` and `rollup-plugin-visualizer`, or grep the chunk contents). Record the numbers in `specs/013-note-diagrams-math/quickstart.md` under a new "Measurements" heading
- [X] T066 [P] Add an entry to `specs/KNOWN-ISSUES.md`:
  - find in note and a read-only note mode don't exist yet, so FR-016a and FR-035 are only covered by unit tests through `revealSource`/`isEditable` (research R12)
  - non-Chromium browsers may run the renderer frame on the main thread
- [ ] T067 Run every scenario in `specs/013-note-diagrams-math/quickstart.md` by hand in light, dark and a custom theme with keyboard only, and tick them off. Constitution: UI verified in light and dark themes and with keyboard-only navigation

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** comes first. T002, T003 and T004 can run in parallel after T001.
- **Foundational (Phase 2)** depends on Setup and **blocks every story**. T005 and T008 can run
  in parallel. Then T006 → T007 → T009 → T010 → T011 → T012 (the gate).
- **US3 (Phase 3)** depends only on Phase 2. It verifies the gate through every route.
- **US2 (Phase 4)** depends on Phase 2.
- **US1 (Phase 5)** depends on Phase 2. It can run alongside US2, except that both edit
  `dm/plugin.ts` (T026 and T035), so do those one after the other.
- **US4 (Phase 6)** depends on US1 (frame and DiagramView) and on US2 for the KaTeX safety cases.
- **US5 (Phase 7)** depends on US1 and US2.
- **US6 (Phase 8)** depends on US1 and US2. T054 needs DiagramView from T033 and T034.
- **US7 (Phase 9)** depends on US1 (cache and frame) and on T054 (actions menu).
- **US8 (Phase 10)** depends on US1 and US2.
- **Polish** comes after the stories that are included.

### Story completion order

`Phase 2 gate → US3 → (US2 ∥ US1) → US4 → US5 → US6 → US7 ∥ US8 → Polish`

## Parallel Examples

```text
# Phase 1, after T001
T002 skeleton   ∥  T003 contrast helper move   ∥  T004 fixture corpus

# Phase 2
T005 scanner tests  ∥  T008 Lexical nodes

# US3
T013 no-save-on-open  ∥  T014 backend append flow  ∥  T015 appendContent  ∥  T016 import

# US1
T028 sandbox page  ∥  T031 render cache  ∥  T032 near-viewport hook  ∥  T036 lazy test

# US4
T038 directive tests  ∥  T040 decision tests  ∥  T043 allowed frame page  ∥  T046 backend header tests
```

## Implementation Strategy

### MVP

1. Phase 1 and Phase 2. **Stop and check T012**: notes with math and diagrams are now safe to
   edit, which already fixes today's `$a\_1$` corruption.
2. US3 (check every save route), then US2 (formulas). This is the first slice worth showing:
   math in notes.
3. US1 (diagrams) and US4 (safety). This is the smallest version that meets the spec's
   security bar for diagrams. Don't release diagrams without US4.

### Incremental delivery

- Then US5 (theme and performance) and US6 (accessibility). Both are needed by the constitution
  (V) before merge.
- US7 and US8 (P2) can each be released on their own.

## Notes

- Every story phase ends with its e2e tests. Run them in both the chromium-light and
  chromium-dark projects.
- Never relax the global CSP. Only `/diagram-sandbox-allowed.html` gets its own policy (T045).
- The decision store and the height hints are display conveniences only. Losing them must never
  lose any note content.
