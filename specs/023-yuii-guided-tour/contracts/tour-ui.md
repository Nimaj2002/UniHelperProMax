# UI Contract: Yuii tour

What the rest of the frontend can rely on, and what it must provide.

## Entry points

| Where | Element | Behaviour |
|-------|---------|-----------|
| Navigation rail and side-panel footer | Yuii avatar button, registered with `registerPanelAction({ slot: "footer" })`; accessible name "Tour with Yuii"; tooltip | Opens a menu: "Start from the beginning", then one item per chapter |
| Settings → Account (bottom section "Tour") | Button "Replay tour with Yuii" | Starts at the welcome step |
| App start | Global host (`registerGlobalHost`) | Auto-start rules in research R13 |

## Targets: `data-tour` attribute

`features/tour/targets.ts` maps each id (closed union `TargetId`) to a selector. Existing hooks are
reused where the app already has them (`#course-panel`, `[data-panel="calendar"]`,
`#session-switch-chat`, `a[href="/settings/<section>"]`, …); otherwise feature code adds
`data-tour="<id>"`. When several elements match, the largest visible one is used. The New class
picker fields also carry `data-filled="true|false"`, which the year/semester/course steps wait for.

| Id | Element |
|----|---------|
| `side-panel` | left card / rail |
| `home` | home link |
| `calendar` | calendar view |
| `tasks` | task board entry |
| `right-panel` | right panel / its rail |
| `add-year` | control that creates a year |
| `add-semester` | control that creates a semester |
| `add-course` | control that creates a course |
| `session-note` | the session's note entry/tab |
| `note-editor` | note editor area |
| `save-status` | note save status indicator |
| `upload-document` | document upload/import control |
| `record` | start-recording control |
| `ai-chat` | AI chat entry in the right panel |
| `ai-teacher` | AI teacher entry in the right panel |
| `settings-nav-<section>` | each Settings nav link (`ai`, `transcription`, `proxy`, `appearance`, `time`, `shortcuts`, `import-export`, `backup`, `trash`, `account`, `version`) |
| `tour-button` | the Yuii rail button itself |

Missing targets never break the tour (centred fallback).

## Events: `tourEvents.emit(...)`

Feature code calls `tourEvents.emit(name, payload)` in existing success/error paths (list in
data-model.md). `emit` is a no-op when no tour is running and never throws.

## Keyboard

| Key | Action (interactive mode only) |
|-----|--------------------------------|
| `→` / `Enter` on Next | next step |
| `←` | previous step |
| `Esc` | end tour (asks to confirm inside the bubble after the welcome step) |
| `Tab` | moves through the bubble's controls |

Focus moves into the bubble on each step, onto Next / Start / Continue on show steps and onto the
bubble itself on hands-on steps, so a stray Space or Enter never skips a step. Focus is never taken
while the user is typing in an input, textarea or editor.

In passive mode (a dialog is open) the tour has no focusable elements and no key handling; the
bubble text is announced via `aria-live="polite"`.

## Accessibility

- Bubble: `role="dialog"`, `aria-modal="false"`, `aria-labelledby` = step title, `aria-describedby` = text.
- Yuii image: `alt="Yuii, <expression>"`.
- Progress: "Step N of M · <chapter name>".
- Reduced motion: no movement tweens; instant/fade only.
- All colours from theme tokens; bubble text meets AA in every built-in theme (axe check).
