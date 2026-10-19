# Research: Diagrams and Math in Notes

**Feature**: 013-note-diagrams-math | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

## Findings about the current editor (baseline)

These facts come from the code as it is today. Several decisions below depend on them.

- The note editor is `@mdxeditor/editor` 4.3.2, which is built on Lexical. It lives in
  `frontend/src/features/sessions/editor/MarkdownEditor.tsx` and is used only by `NotePane` in
  `WorkspacePage.tsx`, which has two split panes. The plugins are headings, lists, quote,
  thematicBreak, link, linkDialog, image, table, `codeBlockPlugin`, `codeMirrorPlugin` (with no
  mermaid or math language), `markdownShortcutPlugin`, `diffSourcePlugin` (which is raw mode) and
  `toolbarPlugin`. There are no custom nodes, visitors or mdast extensions.
- Markdown leaves the editor through `onChange`. The first emission, which only normalises the
  note, is skipped (`initialMarkdownNormalize`). After that, every emission goes to
  `NoteSaver.update`. Saving is skipped only when the content is exactly equal to what was last
  saved (`autosave.ts`). Once the user edits anything, MDXEditor's normalisation of the whole
  note reaches disk. The spec accepts this for ordinary text ("saved exactly as it is today").
  It is not acceptable inside formulas and diagrams: today `$a_1$` is saved as `$a\_1$`.
- `appendContent` (transcripts) runs `setMarkdown(getMarkdown() + text)`, so the whole note is
  exported and imported again on every append.
- **Find in note does not exist.** CodeMirror's search was removed when the editor switched to
  MDXEditor (commit 9744665). **There is no read-only mode for notes.** MDXEditor supports a
  `readOnly` prop, but nothing in the app sets it.
- Themes: `data-theme="light|dark"` on `<html>`. Custom themes set their colours as inline CSS
  variables on `<html>`. Components can watch the theme with `useResolvedTheme()` and
  `useThemeChoice()` in `src/app/theme.tsx`. The tokens are in `src/styles/tokens.css`.
- CSP (`backend/src/unihelper/main.py:143-157`): `default-src 'self'; script-src 'self'
  'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; style-src 'self'
  'unsafe-inline'; object-src 'none'`. Fonts and frames fall back to `default-src 'self'`.
- Lazy loading: `WorkspacePage` is already a separate lazily loaded chunk. The PDF engine shows the
  pattern for bundled assets: `?url` imports, no CDN, and fonts are not fetched from outside.
- The notes e2e helpers still point at `.cm-content`, so they are broken (`specs/KNOWN-ISSUES.md`).
  The new e2e tests for this feature use MDXEditor selectors and do not depend on those helpers.

## R1 — Libraries

- **Decision**: Use `mermaid` pinned to exactly **12.1.0**, `katex` pinned to exactly
  **0.19.0**, and `dompurify` pinned to an exact version at least 14 days old when it is
  installed. Mermaid already depends on DOMPurify, so it is added as a direct dependency only so
  the version is pinned.
- **Rationale**: Mermaid is the syntax the spec names. KaTeX is fast and synchronous, its output
  includes MathML, and it does not need the network. Both are what GitHub, Obsidian and VS Code
  use or match, so notes look the same there (FR-018). Each pin is the newest release that is at
  least two weeks old. Mermaid 12.2.0 is 6 days old, so it is skipped to lower supply-chain risk.
- **Alternatives considered**: MathJax 3. Its output and accessibility are better, but it is about
  3× larger and slower to run on 200 formulas. Its macro behaviour matches Obsidian, but KaTeX's
  `globalGroup` with shared macros covers that need (R7). Rendering on the server was rejected:
  it needs a new service (Constitution VII), and the feature has to work offline.

## R2 — Keeping source text exact through MDXEditor's export

