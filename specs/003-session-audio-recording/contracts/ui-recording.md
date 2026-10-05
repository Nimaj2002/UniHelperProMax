# Contract: Recording Panel, Recording Bar & Player

Extends 001 `ui-shell.md` and 002 `ui-workspace.md`. Tokens only, keyboard operable, WCAG AA,
recording state never conveyed by colour alone.

## Workspace right panel (`registerWorkspacePanel({ id: "audio" })`)

```text
┌ Audio ──────────────────────────┐
│ [● Record]                      │   ← while recording: ■ Stop · 00:12:31 · level meter
│ ▸ Recording 10:02   1h 24m      │     "Recording in progress" text + live region every minute
│   5 Oct 2026 · 10:02            │
│ ▸ Recording 14:00 (Recovered)   │
│ ┌ Player ─────────────────────┐ │
│ │ ▶  ■  « 5s  5s »  🔊──     │ │
│ │ 00:12 ━━━━━●──────── 1:24:03 │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

- Record button: `Record` (no recording active) · `Stop` (this session recording) · disabled with
  "Recording another session — Go to it" when a different session records. Pressing Record asks
  for microphone permission; denial shows how to allow it.
- List: newest first; each item shows name, date + start time, duration (live timer when
  recording), badges "Recording", "Recovered (interrupted)", "Upload pending", "File missing";
  menu: Rename…, Delete… (disabled while recording).
- Selecting an item loads it into the player (one player per panel; one recording plays app-wide).

## Recording bar (`registerActivity({ id: "recording-bar" })`)

Visible on every authenticated screen while recording: pulsing dot + "Recording" text, elapsed
time, "<Course> · <date>", **Stop**, **Go to session**. `role="region"` labelled "Recording".

## Player

| Control | Name | Keys (player focused) |
|---|---|---|
| Play / Pause | "Play" / "Pause" | `Space`, `K` |
| Stop | "Stop" (back to start) | — |
| Back 5 s / Forward 5 s | "Back 5 seconds" / "Forward 5 seconds" | `←`/`J`, `→`/`L` |
| Seek slider | "Seek", value text "12:31 of 1:24:03" | arrows ±5 s, PageUp/PageDown ±60 s, Home/End |
| Volume slider + Mute | "Volume", "Mute"/"Unmute" | `↑`/`↓` ±10 %, `M` |

Volume/mute persist in `/preferences`. Errors (file missing, unsupported format) show inline text.

## Guards

- `beforeunload` prompt while recording or while chunks are pending upload.
- Sign out while recording: dialog "Stop the recording before signing out" with Stop & sign out /
  Cancel.
