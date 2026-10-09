# Implementation Plan: Session Documents & PDF Reader

**Branch**: `007-session-pdf-reader` | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-session-pdf-reader/spec.md`

## Summary

PDFs are uploaded with the 006 staged-upload mechanics into the session's `documents/` folder and
listed under the notes. Each opens as a tab of the single workspace tab bar in a reader built on
**pdf.js 6.4.299** (library + viewer components) with our own toolbar: continuous scroll, page
field, zoom, search, remembered page, dark pages (`pageColors`), Range-based progressive loading
and no third-party assets. A toggleable split view shows any two tabs side by side. Users annotate
with our own SVG layer (highlight, freehand, text box, comment); annotations are kept in a plain
JSON sidecar next to the never-modified PDF and saved as idempotent per-annotation operations that
merge concurrent windows without losing either version.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript 5.9 / React 19 (frontend) — as 001–006.

**Primary Dependencies**: **new** `pdfjs-dist@6.4.299` (exact pin; Apache-2.0). No new backend
packages (PDF check is a header/trailer sniff; JSON sidecar via stdlib).

**Storage**: SQLite: new `documents`, `document_positions`, `annotation_ops`; `workspace_states`
+ `tabs_json`, `split_json`; preference `reader_dark_pages` (migration `0009_documents`). Files:
`…/<date>/documents/<Name>.pdf` and `<Name>.annotations.json`. Client: IndexedDB
`uh-annotations` for pending ops.

**Testing**: pytest (contract per operation, integration for upload → read, annotation merge and
idempotency, PDF byte-identity, unreadable sidecar, rename/delete pairs, migration 0009); Vitest
(op queue with fake IndexedDB, undo stack, geometry conversions, RDP, workspace tab/split reducer);
Playwright (reader, split view, annotation tools by pointer and keyboard, offline, two-tab merge,
axe AA in light/dark/preset/custom themes and with dark pages).

**Target Platform**: evergreen desktop browsers (Chrome, Edge, Firefox, Safari); narrow screens get
the reader without split view.

**Project Type**: Web application (existing `backend/` + `frontend/`).

**Performance Goals**: first page ≤ 2 s for a 100-page 20 MB PDF (SC-003) and progressive for 200 MB;
page change ≤ 1 s; search in 300 pages ≤ 3 s (SC-004); "Saved" ≤ 2 s after an annotation change
(SC-009); reader code lazy-loaded so the notes workspace doesn't grow.

**Constraints**: Constitution v1.1.0 — I (autosave + device queue + warnings; confirmed deletes;
never lose an edit to a conflict), II (`documents/`, original untouched, annotations in a plain
sidecar), III (all via `/api/v1`, only `StorageService` touches files), V (tokens, keyboard, AA,
single tab bar), VII (one new dependency, justified below). CSP stays as is (research R3).

**Scale/Scope**: ≤ 200 MB per PDF; ≤ 10,000 annotations / 10 MB per sidecar; ≤ 50 open tabs;
single user per annotation file.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate for 007 | Pre | Post-design |
|---|---|---|---|
| I. Work never lost | Annotations autosave with visible state; failed saves kept and retried; leaving warns; deletes confirmed; concurrent edits never discarded | PASS | PASS — ops in IndexedDB before send, idempotent retries (`annotation_ops`), per-annotation merge keeps both versions (`kept_both`), stale deletes keep edits (`kept_changed`), unreadable sidecar moved aside not overwritten, delete dialog states annotation count, uploads staged (006) |
| II. Data ownership | `documents/` folder; original PDF never modified; annotations outside the file in plain files; DB not sole location | PASS | PASS — PDF byte-identical forever (SC-010 test), JSON sidecar next to it (`contracts/annotation-file.md`), DB holds metadata, positions and op ids only |
| III. Separation | Versioned REST; documented contracts; file access only via `StorageService` | PASS | PASS — 10 new operations in `contracts/openapi.yaml`, additive workspace/preferences fields; PDF served by `GET /documents/{id}/file` |
| IV. Pluggable transcription | Untouched | N/A | N/A |
| V. UI quality | shadcn + tokens; light/dark/preset/custom themes; keyboard; AA; no colour-only state | PASS | PASS — `contracts/ui-reader.md`; dark-page colours are new tokens; annotation palette is named data (`annotation-palette.json`); every annotation focusable with a name; freehand the only pointer-only action (spec SC-008) |
| VI. Testing | Every endpoint tested; critical flows unaffected | PASS | PASS — contract tests per operation; integration tests listed in research R15; existing critical flows untouched |
| VII. Simplicity | SQLite only; new dependency justified; in-spec only | PASS (with justification) | PASS — `pdfjs-dist` justified in Complexity Tracking; no services, queues or CDNs |

**Result**: all gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/007-session-pdf-reader/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/ openapi.yaml · ui-reader.md · annotation-file.md
├── checklists/requirements.md
└── tasks.md                (next: /speckit-tasks)
```

### Source Code (changes)