- **Decision**: Add a custom MDXEditor realm plugin, `diagramMathPlugin`, that registers:
  1. A **micromark syntax extension** (`uhMath`) written for this project that recognises math
     exactly as the spec's rule describes (see contracts/markdown-syntax.md). It also includes an
     mdast-from-markdown extension that creates `inlineMath` and `displayMath` nodes holding the
     **raw source slice**, delimiters included, taken from the token's offsets.
  2. **Import visitors** that turn `inlineMath`, `displayMath`, and `code` nodes whose first info
     word is `mermaid` or `math` (case-insensitive) into custom Lexical nodes. For fenced blocks
     the node stores `{fence, info, value}`: the opening fence characters and their count
     exactly, the info string exactly, and the body exactly.
  3. **Export visitors** that write these nodes as an mdast node of a custom type, `uhRaw`. A
     `toMarkdown` handler for `uhRaw` returns the stored text **unchanged**. mdast-util-to-markdown
     does not escape what a handler returns. Container prefixes such as list indentation and `> `
     are still added by the parent container handlers, the same way as for code blocks today.
- **Rationale**: This is the only place where the exact text survives the trip through Lexical.
  Each formula and diagram becomes a node that cannot be broken into parts and holds its own
  source, so MDXEditor's text escaping (`_`, `*`, `\`, `[`) can never touch it (FR-013). Rebuilding
  fences from `{fence, info, value}` keeps `~~~`, four-backtick fences and info strings such as
  `mermaid title`. Without this, the codeBlock exporter would turn them all into a plain ```` ``` ````
  fence.
- **Found during implementation**:
  - MDXEditor's import visitors only see the mdast tree, not the source text. So the exact fence
    lines, the fence's own indentation (`linePrefix` tokens) and the content prefixes are
    recorded on the mdast node while parsing (`uhMathFromMarkdown`, `fencedRaw`).
  - Tables keep their parsed mdast, so `inlineMath`/`displayMath` also get `toMarkdown` handlers
    that write `raw`.
  - **An unclosed fence is saved closed.** A closing fence that matches the opening one is added
    on export. Otherwise anything placed after it, such as a new paragraph or an appended
    transcript (`appendContent` runs `getMarkdown() + text`), would end up inside the diagram
    when the note is opened again. The diagram's source itself is unchanged.
  - MDXEditor trims whitespace at the very end of a note (`markdown$` is `.trim()`med). That is
    existing behaviour. It only removes trailing spaces after a closing `$$` or fence when the
    block is the last line of the note.
- **Alternatives considered**: (a) Using MDXEditor's `codeBlockEditorDescriptors` for mermaid. The
  editing UI would be easy, but exporting goes through CodeBlockNode, which changes the fences.
  Rejected. (b) `micromark-extension-math` with `mdast-util-math`. Its inline rule turns `$5 and $`
  into math, and its `toMarkdown` adds an "unsafe" pattern that escapes every `$` in ordinary text.
  That would be new rewriting (FR-015). Rejected. (c) Going back to CodeMirror's live preview
  (spec 002's N1). That is the most faithful option, but it means replacing the editor again,
  which is out of scope.

## R3 — Dollar signs in ordinary text

- **Decision**: Don't add a global "unsafe" pattern for `$`. Use a custom `text` handler instead.
  When text is exported, a `$` gets a backslash added in front of it **only if** leaving it bare
  would make that text a valid formula when the note is opened again.
- **Rationale**: A Lexical transform (R5) turns valid `$…$` pairs into math nodes as soon as they
  are typed. So any pairable `$` still left in a text node came from a `\$` escape in the
  original file. Adding the backslash back restores what the user wrote. Without it, `\$x\$`
  would be saved as `$x$` and appear as a formula the next time the note opens. Prices and lone
  dollar signs never form a pair, so they keep being saved exactly as today (FR-015).
- **Alternatives considered**: Escaping every `$`. That changes ordinary text and was rejected.
  Doing nothing breaks escaped dollars and was rejected.

## R4 — Lexical nodes and editing behaviour

- **Decision**:
  - `DiagramNode` and `MathBlockNode` (for `$$` and `math` fences) are block `DecoratorNode`s. The
    decorator component has two states: *drawn*, and *editing* (a source editor with a live
    preview under it). Editing opens on click, on Enter while the node is focused, or when the
    selection becomes a NodeSelection on the node after an arrow key moves into it. Escape, or
    the arrow keys at the first or last line of the source, close it again.
  - `InlineMathNode` is an inline `DecoratorNode` and is shown drawn. When the caret moves onto it
    (an arrow key at its edge, or a click), it is swapped for an `InlineMathSourceNode`: a
    `TextNode` subclass whose text is `$…$`, shown in monospace. The caret is placed just inside
    the delimiter it entered from, and a floating preview is shown under it (clarification Q3).
    When the selection leaves, the node is swapped back to `InlineMathNode`. If the text is no
    longer valid math, it becomes ordinary text. `InlineMathSourceNode` exports as `uhRaw` with
    its text unchanged.
  - Both swaps run with the `history-merge` tag, so undo steps through the user's actual edits and
    not through these view changes. Moving with the arrow keys therefore works character by
    character through the source and can never get stuck (FR-012).
  - The source editor for a block is a token-styled `<textarea>` (`BlockSourceEditor.tsx`).
    MDXEditor's `CodeMirrorEditor` only works inside MDXEditor's own code-block node. Keys typed
    there are kept from the note editor (a `KEY_DOWN_COMMAND` handler at critical priority).
- **Rationale**: Lexical treats a decorator node as one atomic piece. Swapping it for a text node
  is the standard way to get the Typora/Obsidian behaviour where the caret walks into the source.
  The source node exports unchanged, so saving while the user is mid-edit is still exact.
- **Alternatives considered**: Putting a nested editor inside the decorator for inline math.
  Moving the focus in and out of a nested editor confuses screen readers and makes arrow-key
  movement unpredictable, so it was rejected.

## R5 — Recognising math as it is typed

- **Decision**: Register a Lexical node transform on `TextNode` that runs the same recogniser as
  the micromark extension (shared module `mathScanner.ts`). Whenever a text node contains a valid
  `$…$` span outside code formatting, that span is split out into an `InlineMathNode`. The
  transform never runs inside a code node or on text with code formatting. A paragraph whose
  whole text is `$$…$$` becomes a `MathBlockNode`. Typing `$$` and Enter on an empty line inserts
  an empty `MathBlockNode` already open for editing.
- **Rationale**: Typed math and opened math then follow one rule (FR-009). The scanner is a pure
  function, so it can be unit-tested against every example in the spec.

## R6 — Drawing diagrams: a sandboxed renderer frame

- **Decision**: Mermaid runs **inside a sandboxed `<iframe>`** that loads a separate built page,
  `diagram-sandbox.html` (`sandbox="allow-scripts"`, **without** `allow-same-origin`, so it has an
  opaque origin). That page has its own strict CSP in a `<meta>` tag: `default-src 'none';
  script-src 'self'; style-src 'unsafe-inline'; img-src data:; font-src 'self'`. The editor talks
  to it by `postMessage` (contracts/diagram-sandbox-protocol.md). The frame returns an SVG
  string. The editor runs it through DOMPurify (SVG profile, no `foreignObject`, no event
  attributes, no `href` except `#…`) and then inserts it inline.
  - **Time limit (FR-021)**: if a render has not answered within 5 s, the editor **removes the
    frame**, which ends its work, and makes a new one. The diagram falls back to plain code with
    a "took too long" message.
  - **Size limit (FR-022)**: a source longer than 50,000 characters is never sent to the frame.
  - **Never blocking typing (FR-026)**: Chromium puts sandboxed opaque-origin frames in a
    separate process, so mermaid's synchronous layout work runs off the editor's main thread.
    In browsers that don't do this, renders are queued one at a time and started in
    `requestIdleCallback`. SC-005 is measured in Chromium, which is the e2e target.
  - **Allowed diagrams (clarification Q2)**: when the user has chosen "Allow", the diagram is
    shown **live inside its own sandboxed frame** (`allow-scripts allow-popups`) running a second
    page, `diagram-sandbox-allowed.html`. There, Mermaid runs with every setting from the source,
    including `securityLevel: "loose"`, HTML labels and click callbacks. The frame resizes itself
    to fit by reporting its size through `postMessage`. Even allowed code stays isolated from
    the app's data. That page's CSP also allows `img-src https:` and `connect-src https:`, so
    "follow everything" can load the resources it asks for, but only after the user allowed it.
