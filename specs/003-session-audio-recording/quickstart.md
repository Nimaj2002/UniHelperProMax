# Quickstart & Validation: Session Audio Recording & Playback (003)

Same setup and checks as 001/002 (`README.md`). Playwright runs Chromium with a fake microphone
(`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`).

| # | Scenario (spec ref) | Expected |
|---|---|---|
| 1 | Record 1 min in any session, stop (US1) | Item with name "Recording HH:MM", date, ~1:00; `…/<date>/audios/Recording HH-MM.webm` plays in a desktop player |
| 2 | Upcoming session | Record available (002 clarification) |
| 3 | Permission denied | Message explains how to allow the microphone; nothing created |
| 4 | Close the tab after 2 min recording, reopen (US2) | Recording listed "Recovered (interrupted)", ≈ 2 min, plays |
| 5 | Offline 1 min while recording, back online (US2 #3) | "Upload pending" then complete; no gap |
| 6 | Switch note tabs, navigate to calendar while recording (US3) | Recording continues; bar visible everywhere; Stop from the bar works |
| 7 | Player (US4) | Play/pause/stop, seek anywhere, ±5 s clamped, volume + mute remembered |
| 8 | Rename / delete (US5) | File renamed / removed; in-progress item cannot be renamed/deleted |
| 9 | Second window | Shows the active recording instead of starting another |
| 10 | Timeline | Session shows the audio indicator |
| 11 | Keyboard + themes | All of the above keyboard-only in light and dark, axe AA |
