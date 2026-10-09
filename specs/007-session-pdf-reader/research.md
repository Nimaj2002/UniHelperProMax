# Phase 0 Research: Session Documents & PDF Reader (007)

Builds on 002 (workspace, tab bar, `workspace_states`, autosave patterns), 003 (IndexedDB queue,
Range streaming), 005 (theme tokens, `colors.ts`), 006 (staged uploads, `StorageService` staging,
upload queue, per-session import lock). Constitution v1.1.0 (Principle II: `documents/`, originals
never modified, annotations outside the file). Earlier evaluations (Atomic Editor, EmbedPDF) are in
the conversation record; the conclusions are restated in R1.

## R1. Reader engine: pdf.js, wrapped by our own React reader

- **Decision**: `pdfjs-dist@6.4.299` (Apache-2.0, Mozilla), pinned exactly. Use the library
  (`pdfjs-dist/build/pdf.mjs`) and its viewer components (`pdfjs-dist/web/pdf_viewer.mjs`:
  `PDFViewer`, `EventBus`, `PDFLinkService`, `PDFFindController`). Our own toolbar, search box and
  annotation layer are React + shadcn components using theme tokens.
- **Configuration**: `annotationMode: AnnotationMode.ENABLE` (draw annotations that are already in
  the file; no interactive forms — FR-020, FR-033), `annotationEditorMode: AnnotationEditorType.DISABLE`
  (pdf.js's own editors off; our layer does annotating — R6), `enableScripting: false` (no PDF
  JavaScript sandbox), `enableXfa: false`, `isOffscreenCanvasSupported` default.
- **Rationale**: range requests and streaming (SC-003 with 200 MB files), a text layer for search,
  selection and screen readers (FR-018, FR-024, FR-025), `pageColors` for dark pages (R4), no
  bundled UI (FR-012 "no second tab bar" is automatic), worker served from our own origin (R3).