- **Rationale**: This one choice meets the time-limit, never-block and untrusted-input
  requirements together. A promise with a timeout can't stop synchronous work running on the main
  thread. Removing a frame can. Mermaid needs the DOM to measure text, so it can't run in a Web
  Worker.
- **Alternatives considered**: (a) Running Mermaid on the main thread with `securityLevel:
  "strict"`. Simplest, but a 5 s render would freeze typing and couldn't be cancelled. Rejected.
  (b) Mermaid's own `securityLevel: "sandbox"`. It renders into an iframe, but on the main thread
  and with no way to stop it. Rejected.
- **Server changes (as built)**:
  - The frame pages live in `frontend/public/` (`diagram-sandbox.html`,
    `diagram-sandbox-allowed.html`) and load one **classic** script,
    `/sandbox/diagram-renderer.js`. `pnpm build:sandbox` (`vite.sandbox.config.ts`) builds it as
    an IIFE with Mermaid inlined. A frame with an opaque origin can't load module scripts
    without CORS, and Vite's dev server refuses `Origin: null`. A classic script needs no CORS,
    so **no `Access-Control-Allow-Origin` header was added** to `/assets`.
  - The app CSP has `frame-ancestors 'none'`, which would stop the frames from loading. The
    backend therefore sends each frame page its own CSP, with `frame-ancestors 'self'`
    (`SANDBOX_CSP` in `main.py`). The safe page has no network. The allowed page may load what
    an allowed diagram asks for. Every other page keeps the app CSP unchanged.
  - Checked against `pnpm build` served by the backend with the real headers: the frame loads
    and draws.

