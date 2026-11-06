# Contract: Teacher Chat Files

Teacher chats are 014 chat files (`specs/014-session-ai-chat/contracts/chat-file-format.md`) —
same folder (`<session folder>/chats/`), same stem rule, same `uh-chat/1` format, same atomic
writes under the chat lock, same `.files/` folder for uploads and note snapshots, same rule
that unknown fields are kept and that keys are never written. This contract lists only what is
added.

## Added to the JSON

```json
{
  "format": "uh-chat/1",
  "…": "014 fields",
  "teacher": {
    "kind": "lesson",
    "topic": null,
    "ideaSet": ["<ideaId>", "…"],
    "questions": [
      {
        "id": "q1", "answerId": "a3", "index": 1, "kind": "choice", "practice": false,
        "title": "Zero determinant", "prompt": "If det(A) = 0, what follows?",
        "options": ["A is invertible", "A has a non-trivial null space", "A is diagonal"],
        "key": 1, "explanation": "…", "revealed": false, "hints": [],
        "submission": { "choice": 0, "confidence": 25, "thinking": "I guessed", "submittedAt": "…", "turnId": "t4" },
        "grades": [
          { "grade": "incorrect", "feedback": "", "by": "server", "at": "…" },
          { "grade": "incorrect", "feedback": "…", "by": "teacher", "disputeReason": "I think 0 is right because…", "answerId": "a5", "at": "…" }
        ]
      }
    ],
    "plans": [ { "version": 1, "answerId": "a2", "mermaid": "graph TD …", "current": "b", "createdAt": "…" } ],
    "graph": { "processedTurns": 6, "status": "ok" }
  },
  "turns": [
    { "id": "t4", "selected": 0, "versions": [ {
        "id": "u4", "action": "answers", "target": null,
        "text": "<server-written text sent to the model>",
        "submissions": [ { "questionId": "q1", "choice": 0, "confidence": 25, "thinking": "I guessed" } ],
        "selectedAnswer": 0,
        "answers": [ { "id": "a4", "status": "completed", "text": "…raw teacher text…" } ]
    } ] }
  ]
}
```

`versions[].answers` keeps its 014 meaning (the assistant's answers), so the student's answer
submissions live in `versions[].submissions`. `action` (`answers` | `dispute` | `hint` |
`retry` | null) and `target` (question id, or malformed segment id for `retry`) sit beside them.

- Teacher answers keep their **raw** text (with `uh-*` blocks) in `text`; segments are derived
  on read and never stored.
- `teacher.graph` mirrors the `chats.kg_*` columns so a re-index after an outside edit keeps the
  processed position.
- Regenerate and edit-and-resend (014 versions) are **not** offered in teacher chats; each turn
  has one version and one answer.

## Markdown transcript

Same header as 014, with "Lesson" or "Practice" in place of "Chat". Then per turn:

```markdown
## You — 14:20

Answers:
- **Q1 Zero determinant** — chose "A is invertible" · confidence: 25%
  Thinking: I guessed

## Teacher — Anthropic · Claude Sonnet 5.5 — 14:20

…prose…

> **Q2 — Why the chain rule** (free text)
> Explain in one sentence …
> Status: unanswered

…prose…
```

- A question shows its key and explanation in the transcript only once it is answered or
  revealed, mirroring the UI. The JSON file keeps the key always (it is the student's archive).
- Grades appear under the question as `Status: incorrect (teacher, after dispute)`.
- Plans appear as a ```` ```mermaid ```` block under "Plan (version n)".
