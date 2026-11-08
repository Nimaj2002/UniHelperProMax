# Quickstart: Validate the Demo Mode

## Prerequisites

- `frontend/` dependencies installed (`corepack pnpm install`), including `msw`.
- No backend needed.

## Automated checks

```bash
cd frontend
corepack pnpm lint && corepack pnpm typecheck   # handler/seed shapes checked against schema.d.ts
corepack pnpm test                              # incl. tests/unit/demo/* (handlers under msw/node)
corepack pnpm build && corepack pnpm check:no-demo   # SC-005: normal build has no demo code
corepack pnpm build:demo && corepack pnpm e2e:demo   # scenarios 1–6 below, automated
```

`e2e:demo` fails any test that sees a request to an origin other than the preview server
(SC-003) or an axe violation on the banner.

## Manual scenarios (`corepack pnpm dev:demo` → http://localhost:5174)

1. **Entry** (US1, SC-001): fresh window → home screen with sample data, banner visible, no
   login. Yuii's tour offers to start; skip it.
2. **Browse** (US1, SC-002): open calendar, a past session, task board, settings — no error
   toasts, no "server unreachable".
3. **Edit & reset** (US2, SC-004): type in a note (shows saved), move a task, add an event, pick
   dark theme. Navigate away and back: all kept. Reload: all gone, light/system theme back.
   Repeat with **Reset demo** → confirm.
4. **PDF** (R3 risk, verify first): open the sample PDF; pages render, an annotation can be added.
5. **Audio**: play the sample recording and seek to the middle; playback continues from there.
6. **AI & transcription** (US3): send a chat message → reply streams; run transcription on the
   sample recording → progress, then text appended below existing note content.
7. **Unavailable** (FR-010): press Record → toast "Recording is available in the
   UniHelperProMax app." and **no** microphone prompt. Try adding an AI provider and uploading a
   PDF → same kind of toast, nothing added.
8. **Tabs**: open a second tab → it shows the original sample data.
9. **Themes & keyboard** (Principle V): banner readable in light, dark and a custom theme; Tab
   reaches Reset and Download; dialog traps focus and Esc closes it.
10. **Website** (US4): `website/` hero and download sections show "Try the demo"; it opens the
    demo in a new tab.

## Desktop unaffected

```bash
corepack pnpm --dir ../frontend build && grep -r UNIHELPER_DEMO_BUILD ../frontend/dist || echo OK
```

The desktop packaging consumes `frontend/dist`, so `OK` here covers it.
