# Quickstart & Validation: Session Documents & PDF Reader (007)

Setup as in `README.md`. Contracts: [openapi.yaml](./contracts/openapi.yaml),
[ui-reader.md](./contracts/ui-reader.md), [annotation-file.md](./contracts/annotation-file.md).
Data: [data-model.md](./data-model.md).

## Automated

```bash
cd frontend && pnpm install          # predev/prebuild copy pdf.js assets to public/pdfjs/
cd backend && uv run pytest          # contract + integration (incl. migration 0009, merge, SC-010)
cd frontend && pnpm test && pnpm e2e tests/e2e/documents.spec.ts tests/e2e/annotations.spec.ts
```

## Sample files

A 40-page text PDF (slides), a 300-page paper, a ~150 MB PDF, a scanned (image-only) PDF, a
password-protected PDF, a PDF that already has highlights/comments, a PDF with internal and web
links, a `.pptx`, a 250 MB file.

## Manual scenarios

| # | Scenario (spec ref) | Expected |
|---|---|---|
| 1 | Upload two PDFs by button and by drop (US1) | Progress, then listed with name, size, date; files in `…/<date>/documents/` byte-identical |
| 2 | Pick `.pptx` + 250 MB file (US2) | Refused instantly with reasons; no request sent |
| 3 | Open slides (US3) | One new tab in the workspace tab bar; no tab strip inside the reader; page 1 within 2 s |
| 4 | Next/prev, page field 999, zoom 50→400, fit width, scroll (US3) | Works; 999 → last page with message |
| 5 | Split on (`Alt+\`), slides left, note right, type 10 min (US3, SC-006) | Reader page/zoom/scroll unchanged; split + pairing remembered after reload |
| 6 | 150 MB PDF (SC-003) | First page shows before the whole file downloads (DevTools: 206 responses) |
| 7 | Read to p. 27, close, reopen; open in another browser (US4) | Opens at 27 both times |
| 8 | Search "tree" in the 300-page paper; search the scanned PDF (US5) | "3 of 11" navigation; scanned → "no searchable text" |
| 9 | Dark theme + "Dark pages" on/off (FR-022a) | Pages dark with photos intact; off restores at once; page/zoom kept |
| 10 | Protected PDF; links PDF (FR-020/021) | Protected message; internal links jump, web links new tab |
| 11 | Annotate: highlight, draw, text box, comment; recolour, move, delete, undo, redo (US6) | "Saved" within 2 s each; reload + other browser show all; PDF sha256 unchanged |
| 12 | Scanned PDF annotate (US6 #9) | Highlight disabled with explanation; draw/text/comment work |
| 13 | PDF with existing annotations (US6 #10) | Shown; not selectable or editable |
| 14 | Offline 15 min while annotating, back online (SC-011) | "Not saved — retrying" then "Saved"; nothing lost; leaving warns meanwhile |
| 15 | Two browser windows edit the same comment (FR-036) | Both versions in the one sidecar; notice shown |
| 16 | Hand-edit the sidecar into invalid JSON, then annotate | Bad file moved aside as `.unreadable-…json`; new sidecar written |
| 17 | Rename annotated doc; delete it (US7) | Sidecar renamed with it; delete dialog shows annotation count; both files removed |
| 18 | Keyboard only + axe in light, dark, a preset, a custom theme (SC-008) | Every flow except freehand; AA clean |
