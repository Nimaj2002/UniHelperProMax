# Data Model: AI Teacher (022)

Two stores, as in 014: the **chat file** (source of truth for conversations, Principle II) and
**SQLite** (the chat index and the knowledge graph). One Alembic migration,
`0019_ai_teacher.py`, adds the columns and tables below.

## SQLite

### `chats` (existing, 014) — added columns

| Column | Type | Rule |
|---|---|---|
| `kind` | `String(10)`, not null, default `'chat'` | `chat` \| `lesson` \| `practice`. Fixed at creation. AI chat endpoints filter `kind = 'chat'`; teacher endpoints filter `kind IN ('lesson','practice')`. |
| `unanswered_count` | `Integer`, default 0 | Questions with status `unanswered`; kept in step with the file (FR-002). |
| `kg_processed_turns` | `Integer`, default 0 | Turns already sent to graph extraction (lessons only). |
| `kg_status` | `String(10)`, nullable | `null` (nothing to do) \| `pending` \| `running` \| `ok` \| `failed`. |
| `kg_error` | `String(30)`, nullable | AI error category of the last failed extraction. |
| `kg_attempted_at` | `String` (ISO), nullable | Last extraction attempt; a failed chat is retried automatically at most once per hour. |

Index: `ix_chats_kind_kg (user_id, kind, kg_status, updated_at)` for the worker's scan.

### `kg_ideas`

| Column | Type | Rule |
|---|---|---|
| `id` | id | |
| `user_id` | FK users, cascade | One graph per user (FR-028). |
| `name` | `String(120)` | 1–120 chars, trimmed. |
| `norm_name` | `String(120)` | casefold, punctuation stripped, spaces collapsed; used for merging (R9). |
| `statement` | `Text` | 1–600 chars, one sentence intended. |
| `created_at`, `updated_at` | ISO | `updated_at` = last time a source was added. |

Indexes: `(user_id, norm_name)`, `(user_id, updated_at)`.

### `kg_links`

| Column | Type | Rule |
|---|---|---|
| `id` | id | |
| `user_id` | FK users, cascade | |
| `conclusion_id` | FK kg_ideas, cascade | |
| `signature` | `String(64)` | sha256 of sorted premise ids + conclusion id; unique per user, so the same link is merged, not duplicated. |

### `kg_link_premises`

`(link_id FK kg_links cascade, idea_id FK kg_ideas cascade)`, primary key on both. A link has
≥ 1 premise; a premise is never its own conclusion. Deleting an idea deletes every link it is a
premise or conclusion of (FR-034: "it and its links").

### `kg_sources`

| Column | Type | Rule |
|---|---|---|
| `id` | id | |
| `user_id` | FK users, cascade | |
| `idea_id` | FK kg_ideas, cascade, nullable | Exactly one of `idea_id` / `link_id` is set. |
| `link_id` | FK kg_links, cascade, nullable | |
| `chat_id` | FK chats, **cascade** | Hard-deleting a chat (sweep, or session purge cascade) removes its sources (R10). |
| `course_id` | FK courses, set null, nullable | The chat's session course at extraction time; drives the default idea set (FR-017). |
| `message_id` | `String(64)`, nullable | The teacher answer id the idea came from (FR-030). |
| `created_at` | ISO | Ordering for "most recently taught first". |

Unique: `(idea_id, chat_id, message_id)` and `(link_id, chat_id, message_id)`.

**Prune rule**: after any chat hard-delete (sweep) and after `DELETE` of an idea, ideas with no
source and links with no source are deleted in the same transaction.

**Visibility rule**: graph reads ignore sources whose chat has `deleted_at` set (Undo window);
an idea with no visible source is hidden.

**Idea's courses** (for the default set and the list): distinct `course_id` of its sources.

## Chat file: `uh-chat/1` with a `teacher` object

Full shape in `contracts/teacher-chat-file.md`. Summary of what is added to 014's format:

