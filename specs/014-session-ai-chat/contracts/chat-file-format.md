# Contract: Chat Files in the Session Folder

Each chat is stored as plain files in its session's folder (clarification Q4, research R11). The
layout under the session's (or event's) folder is:

```text
<session folder>/
├── notes/ audios/ documents/            (existing)
└── chats/
    ├── 2026-10-19 1412 What is amortised analysis.json   # source of truth
    ├── 2026-10-19 1412 What is amortised analysis.md     # transcript, regenerated
    ├── 2026-10-19 1412 What is amortised analysis.files/
    │   ├── 01-slide-3.png                                # device uploads, once sent
    │   └── snapshots/3f9a1c0d2b7e4a11.md                 # note snapshots, content-addressed
    └── .uploads/                                         # staged uploads not yet sent (swept after 24 h)
```

## File names

- The stem is `YYYY-MM-DD HHMM <title>`.
  - The date and time are when the chat was created, in the user's time zone.
  - The title part is the first title, passed through `safe_name` and cut to 60 characters.
  - On a collision the existing `unique_sibling` rule adds ` (2)`.
- The stem never changes after creation. Renaming a chat changes only `title`.

## JSON: `uh-chat/1`

The file is UTF-8 with 2-space indentation, and keys appear in a fixed order so diffs stay
readable.

```json
{
  "format": "uh-chat/1",
  "id": "0192…",
  "title": "What is amortised analysis",
  "createdAt": "2026-10-19T14:12:03+02:00",
  "updatedAt": "2026-10-19T14:15:40+02:00",
  "model": { "endpointId": "…", "modelId": "…", "label": "Local Ollama · llama3.2" },
  "context": [
    { "kind": "note", "ref": "<noteId>", "title": "Lecture 5", "addedAt": "…" },
    { "kind": "upload", "ref": "<uploadId>", "title": "slide-3.png", "mime": "image/png", "size": 183022, "file": "01-slide-3.png", "addedAt": "…" }
  ],
  "turns": [
    {
      "id": "t1",
      "selected": 0,
      "versions": [
        {
          "id": "u1",
          "text": "What is amortised analysis?",
          "createdAt": "…",
          "attachments": [ { "kind": "note", "ref": "<noteId>", "title": "Lecture 5" } ],
          "noteSnapshots": [ { "noteId": "<noteId>", "title": "Lecture 5", "snapshot": "3f9a1c0d2b7e4a11" } ],
          "selectedAnswer": 1,
          "answers": [
            { "id": "a1", "status": "stopped", "text": "Amortised…", "endpointLabel": "Local Ollama", "modelLabel": "llama3.2", "locality": "local", "startedAt": "…", "endedAt": "…" },
            { "id": "a2", "status": "completed", "text": "…", "endpointLabel": "Anthropic", "modelLabel": "Claude Sonnet 5.5", "locality": "remote", "startedAt": "…", "endedAt": "…", "usage": { "input": 812, "output": 403 } }
          ]
        }
      ]
    }
  ]
}
```

## Rules

- **Never written to these files**: keys, auth headers, base URLs that contain credentials, or
  raw provider responses (FR-049). The test suite scans every chat file it writes for the test
  keys.
- **Writes**: each write is atomic (write to a temporary file, then rename) and done under the
  chat's lock. After writing the JSON file, the app regenerates the `.md` transcript.
- **Reading back**: if the JSON file was changed outside the app and is still valid
  `uh-chat/1`, the app uses it and re-indexes it. If it is invalid, the chat opens as "Can't
  read this chat file" with the path shown, and the app never overwrites the file.
- **Unknown fields**: the app keeps fields it doesn't recognise when it rewrites the file
  (forward compatibility).

## Markdown transcript

The transcript is only for reading the chat outside the app.

```markdown
# What is amortised analysis

Chat in Algorithms · Tue 14 Oct 2026 · started 2026-10-19 14:12

## You — 14:12

What is amortised analysis?

Attached: Lecture 5 (note)

## Assistant — Anthropic · Claude Sonnet 5.5 — 14:13

…answer Markdown as received…
```

- Only the **selected** user version and answer of each turn appear in the transcript.
- An answer whose status is not `completed` gets a line such as `*(Stopped)*` or
  `*(Interrupted)*`.
