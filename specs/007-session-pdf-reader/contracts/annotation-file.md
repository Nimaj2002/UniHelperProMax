# Contract: Annotation sidecar file (`<Name>.annotations.json`)

Plain UTF-8 JSON next to the PDF in the session's `documents/` folder (Constitution II). Written
atomically (temp file + rename) by the server only; readable and copyable without the app. The PDF
itself is never modified.

```json
{
  "format": "unihelper-annotations",
  "version": 1,
  "document": { "fileName": "Lecture 5 — Trees.pdf", "sha256": "9f2c…" },
  "palette": { "yellow": "#f5d90a", "green": "#…", "blue": "#…", "pink": "#…", "orange": "#…", "purple": "#…" },
  "annotations": [
    {
      "id": "0b9c…", "type": "highlight", "page": 12, "color": "yellow", "colorHex": "#f5d90a",
      "rects": [[72.0, 540.2, 310.5, 552.8]], "quoted": "A red–black tree is a binary search tree…",
      "rev": 3, "createdAt": "2026-10-08T09:12:44.120Z", "updatedAt": "2026-10-08T09:20:01.004Z"
    },
    { "id": "…", "type": "ink", "page": 12, "color": "blue", "colorHex": "#…", "width": 2.0,
      "strokes": [[[100.5, 400.0], [104.2, 402.8]]], "rev": 1, "createdAt": "…", "updatedAt": "…" },
    { "id": "…", "type": "textbox", "page": 12, "color": "orange", "colorHex": "#…",
      "box": [400, 700, 520, 730], "text": "exam!", "rev": 1, "createdAt": "…", "updatedAt": "…" },
    { "id": "…", "type": "comment", "page": 14, "color": "purple", "colorHex": "#…",
      "anchor": [300, 200], "text": "why O(log n)?", "rev": 2, "createdAt": "…", "updatedAt": "…" },
    { "id": "…", "type": "comment", "page": 14, "conflictOf": "<id of the original>", "…": "…" }
  ]
}
```

Rules:

- Coordinates are PDF page space in points, unrotated, origin bottom-left (as in the PDF itself).
- Unknown fields written by a newer version or by the user are preserved on rewrite.
- The server reads the file from disk on every change (it is the source of truth); edits made
  outside the app are kept. An unparseable file is moved aside to
  `<Name>.annotations.unreadable-<YYYYMMDD-HHMMSS>.json` before a new one is written.
- `document.sha256` lets a person (or a later import) see which PDF the annotations belong to.