```text
teacher
├── kind            "lesson" | "practice"
├── topic           string | null          (practice: what the student named)
├── ideaSet         [ideaId] ≤ 30           (FR-017)
├── questions       [Question]              in the order asked
├── plans           [Plan]                  versions, latest last
└── graph           { processedTurns, status, error? }   mirror of the kg_* columns
turns[].versions[]
├── action          null | "answers" | "dispute" | "hint" | "retry"
├── submissions     [AnswerSubmission]      when action = "answers" (014's `answers` = assistant answers)
└── target          questionId (dispute | hint) or malformed segment id (retry)
```

### Question

| Field | Rule |
|---|---|
| `id` | `q1`, `q2`, … in order, per chat. |
| `answerId` | The teacher answer whose text contained the block. |
| `index` | Position of the block within that answer (to place the card in the Teacher column). |
| `kind` | `choice` (single answer, 2–8 distinct options) \| `text`. |
| `title` | ≤ 80 chars; from the block, else the first 80 chars of the prompt. |
| `prompt` | Markdown, 1–4000 chars. |
| `options` | `choice` only: list of strings. |
| `key` | `choice`: index of the correct option. `text`: model solution (Markdown). **Never sent to the client while status is `unanswered`** unless `revealed`. |
| `explanation` | Optional, shown with the key. |
| `practice` | `true` for practice problems (enables Hint and Reveal). |
| `hints` | `[{text, answerId, createdAt}]` (FR-040). |
| `revealed` | `true` once the student chose Reveal (practice) — the key is then visible even if unanswered. |
| `submission` | `null` or `{choice?, text?, confidence, thinking, submittedAt, turnId}`. |
| `grades` | `[{grade, feedback, by: "server" \| "teacher", disputeReason?, answerId?, at}]` in order; the last one is the status (FR-024a). |
| `status` | Derived: `unanswered` → `submitted` (free text, waiting) → `correct` \| `partly` \| `incorrect`. |

**Malformed blocks** are not questions. They are stored in the answer as a `malformed` segment
(`{reason, raw}`) and get Retry (FR-025). A `choice` block with < 2 options, duplicate options
(after trim/casefold) or a key out of range is malformed.

### AnswerSubmission (inside a user turn)

`{questionId, choice?: int, text?: string (≤ 8000), dontKnow?: true, confidence: 0 | 25 | 50 |
75 | 100 | null, thinking: string (≤ 8000) }`. Exactly one of `choice`/`text`, matching the
question kind — or neither with `dontKnow`, which the app grades incorrect at once. Chats saved
with the older levels read `low`/`medium`/`high` as 25/50/75.
A question can be submitted once; changing a grade goes through a dispute.

### Plan

`{version, answerId, mermaid (≤ 20000 chars), current: nodeId | null, createdAt}`. The latest
version is shown (FR-027).

## State transitions

```text
Question:  unanswered ──submit(choice)──▶ correct | incorrect          (server grade)
           unanswered ──submit(text)────▶ submitted ──uh-grade──▶ correct | partly | incorrect
           graded ──dispute──▶ (unchanged until) ──uh-grade──▶ new grade appended
           unanswered ──reveal (practice)──▶ unanswered, revealed = true

Chat graph: null ──lesson turn saved──▶ pending ──worker picks──▶ running ──▶ ok | failed
            failed ──retry (user, or ≥ 1 h)──▶ pending
            ok ──new turns──▶ pending
```

## Validation summary

- Idea set ≤ 30 ids, all owned by the user and existing (missing ids are dropped silently when
  the prompt is built, rejected with 422 on `PUT`).
- Submissions are refused (409 `run_active`) while the chat has an active run (edge case).
- Answers to a question already submitted: 409 `already_answered`.
- Dispute / hint / retry on a question that is not in that state: 409 with the reason.
- Practice-only actions (`hint`, `reveal`) on lesson questions: 409 `not_practice`.
