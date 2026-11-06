# Quickstart: Validate the AI Teacher (022)

## Prerequisites

- Backend and frontend set up as in `CLAUDE.md` (uv, corepack pnpm).
- For automated runs nothing else: tests use `tests/fake_llm.py` scripted teacher replies.
- For the manual checks: one AI endpoint in Settings → AI (a local Ollama model or a remote
  provider) with a model that follows formatting instructions well.

## Automated checks

```bash
cd backend
uv run pytest tests/unit/test_teacher_blocks.py tests/unit/test_teacher_grading.py \
              tests/unit/test_knowledge_graph_merge.py          # splitter, grading, merge rules
uv run pytest tests/contract/test_teacher.py tests/contract/test_knowledge_graph.py
uv run pytest tests/integration/test_teacher_flow.py              # real API + SQLite + files
uv run pytest                                                     # full run: every contract op exercised, no key leaks
uv run ruff check . && uv run mypy

cd ../frontend
corepack pnpm gen:api
corepack pnpm lint && corepack pnpm typecheck
corepack pnpm exec vitest run tests/unit/teacher                  # cards, questions list, graph view (axe included)
corepack pnpm e2e -- teacher.spec.ts                              # fake transcriber/LLM; full lesson flow
```

Expected: all pass. `test_teacher_flow.py` covers: start lesson → question event without key →
submit choice (server grade) → free-text graded by `uh-grade` → dispute adds a second grade →
Stop mid-block yields `malformed: unterminated` → restart server mid-reply yields Interrupted
with earlier questions still answerable → idle 5 min (clock faked) runs extraction → ideas
merged by name → delete chat, sweep, orphan ideas pruned.

## Manual scenario (real model)

1. `UNIHELPER_DATA_DIR=./data uv run uvicorn unihelper.main:app --reload --port 8000` and
   `corepack pnpm dev`; open a class session.
2. Right panel → **AI Teacher** (third section) → New chat → **Lesson**. A three-column tab
   opens with the message box focused (SC-001: < 15 s, 3 actions).
3. Send "I want to understand why det(A)=0 means A is not invertible."
   - The teacher asks probing questions before explaining (SC-003); each appears as a card in
     Current question and an entry in Questions (SC-002).
   - Answer one wrongly with confidence Low and some thinking → the next reply addresses that
     gap before a new idea (SC-004); the question shows Incorrect with icon and text.
4. Choose **Dispute grade** on it with a reason → a second grade appears in its record.
5. Open **Plan** → a Mermaid diagram with the current step marked.
6. Close the tab → "Updating graph…" then nothing; Home → right panel → **Knowledge graph**:
   ideas from the lesson are there; search one by name; select it; follow its source back to the
   lesson (SC-007).
7. Start a second lesson in another session of the same course → **Ideas (n)** is pre-filled
   with the first lesson's ideas; remove one, add one from another course by search.
8. New chat → **Practice**, no topic → problems drawn from the idea set; use **Hint**, then
   **Reveal solution** on another problem.
9. Delete the first lesson → confirmation names how many ideas will go; after Undo expires,
   those ideas are gone from the graph.
10. Repeat steps 2–6 in dark theme and a custom theme, keyboard only (Tab, F6, arrows, Enter,
    Esc), and with a screen reader on the graph's List view (SC-010).

## Performance check

`UNIHELPER_SLOW_TESTS=1 uv run pytest tests/integration/test_knowledge_graph_scale.py` seeds
2,000 ideas / 3,000 links: `GET /knowledge-graph` < 300 ms, search < 100 ms. In the browser
the graph view must open in < 2 s and show search results in < 1 s (SC-009); a 200-question
chat must select a question and scroll in < 1 s (SC-006).
