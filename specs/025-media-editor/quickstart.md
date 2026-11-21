# Quickstart: validating the Media Editor

Prereqs: backend (`UNIHELPER_DATA_DIR=./data uv run uvicorn unihelper.main:app --reload`) and frontend (`corepack pnpm dev`); a class session with one recording (record or import an mp3/webm).

1. **Session entry**: open the session → Audio panel → a recording's menu → **Edit…**. Expect `/media-editor?recording=<id>`, waveform shown, recording highlighted in the Recordings browser under its class and session.
2. **Trim + save new**: drag the start/end handles (or type times), press play to preview, Save → "Save as new", name it → expect a new recording in the browser and in the session; original unchanged (same size/duration).
3. **Overwrite**: trim again, Save → "Overwrite original" → confirm (transcript warning if one exists) → duration shrinks, same name.
4. **Right-panel entry**: from home, click the Media Editor icon in the right rail → empty editor → pick a recording from the browser → loads.
5. **Switch recordings**: with unsaved handles moved, click another recording → discard warning.
6. **Failure safety**: `uv run pytest tests/integration/test_media_trim.py` (forces a mid-save failure; original must be byte-identical).
7. **Checks**: `uv run ruff check . && uv run mypy && uv run pytest`; `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm e2e`; `corepack pnpm gen:api`.
