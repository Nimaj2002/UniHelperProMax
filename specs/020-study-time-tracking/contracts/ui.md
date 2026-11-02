# Contract: UI

## Right panel (home)

- The existing section switch (`TasksPanel.tsx`, `tasksColumn.ts`) gains a third item
  `time` (icon `Timer`, aria-label "Time", id `home-switch-time`). The switch's aria-label
  becomes "Tasks, general notes or time"; the panel card's label becomes "Tasks and time".
- `PanelRail` gains a Time item; while a timer runs it shows the time in `mm` digits (hours as
  `1h`) or, when there is no room, a small play/pause glyph, plus sr-only "Timer running".
- Time body, top to bottom: TimerCard (ToggleGroup Track / Pomodoro / Focus, disabled styles
  other than the running one show "Running: Track" and switching starts a new timer only on
  Start), ToggleGroup Today / Reports, then the view. No other fixed bar. Works at 320 px.

## Timer card

- Track: description input, TagPicker, Start/Stop, "Add time".
- Pomodoro: phase + period ("Work 2 of 4"), countdown, Start/Pause/Resume/Skip/Reset,
  "Started at" note after settlement ("Work 2 finished at 10:25").
- Focus: preset ToggleGroup 25/45/60/90 + custom number (1–480), goal, "Hide panels while
  focusing" checkbox, Pause/+5 min/Finish.
- Long-running: an inline alert "Still working?" with Keep running / Stop.
- Failure: "Not saved yet — retrying" with Retry now.

## Floating indicator

- Mounted where `RecordingBar` is mounted today, through `FloatingIndicators`, which renders
  per `indicator_combo`: combined pill (recording part, then timer part, each with its own
  controls), two stacked pills (recording on top), or recording pill with a timer badge.
- Timer pill: icon (Track `Timer`, Pomodoro `Hourglass`, Focus `Target`), time
  (elapsed Track, remaining others), description or tag, Pause, Stop. Label is a button that
  navigates to `/`, opens the right panel in `time` and focuses the timer card.
- Hidden while the timer card is ≥ 50 % visible (IntersectionObserver).
- Live region (`aria-live="polite"`) receives only: phase changes, end, stop, "Still working?".
  The ticking time has `aria-hidden` digits plus a static accessible label refreshed on focus.
- `motion-reduce`: no pulse or slide.

## Calendar

- `CalendarToolbar`: Switch "Show time" (default on, `uh.calendar.showTime`).
- Day/week: `TimeLane` in each day column's right lane; block = button with
  aria-label "Linear algebra, Homework, 09:00–10:30"; tooltip on hover/focus; activation opens
  the entry's edit form in the Time panel. Lane pointer events never reach `useGridDrag`.
- Month: per day "2 h 15 m" text under the date when > 0.

## Reports (P2)

- Period: ToggleGroup Today / Week / Month / Custom (date range picker), previous/next buttons.
- Group: Select By tag / By course / By day. View: ToggleGroup Table / Chart; at < 400 px the
  table is shown first and the chart below when Chart is chosen.
- Table columns: Name, Time, Share, Entries; row button lists its entries below.
- Donut: SVG `role="img"` + aria-label summary, slices with pattern + color, legend list with
  times; slice click/Enter lists its entries.

## Settings

New section "Time" in Settings: Pomodoro lengths and periods, automatic start, long-running
reminder (hours or off), sound, system notifications (with explanation and permission state),
"Indicator when recording and timer run together", daily goal (P3). Shortcut "Start/stop
timer" in the shortcuts registry (P3).
