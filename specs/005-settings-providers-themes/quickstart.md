# Quickstart & Validation: Settings — Transcription Providers & Themes (005)

Same setup and checks as 001–004 (`README.md`). For provider tests, run the fake transcriber
(`cd backend && uv run uvicorn tests.fake_transcriber:app --port 8020`) and use
`http://localhost:8020` as the address; Playwright starts it itself.

| # | Scenario (spec ref) | Expected |
|---|---|---|
| 1 | Open Settings from any screen (FR-001) | Account menu "Settings" and the top-bar gear both open `/settings/transcription` |
| 2 | Nothing configured (US1 #1) | Voice Studio preselected; only "Server address" (+ optional model) shown; status "Not configured" |
| 3 | Test Voice Studio (US1 #2) | Success or a specific failure within 15 s |
| 4 | Malformed address (US1 #4) | Refused inline on test and save |
| 5 | OpenAI-compatible: address + key + model, test, save (US2) | Status "Connected"; reload shows "••••••••abcd", never the key |
| 6 | Change only the model (US2 #4) | Key kept without re-entering |
| 7 | Switch provider and back (US2 #5) | Previous values still there |
| 8 | `http://` public host with a key (FR-007) | Refused: "Use https://…"; `http://localhost`/`192.168.x.x` allowed |
| 9 | Remove the key (edge case) | Provider "Not configured"; Transcribe (004) explains |
| 10 | Default language (US2 #6) | Used by 004's dialog |
| 11 | Pick Light / Dark / Match system (US3) | Whole app changes immediately; persists after sign-in elsewhere; reload has no flash |
| 12 | New theme from Dark, change key colours (US4) | Live preview, derived colours, AA warnings with ratios |
| 13 | Advanced overrides (US4 #3) | All colours editable; overrides marked + resettable; kept when key colours change |
| 14 | Save a failing theme (US4 #5) | Confirmation listing pairs; saved as "Low contrast" |
| 15 | Rename / duplicate / delete active theme (US4 #6) | Saved; deleting the active one falls back to its base |
| 16 | Built-ins (US4 #8) | Cannot be edited/deleted; can be duplicated/exported |
| 17 | Export → delete → import (US5) | Identical colours; duplicate name gets " (2)"; bad/oversized file rejected |
| 18 | Keyboard + themes + axe (SC-008, FR-023) | All flows keyboard-only, axe AA in light and dark |