- **Alternatives**: `@embedpdf/react-pdf-viewer@2.15.1` — whole-file download only, page background
  hard-coded white (FR-022a impossible), open accessibility issues (#804, #797), shadow DOM theming,
  CDN assets by default, ~196 MB install. `react-pdf` — thin pdf.js wrapper without the viewer
  components (we would rebuild virtualization and find). Browser built-in viewer (`<iframe>`) —
  no theming, no page API, no annotations, inconsistent across browsers.

## R2. Loading from our API: Range + streaming, cookies

- **Decision**: `GET /api/v1/documents/{id}/file` serves the PDF with `FileResponse` (Starlette
  answers `Range` with 206, as the 003 audio endpoint does) and `Accept-Ranges: bytes`. The reader
  calls `getDocument({ url, disableAutoFetch: true, disableStream: false, rangeChunkSize: 262144 })`;
  same-origin requests carry the session cookie (`withCredentials` not needed). `Cache-Control:
  private, max-age=0, must-revalidate` + `ETag` (sha256) so re-opening revalidates cheaply.
- **Rationale**: first page of a large PDF needs only its xref and page objects (SC-003); auto-fetch
  off keeps memory and bandwidth proportional to what is viewed.
- **Measured (T051, 2026-10-09)**: the whole-file stream stays on. pdf.js resolves a document only
  after loading its last page, which walks the page tree; when page dictionaries are spread between
  large contents, range-only loading (`disableStream: true`) fetched nearly every 256 KB chunk as a
  separate request (7.8 s to the first page of a 20 MB file vs ~2 s streamed). With streaming,
  range requests still serve the first page before the whole file has arrived (150 MB check). The
  reader's code and one shared pdf.js worker are fetched in the background once a session lists
  documents, so opening a document doesn't wait for them; the document's metadata comes from the
  list already loaded.

## R3. Assets, worker and CSP

- **Decision**:
  - Worker: `import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"` (Vite emits it to our
    origin) → `GlobalWorkerOptions.workerSrc = workerUrl` (module worker, same origin: no blob URL).
  - Static assets — `cmaps/`, `standard_fonts/`, `wasm/`, `iccs/` — are copied from
    `node_modules/pdfjs-dist` to `frontend/public/pdfjs/` by `scripts/copy-pdfjs-assets.mjs`,
    run from `predev` and `prebuild` (no new dependency), and passed as `cMapUrl`,
    `standardFontDataUrl`, `wasmUrl`, `iccUrl`. `public/pdfjs/` is git-ignored.
  - `useWasm: false`: pdf.js 6 ships JBIG2/JPEG 2000 decoders as WASM with JS fallbacks
    (`*_nowasm_fallback.js`, verified in the package); forcing the fallbacks means our CSP needs no
    `'wasm-unsafe-eval'`.
- **CSP**: current policy (`default-src 'self'; img-src 'self' data:; style-src 'self'
  'unsafe-inline'; object-src 'none'; …`) is expected to suffice: worker same-origin, no eval in
  `pdf.mjs`/`pdf_viewer.mjs` (one guarded `new Function` in the worker, which falls back when
  blocked), inline styles already allowed. The spike task verifies there are no CSP violations in
  the console with real files (scanned, CJK, JPX images) and adds `img-src blob:` only if needed.
- **Offline**: nothing is fetched from third parties.
- **Verified (spike T002, 2026-10-08)**: production build served by the backend with the policy
  above unchanged; the quickstart sample set (text, scanned/image-only, annotated, linked,
  password-protected) opened in the reader, plus dark pages on/off: **no CSP violations** in the
  console (`securitypolicyviolation` listener), so `main.py` needs no change. One finding fixed in
  the reader: pdf.js logged "offsetParent is not set -- cannot scroll" when a hidden reader (an
  open but not shown document tab) was laid out; hidden readers now apply their view when a pane
  shows them.

## R4. Dark pages (FR-022a)

- **Decision**: pdf.js `pageColors: { background, foreground }` with two theme tokens added to
  `tokens.css`: `--reader-page-dark-bg` and `--reader-page-dark-fg` (same values in every theme,
  AA ≥ 7:1). pdf.js maps text and vector graphics to these two colours and leaves raster images
  untouched — "images kept un-inverted where possible". Toggling re-creates the `PDFViewer` with the
  same document, restoring page, zoom and scroll offset (pageColors is a constructor option).
- **Alternatives**: CSS `filter: invert(1) hue-rotate(180deg)` on page canvases (inverts photos too;
  can't exclude images once rasterized).

## R5. Storage layout and identity (Principle II)

- **Decision**: `…/<class-date>/documents/<Name>.pdf` (unchanged upload) and, once the document has
  annotations, `…/documents/<Name>.annotations.json` next to it (the sidecar: plain JSON, format in
  `contracts/annotation-file.md`). Renaming a document renames both files (with undo on rollback).
  Deleting removes both (confirmed). The original PDF is opened read-only by the server and never
  written after the upload commit.
- **Rationale for a sidecar over an annotated copy**: an annotated copy is a full PDF rewrite per save
  (up to 200 MB every few seconds), can't merge concurrent edits per annotation (FR-036) and duplicates
  the document. A small JSON file is saved in milliseconds, merges per annotation and is readable in
  any editor. Exporting a flattened annotated PDF is out of scope (spec Assumptions).
- **Alternatives**: XFDF (Adobe's XML exchange format) — interoperable, but heavier to read/write and
  cannot carry our comment/text-box styling one-to-one; a later "export to XFDF" can be built from
  the JSON. Storing annotations only in SQLite — violates Principle II.

## R6. Annotation rendering and editing: our own layer over pdf.js pages

- **Decision**: a per-page SVG overlay (React portal into each pdf.js page container, created on
  pdf.js `pagerendered` / removed on page eviction) draws the user's annotations: highlights
  (semi-transparent rects, `mix-blend-mode: multiply`), ink (polylines), text boxes (foreignObject
  with a textarea when editing) and comment markers (buttons). Geometry is stored in **PDF page
  space** (points, unrotated, origin bottom-left) and converted with `viewport.convertToViewportPoint`
  at render time, so zoom, rotation and split view never move annotations (spec edge case).
- **Rationale**: pdf.js's editor layer (`AnnotationEditorUIManager`) stores state in
  `annotationStorage` and serializes for *saving into the PDF*; its `deserialize` APIs are internal
  (verified: `static async deserialize(data, parent, uiManager)` on editor classes) and change between
  releases. Owning the layer gives a stable file format, per-annotation merge, keyboard and
  screen-reader semantics, and theme-independent colours.
- **Tools** (FR-025): Select, Highlight (applies to the current text selection from the pdf.js text
  layer; selection rects → page-space quads), Draw (pointer events → points; Ramer–Douglas–Peucker
  simplification at 0.5 pt), Text box (click → box with editable text), Comment (click → marker;
  popover with the text).
- **No selectable text** (FR-032): a page's text is known after `page.getTextContent()`; when every
  loaded page has zero text items, Highlight is disabled with the spec's explanation. Per-page: on a
  page without text, the Highlight action says the page has no selectable text.

## R7. Saving: operation log, per-annotation merge, idempotent retries (FR-028/029/036)

- **Decision**: the client sends batches of operations: `POST /documents/{id}/annotations/ops`
  `{ ops: [{ opId, kind: "upsert"|"delete", annotation?, id?, baseRev }] }`. The server, under a
  per-document lock (pattern of `note_file_lock`), reads the sidecar **from disk** (the file is the
  source of truth), applies each op, writes atomically, and answers per op:
  - `upsert`, new id → insert with `rev 1`.
  - `upsert`, `baseRev == rev` → replace, `rev+1`.
  - `upsert`, `baseRev != rev` (changed in another window or outside the app) → the stored one is
    kept and the incoming one is **added as a copy** with a new id (`conflictOf: <id>`) → result
    `kept_both` (FR-036: both versions kept in the one file; the client shows a notice).
  - `delete`, `baseRev == rev` → delete; `delete` of an annotation changed meanwhile → kept, result
    `kept_changed` (an edit is never lost to a stale delete); `delete` of a missing id → `ok`.
  - Already-applied `opId` → the recorded result is returned again (idempotent retries after a lost
    response). Applied op ids are kept in SQLite (`annotation_ops`, metadata only, pruned after 30
    days) — the user's file stays clean.
- **Unreadable sidecar** (edited by hand into invalid JSON): it is moved aside to
  `<Name>.annotations.unreadable-<timestamp>.json` before a new one is written, and the client is told
  — never overwritten without keeping both (spec edge case, Principle I).
- **Client queue**: ops are written to IndexedDB (`uh-annotations`, store `ops`, key `[docId, seq]`)
  **before** sending; removed only after a 2xx result. Debounce 500 ms, flush ≤ 2 s after the first
  change (FR-028). On failure: state "Not saved", exponential retry up to 30 s, `beforeunload` +
  sign-out guard + tab-close warning while ops are pending (FR-029). Without IndexedDB: in-memory
  queue + warning (same exception as 003).
- **Alternatives**: whole-file PUT with `If-Match` (forces reload on any concurrent change — the
  rejected option B); CRDT libraries (new dependency, overkill for single-user).

## R8. Undo / redo (FR-027)

- **Decision**: a per-document command stack in the reader (lifetime: the document's tab). Each user
  action is a command with forward and inverse ops; undo/redo enqueue those ops like any edit (so they
  are saved and merged the same way). Stack cap 200. `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y` bound
  on the reader's root element only, so a note focused in the other split pane keeps CodeMirror's undo.

## R9. Accessibility of annotations (FR-034, SC-008)

- **Decision**: every user annotation is a focusable element in page order (`role="button"`,
  `aria-label`: "Highlight, page 12: ‘red–black tree’", "Comment, page 14: why O(log n)?"). Selected
  annotation: `Delete` removes, arrow keys move by 1 pt (`Shift` 10 pt), `Enter` edits text,
  `C` opens the colour menu. Highlight by keyboard: text-layer selection with `Shift+Arrow` (pdf.js
  text layer is selectable) then the Highlight button/shortcut. Colour palette: 6 named colours
  (Yellow, Green, Blue, Pink, Orange, Purple) defined in `src/styles/annotation-palette.json`
  (data, like theme presets — the no-hard-coded-colours guard stays green). Annotations already in
  the PDF are drawn by pdf.js's annotation layer (display only, its popups readable).
- An "Annotations" list in the reader's side drawer is **not** added (not in spec); keyboard users
  reach annotations by Tab within the page.

## R10. Documents backend (FR-001–FR-010)

- **Decision**: table `documents` (like `recordings`): name/name_key unique per session folder,
  file_name/file_key, original_file_name, size, sha256, encrypted flag, page_count (nullable, set by
  the client on first open), uploaded_at. Upload route `POST /sessions/{key}/documents/import`
  reuses the 006 staging (`open_upload` / `commit_upload` / `discard_upload`) and the per-session
  import lock; limit 200 MB; check before reading the body (extension `.pdf`, `Content-Length`,
  free space). **PDF check** (no dependency): header `%PDF-1.` / `%PDF-2.` within the first 1024
  bytes and `%%EOF` within the last 2048 bytes; `/Encrypt` in the trailer region (last 64 KB) sets
  `encrypted` (FR-021 message in the reader). Real parsing errors surface in the reader per page.
- Generalize 006 code where it is identical: `StorageService.delete_content_file` allows
  `documents/` with `.pdf` and `*.annotations.json`; the frontend `ImportQueue` becomes generic over
  "endpoint + pre-check" (audio and PDF instances).

## R11. Workspace: typed tabs and split view (FR-011–FR-014a)

- **Decision**: workspace state gains `tabs: [{ kind: "note"|"document", id }]`, `active`, and
  `split: { enabled, left, right, focused: "left"|"right", ratio }`. Stored in two new nullable
  columns on `workspace_states` (`tabs_json`, `split_json`; `ADD COLUMN`, no table rebuild);
  `openNoteIds`/`activeNoteId` stay in the API for compatibility, derived from `tabs`. The tab bar
  stays single; each tab shows a small "L"/"R" pane marker (text, not colour) when split is on.
  Split toggle: button at the right end of the tab bar and `Alt+\` (free in 002 FR-024's map and in
  CodeMirror's defaults). Divider: the existing `PanelResizeHandle` (pointer + keyboard). Split is
  offered at ≥ 1100 px of main-area width; below that, the remembered split shows one tab.
- **Reader instances**: one `PdfReader` per open document tab, kept mounted while the tab is open
  (hidden when not shown) so page/zoom/scroll survive tab switches; pdf.js pages outside the
  viewport are evicted by `PDFViewer`'s buffer, keeping memory bounded.

## R12. Reading position and preferences (FR-019, FR-022a)

- **Decision**: table `document_positions(user_id, document_id, page, updated_at)`;
  `GET/PUT /documents/{id}/position`. The reader saves on `pagechanging` (debounced 1 s) and on tab
  close; opens at `min(page, numPages)`. `Preferences` gains `readerDarkPages: boolean`.

## R13. Search (FR-018)

- **Decision**: `PDFFindController` driven through the `EventBus` (`find` events with `query`,
  `highlightAll`, `findPrevious`); counts from `updatefindmatchescount`; current match from
  `updatefindcontrolstate`. "No searchable text": when the query finds nothing and every page's text
  content is empty, show the spec's message. Search highlight colours: overridden pdf.js CSS
  variables (`--find-highlight-*`) mapped to theme tokens in `reader.css`.

## R14. Bundle and loading

- **Decision**: the reader (pdf.js + viewer + our layer) is a lazy route-level chunk loaded the first
  time a document tab opens, so the notes workspace doesn't pay for it. Measured cost is recorded in
  the spike task (expected: `pdf.min.mjs` + `pdf_viewer` ≈ few hundred KB gz; worker separate).
- **Measured (spike T002, `vite build`, pdfjs-dist 6.4.299)**: reader chunk `PdfReader-*.js`
  610.8 KB (183.6 KB gzip) + `PdfReader-*.css` 230.8 KB (42.0 KB gzip), loaded only when the first
  document tab opens; worker `pdf.worker.min-*.mjs` 1,264 KB (367 KB gzip), fetched by that reader.
  Runtime assets under `/pdfjs/` (cmaps, standard fonts) are fetched only when a PDF needs them.

## R15. Tests (Constitution VI)

- Contract tests for every new operation (documents CRUD, import errors, file Range, annotations
  GET/ops incl. conflicts and idempotency, position, workspace and preferences additions).
- Integration: upload → read file byte-identical; annotate ops → sidecar on disk, PDF hash
  unchanged (SC-010); two clients' concurrent ops merged with `kept_both`; unreadable sidecar moved
  aside; rename/delete move/remove both files; migration 0009 on a populated 0008 DB.
- Unit: PDF sniffing, op application (pure function over the sidecar model), page-space geometry
  conversions, RDP simplification, undo stack.
- E2E (Playwright, generated PDFs with text and a scanned-style image-only PDF): upload, reader
  navigation/zoom/search/remembered page, split view with typing, every annotation tool by pointer
  and keyboard, offline save/retry, two-tab merge, themes + dark pages axe AA.