## R7 — Drawing formulas: KaTeX on the main thread, shared commands

- **Decision**: Draw formulas with `katex.renderToString(src, { displayMode, output:
  "htmlAndMathml", throwOnError: true, trust: false, strict: "ignore", maxSize: 50, maxExpand:
  1000, globalGroup: true, macros })`. Errors are caught and shown as described in FR-019.
  - **Shared commands (clarification Q5)**: a formula whose source contains `\newcommand`,
    `\renewcommand`, `\providecommand`, `\def`, `\gdef` or `\let` is a *definer*. The editor keeps
    the definers in document order. The commands available to formula *i* are those built by
    running every definer before it, in order. Each formula's drawn result is cached by
    `hash(source, themeKey, hash(commands so far))`, so editing a definer only redraws the formulas
    after it (FR-025).
  - `trust: false` blocks `\href`, `\url`, `\includegraphics` and `\htmlClass`/`\htmlData`
    (FR-031). `maxExpand` stops macros that expand forever.
- **Rationale**: KaTeX takes under 1 ms for a typical formula and is synchronous, so it doesn't
  need the frame. Drawing only near the viewport (R9) keeps 200 formulas cheap.
- **Alternatives considered**: Rendering formulas in the frame too. That adds a round trip to
  every formula for no safety benefit, since `trust: false` already covers it.

## R8 — Theme

- **Decision**: Read the theme tokens with `getComputedStyle(document.documentElement)`
  (`--editor-surface`, `--surface-elevated`, `--text-primary`, `--text-muted`, `--border`,
  `--accent`, `--accent-foreground`, `--danger`, `--success`, `--warning`). Turn them into Mermaid
  `theme: "base"` `themeVariables` and send them with each render. The `themeKey` is a hash of
  those values. It changes when `useThemeChoice()` changes, which covers custom themes, and that
  marks every drawn diagram as out of date. Visible diagrams are redrawn first (SC-007, under
  1 s). KaTeX output uses `color: inherit`, so formulas follow the theme with no redraw.
