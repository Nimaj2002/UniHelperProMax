# Demo sample assets (024)

Bundled only into the demo build's lazily loaded chunks (imported with `?inline` by
`handlers/documents.ts` and `handlers/recordings.ts`); normal builds never contain them.

| File | What | Source / licence |
| --- | --- | --- |
| `lecture-week3.pdf` | "Intro to Algorithms — Week 3: Divide and Conquer", 4 pages, ~4 KB | Original to this project (text written for the demo; PDF hand-built with a Python stdlib script using the standard Helvetica/Courier fonts, nothing embedded). Same licence as the repository. |
| `lecture-week3.wav` | **Placeholder** audio: 30 s of quiet soft tones, 8 kHz mono 8-bit, ~240 KB | Original to this project (generated with Python's `wave` module). Same licence as the repository. |

**The WAV is a placeholder.** Replace it with an original ~60 s lecture clip (maintainer
recording, or an open-licence TTS voice whose licence allows redistribution — note the licence
here), < 600 KB. When you do, update `AUDIO_SIZE` and `mimeType`/`fileName` in
`handlers/recordings.ts` and `LECTURE_DURATION_MS` in `canned/lecture.ts`; the canned transcript
in `canned/lecture.ts` is what the clip should say.

If the PDF changes, update `PDF_SIZE` and the highlight rectangles in `handlers/documents.ts`
(EmbedPDF page coordinates: points, origin top-left, page 612 × 792).