```text
backend/src/unihelper/
├── db/migrations/versions/0009_documents.py
├── models/document.py                      # Document, DocumentPosition, AnnotationOp
├── models/workspace_state.py               # + tabs_json, split_json
├── domain/pdf_probe.py                      # header/trailer/encrypt sniff
├── domain/annotations.py                    # sidecar model + pure op application (merge rules)
├── storage/storage_service.py              # documents/ in delete_content_file; rename pairs
├── services/document_service.py            # list/import/rename/delete/position (006 import lock reused)
├── services/annotation_service.py          # read sidecar, apply ops under per-document lock, op ids
├── services/workspace_service.py           # typed tabs + split; preference reader_dark_pages
├── schemas/documents.py · schemas/notes.py (WorkspaceState, Preferences additions)
├── api/v1/documents.py                     # documents, file (Range), annotations, position
└── main.py                                 # prune annotation_ops > 30 days at startup
backend/tests/
├── pdf_fixtures.py                          # generated text / image-only / encrypted / annotated PDFs
├── unit/test_pdf_probe.py · unit/test_annotation_ops.py
├── contract/test_documents.py · contract/test_annotations.py · contract/test_workspace.py (+split)
└── integration/test_documents_flow.py · integration/test_annotation_merge.py · integration/test_migration_0009.py

frontend/
├── scripts/copy-pdfjs-assets.mjs           # cmaps, standard_fonts, wasm, iccs → public/pdfjs/ (git-ignored)
└── src/
    ├── styles/tokens.css                    # + --reader-page-dark-bg/fg
    ├── styles/annotation-palette.json       # six named annotation colours (data)
    ├── features/imports/importQueue.ts      # generalized: endpoint + pre-check per instance
    ├── features/documents/
    │   ├── api.ts · routes.tsx              # registers the Documents section + document tab kind
    │   ├── DocumentList.tsx · UploadPdfButton.tsx · DocumentDialogs.tsx
    │   ├── reader/ (lazy chunk)
    │   │   ├── PdfReader.tsx                # pdf.js PDFViewer + EventBus + link/find services
    │   │   ├── ReaderToolbar.tsx · SearchBox.tsx · reader.css (pdf.js vars → tokens)
    │   │   ├── usePosition.ts · pdfjs.ts (getDocument options, asset URLs, worker)
    │   │   └── annotations/
    │   │       ├── AnnotationLayer.tsx · tools.ts · geometry.ts · simplify.ts
    │   │       ├── opQueue.ts (IndexedDB) · undo.ts · saveState.ts
    │   │       └── AnnotationItem.tsx (focusable, named)
    ├── features/sessions/
    │   ├── WorkspacePage.tsx                # typed tabs, split panes, document tab host
    │   ├── NoteTabs.tsx → WorkspaceTabs.tsx # notes + documents, pane markers, split toggle
    │   ├── workspaceTabs.ts                 # tab/split reducer (unit-tested)
    │   └── useWorkspaceKeyboard.ts          # + Alt+\
    └── lib/api/schema.d.ts                  # regenerated
frontend/tests/
├── unit/workspace-tabs.test.ts · unit/annotation-queue.test.ts · unit/annotation-undo.test.ts · unit/geometry.test.ts
└── e2e/documents.spec.ts · e2e/annotations.spec.ts · e2e/a11y-themes.spec.ts (+reader)
```

**Structure Decision**: a new `features/documents` module registered into the 002 workspace (side
panel section + a second tab kind), with the reader as a lazy chunk; the workspace's tab handling is
generalized from "note ids" to typed tabs with a split model. Backend mirrors the 003/006 recording
modules (model, service, router) plus a pure `domain/annotations.py` for merge rules.

## Phase 0 — Research

Complete: [research.md](./research.md) (R1–R15). No NEEDS CLARIFICATION remained in the spec (two
clarification sessions resolved split view, dark pages, existing annotations and two-window saves).

## Phase 1 — Design & Contracts

Complete: [data-model.md](./data-model.md), [contracts/openapi.yaml](./contracts/openapi.yaml),
[contracts/ui-reader.md](./contracts/ui-reader.md),
[contracts/annotation-file.md](./contracts/annotation-file.md), [quickstart.md](./quickstart.md).
Post-design Constitution Check: PASS.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| pdf.js text-layer selection geometry differs across browsers → highlights slightly off | Store page-space quads from `getClientRects` normalized per line; geometry unit tests; Playwright checks in Chromium, Firefox, WebKit |
| CSP violation from pdf.js in some PDFs (worker `new Function`, blob images) | Spike task loads the sample set with the real CSP and checks the console; fallback: `img-src blob:` only, documented |
| Many open document tabs keep pdf.js instances alive | `PDFViewer` buffer evicts off-screen pages; documents not shown for 10 min are unmounted and restored from page/zoom state |
| Split-view refactor regresses 002 tab behaviour | Tab/split logic extracted into a pure reducer with unit tests; existing notes e2e suite must stay green |
| Concurrent ops race between the HTTP request and a hand edit of the sidecar | All writes under the per-document lock, re-read from disk inside it; atomic rename; unknown fields preserved |
| Large sidecars slow saves | Ops are batched; sidecar capped at 10 MB / 10,000 annotations with a clear 413 |
| pdf.js major updates change viewer APIs | Exact pin; reader isolated behind `PdfReader`; upgrade = deliberate task |

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| New dependency `pdfjs-dist` (Constitution VII) | PDF parsing/rendering, text layer, find, Range loading and dark-page colours are a large, security-sensitive engine | Writing a renderer is out of the question; browser's built-in viewer can't be themed, controlled or annotated; EmbedPDF fails FR-022a, accessibility and full-download constraints (research R1) |
| `annotation_ops` table for idempotent retries | Retried batches after a lost response must not create duplicate conflict copies (Principle I correctness) | Recording op ids in the user's sidecar pollutes their file; no idempotency risks duplicated annotations |