- **The diagram's own theme (clarification Q2)**: the diagram's settings are parsed first: YAML
  front matter `config:` and `%%{init: …}%%` / `%%{initialize: …}%%`, parsed with a JSON5-tolerant
  reader. If they set `theme`, `themeVariables`, `themeCSS` or `darkMode`, or the body contains
  `style`, `classDef` or `linkStyle` lines with colour properties, the user is asked (FR-028a). If
  the user declines, these settings are **removed from the text sent to the renderer only**,
  never from the note, and the app's theme is used. The dialog's contrast warning compares the
  diagram's `primaryTextColor` (or text fill) with its background using the existing
  contrast helper in `tokens.contrast.test.ts`, moved into `src/lib/contrast.ts`.
- **Rationale**: This is the only way to reach AA contrast with custom themes. Mermaid's built-in
  themes ignore the app's tokens.

## R9 — Performance and layout

- **Decision**:
  - An `IntersectionObserver` with `rootMargin: "100% 0px"` (about one screen above and below)
    decides which nodes may draw (FR-024).
  - A cache in memory: `source+themeKey(+commands)` → `{svg | html, width, height}`, LRU of 300
    entries (FR-025).
  - The reserved height for a diagram that hasn't been drawn yet is the last height measured for
    the same source hash. These heights are stored in localStorage under
    `uh.diagramHeights` (LRU of 500). A diagram never seen before gets 240 px (FR-023, SC-010).
    `contain: layout` on the wrapper keeps any change in its size from affecting the rest of the
    note.
  - Live preview while editing is debounced by 400 ms (FR-004 / SC-004).
  - Libraries load **only when needed** (FR-027): before the editor mounts, `NotePane` checks
    the note with a cheap scan, the fence check (```` ^\s*(```|~~~)\s*(mermaid|math)\b ````, case
    insensitive) and `mathScanner.hasMath()`. If neither finds anything, the plugin registers its
    nodes but imports nothing. `katex` and `katex/dist/katex.min.css` are loaded with dynamic
    `import()`, and the frame is created only the first time a diagram has to be drawn (or a
    formula or diagram is typed or inserted). Vite emits KaTeX's woff2 fonts as hashed assets,
    so nothing is fetched from outside (FR-034).
- **Rationale**: Notes with no math or diagrams keep the same bundle and the same load time as
  today (SC-006).

## R10 — Diagram decisions (FR-032a): where they are kept

- **Decision**: Keep them in the browser with `lib/storage.ts`, under the key
  `uh.diagramDecisions.<noteId>`. Each value maps a fast hash of the source and info string (FNV-1a plus the length; sha256 would need async WebCrypto) to `{unsafe?: "allow"|"safe",
  theme?: "own"|"app", at}`. At most 200 notes are kept (oldest removed first), and at most 100
  decisions per note. Every diagram's action menu has "Reset decision".
- **Rationale**: Deciding to trust a diagram is a decision about this device, like a browser's
  per-site permissions. Losing it only means the dialog appears again; nothing is lost. The
  `Preferences` schema forbids unknown keys and holds only per-user settings, so keeping
  per-note maps there would need a new table and endpoint just for display state, which goes
  against Constitution VII. The decision is never written into the note (FR-032a).
- **Alternatives considered**: A backend table `diagram_decisions` with a REST endpoint. Rejected
  for the reasons above. It can be added later if decisions need to follow the user to other
  devices.

## R11 — Copy, raw mode, import and export

- **Decision**: For every custom node, `getTextContent()` returns its exact source. `exportDOM()`
  returns `<pre><code>` (blocks) or `<code>` (inline) holding the source, so the plain-text and
  HTML that Lexical puts on the clipboard both carry the source (FR-017). When Markdown is pasted,
  it goes through MDXEditor's normal import, and with it the new visitors. Raw mode
  (`diffSourcePlugin`), note import and note export already work on the exported Markdown, and
  R2 keeps that exact.

## R12 — Find in note and read-only mode (they don't exist today)

- **Decision**: This feature **does not build** find in note or a read-only mode. Both are
  outside this spec (Constitution VII). The feature prepares for them:
  - Every custom node supports `revealSource(range?)`, which opens editing and highlights the
    character range, and `conceal()`. A later find feature can then meet FR-016a just by calling
    them.
  - Every custom node checks `editor.isEditable()`. When the editor is not editable, the nodes
    show their drawings, editing never opens, and the insert buttons are hidden. That meets FR-035
    and FR-044 as soon as `readOnly` is passed to MDXEditor. A unit test checks this.
- **Follow-up**: the spec should be amended (or a feature added) for find in note and read-only
  mode. FR-016a and FR-035 can only be checked from start to finish once those features exist.

## R13 — Expand, export and insert (P2)

- **Decision**:
  - **Expand**: a shadcn `Dialog` showing the cached SVG, with pan and zoom done by CSS transform:
    wheel or pinch, dragging, the `+`/`-`/`0` buttons and keys, and the arrow keys to pan. When
    closed, focus goes back to the diagram, which is Radix's default.
  - **Export**: SVG is the cleaned SVG with the theme's background as a `<rect>`. PNG is drawn
    from that SVG onto a canvas at 2× scale and saved with `toBlob`. "Light, white background"
    asks the frame for a new drawing with light tokens and a white background. Allowed diagrams
    use HTML labels (`foreignObject`), which would taint the canvas. For them, PNG export is
    turned off with an explanation and SVG is exported from the frame.
  - **Insert**: two toolbar buttons next to `InsertCodeBlock`. "Insert diagram" adds
    ```` ```mermaid\nflowchart LR\n  A[Start] --> B[End]\n``` ````, opened for editing.
    "Insert formula" adds `$x^2$` at the caret (inline), opened for editing. The app has no
    command palette. "Editor commands" in FR-044 means these toolbar buttons with their
    accessible labels. **No new keyboard shortcuts** (FR-039).

## R14 — Accessibility

- **Decision**:
  - A diagram's wrapper is `role="group"` (not `img`, which would hide its actions button) with `tabindex="0"`, `aria-label` set to its title
    (`title:` front matter, the `accTitle:` line, or `---\ntitle` front matter) or "Diagram",
    `aria-roledescription="diagram"`, and `aria-describedby` pointing at the `accDescr` text if
    there is one. The cleaned SVG gets `aria-hidden="true"`.
  - Formulas keep KaTeX's MathML (`<math>` with `<annotation encoding="application/x-tex">`), so
    screen readers read the math and the source can still be reached. The HTML version that is
    drawn on screen gets `aria-hidden`.
  - Error, placeholder and too-long messages are `role="status"`.
  - With `prefers-reduced-motion: reduce`, the renderer frame is sent `{reducedMotion: true}`,
    which removes Mermaid's CSS animations, and the expand viewer doesn't animate.
- **Rationale**: Constitution V. The axe checks in Playwright cover light, dark and a custom theme.

## R15 — Testing

- **Decision**:
  - **Vitest**:
    - `mathScanner` against every example from the spec.
    - Round trips through MDXEditor's `importMarkdownToLexical` / `exportMarkdownFromLexical`
      with the new plugin, using a corpus of **30 fixture notes** in `tests/fixtures/notes/`
      (from GitHub, Obsidian and VS Code, with fences, list nesting and edge cases). Every formula
      and diagram slice must match exactly; SC-001/SC-002.
    - The `\$` handling in R3.
    - The directive parser and classifier (unsafe or theme).
    - The decision store.
    - Shared-command ordering.
    - The FR-027 "nothing loaded" check, by spying on dynamic `import()`.
  - **Backend pytest**: the asset CORS header and the allowed-page CSP.
  - **Playwright** (chromium-light and chromium-dark, plus a custom theme):
    - Drawing, editing, Escape and arrow-key movement.
    - Hostile diagrams (SC-008), with network requests recorded and a `window` sentinel.
    - The offline run (`context.setOffline(true)`, SC-009).
    - A note with 20 diagrams and 200 formulas: keystroke latency measured with
      `performance.now()` around `keyboard.type`, and layout shift with `PerformanceObserver`
      (SC-005/SC-010).
    - A theme switch under 1 s (SC-007).
    - axe.
- **Rationale**: Constitution VI. There are no new endpoints, but the server changes are tested.
