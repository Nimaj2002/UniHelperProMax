# Contract: Teacher Blocks in Reply Text

The teacher writes structured items as fenced code blocks inside its Markdown reply (research
R2). The system prompt (`teacher/prompts.py`) describes exactly this format to the model. The
server's splitter (`domain/teacher_blocks.py`) is the only parser.

## Fence rules

- A block starts with a line that is exactly ```` ```uh-<type> ```` (optional trailing spaces)
  and ends with the next line that is exactly ```` ``` ````. `<type>` is `question`, `grade`,
  `plan` or `hint`. Any other fence (including ```` ```mermaid ````) is ordinary Markdown.
- The body is one JSON object. Trailing commas and `//` comments are not accepted.
- A block cut off by Stop, a failure or the end of the stream is **malformed** with reason
  `unterminated`. A closing fence that is the stream's very last line (no newline after it)
  still closes the block. Text after an unterminated fence is never shown as prose.
- Fences may arrive split across any number of deltas; the splitter holds at most the current
  line until it knows whether a fence starts.
- Payload limits: 20,000 characters per block, 20 question blocks per reply. Beyond that the
  block is malformed (`too_large` / `too_many`).

## `uh-question`

```json
{ "kind": "choice", "title": "Zero determinant", "prompt": "If det(A) = 0, what follows?",
  "options": ["A is invertible", "A has a non-trivial null space", "A is diagonal"],
  "answer": 1, "explanation": "det(A)=0 ⇔ columns are dependent ⇔ Ax=0 has x≠0." }
```

```json
{ "kind": "text", "title": "Why the chain rule", "prompt": "Explain in one sentence …",
  "solution": "Because …" }
```

| Field | Rule |
|---|---|
| `kind` | `choice` or `text`; required. |
| `prompt` | Markdown, 1–4000 chars; required. |
| `title` | Optional, ≤ 80 chars; default: first 80 chars of the prompt as plain text. |
| `options` | `choice`: 2–8 distinct strings (trimmed, case-insensitive). |
| `answer` | `choice`: integer index into `options`. |
| `solution` | `text`: model solution, Markdown. Optional (or `""`) for a probing question with no single right answer; the teacher grades it. |
| `explanation` | Optional. |

In a practice chat every question is a practice problem (Hint and Reveal available).

## `uh-grade`

```json
{ "question": "q3", "grade": "partly", "feedback": "Right idea, but …" }
```

`question` must name a question of this chat with a submission; `grade` is `correct`, `partly`
or `incorrect`. A grade for a choice question replaces the server's grade only when it answers a
dispute. Invalid grade blocks are dropped (logged as a warning without content) and shown as
nothing — the prose explanation still stands.

## `uh-plan`

```json
{ "mermaid": "graph TD\n a[Vectors] --> b[Linear maps]\n b --> c[Eigenvalues]", "current": "b" }
```

`mermaid` is Mermaid source, ≤ 20,000 chars; `current` is a node id in it or null. Each valid
block adds a plan version (FR-026, FR-027). The plan is not shown inline in the Teacher column;
a short "Plan updated" marker is.

## `uh-hint`

```json
{ "question": "q5", "text": "What happens to the area when one column doubles?" }
```

Only valid in practice chats, for a problem without a submission. Recorded on the question
(FR-040).

## Segments

After splitting, a reply is a list of segments in order: `markdown` (prose, Mermaid and math
included), `question` (reference to a question id, placed where its block was), and
`malformed` (`{id, reason}`; the raw text is kept in the file, not sent). Grade, plan and hint
blocks leave no segment except the "Plan updated" marker, which is a `markdown` segment.

## Self-check cases (unit tests)

- Fence split mid-line across 3 deltas → one question event, no prose leaked.
- ```` ```mermaid ```` inside prose → passes through untouched.
- Unterminated `uh-question` at Stop → malformed `unterminated`, prose before it kept.
- `choice` with duplicate options, 1 option, or `answer` out of range → malformed.
- Prose containing ```` ``` ```` that is not a `uh-` fence → passes through.
