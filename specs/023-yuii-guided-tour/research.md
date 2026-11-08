# Research: Yuii Guided Tour

All Technical Context unknowns are resolved below. Each entry: Decision / Rationale /
Alternatives considered.

## R1 — Where the per-user tour state lives

**Decision**: Add one key, `tour`, to the existing per-user preferences document
(`ui_preferences` row, `GET`/`PATCH /api/v1/preferences`). Default for every account, old or
new: `{ "status": "not_seen", "chapter": null }`.

**Rationale**: FR-019 needs the state per account and across devices; the preferences store is
exactly that, already backed up/restored (`backup/tables.py` lists `ui_preferences`), already
validated by Pydantic with `extra="forbid"`, and already has an optimistic frontend hook
(`usePreferences` / `useUpdatePreferences` in `features/sessions/api.ts`). Shortcuts (019) and
time settings (020) set the precedent. A default of `not_seen` for everyone gives clarification
answer B (existing users also get the tour once) with no migration.

**Alternatives considered**: a new table + endpoints (more code, no benefit); browser
`localStorage` (breaks "follows them across devices", FR-019, SC-004); a flag on `users` (needs a
migration and a new endpoint).

## R2 — Tour engine: library or own code

**Decision**: Own small engine in `frontend/src/features/tour/`: a static step list, a React
context with `{ stepIndex, status }`, an overlay component, and a placement function. No new
dependency.

**Rationale**: Tour libraries (react-joyride, driver.js, shepherd) bring their own tooltip UI and
styling that fight the requirement that *Yuii herself* is the tooltip (large character beside
the target, pose chosen by direction). What we need beyond that is small: measure a target's
rect, draw a dimmed backdrop with a hole, place an image + bubble. Principle VII (no new
dependency without justification) favours own code. `motion` (already installed, v14) handles
movement and reduced motion (`useReducedMotion`).

**Alternatives considered**: react-joyride (custom tooltip component possible, but its spotlight,
scroll and beacon logic duplicate ours and add ~40 kB); driver.js (imperative DOM API, not
React-friendly, own CSS).

## R3 — Marking targets

**Decision**: Targets carry a `data-tour="<target-id>"` attribute. A step names its target id;
the engine finds it with `document.querySelector('[data-tour="…"]')`. Target ids are a closed
TypeScript union so a typo fails the type check.

**Rationale**: Additive, one attribute per target, no refs threaded through feature code, stable
across refactors of class names/text. Missing targets are handled by the "not on screen" edge
case (Yuii centered, no pointing).

**Alternatives considered**: CSS/text selectors (fragile); React refs registered in a context
(touches more code for the same result).

## R4 — Knowing when a hands-on step is done

**Decision**: A tiny in-memory event bus `tourEvents` (`emit(name)`, `on(name, fn)`) in
`features/tour/events.ts`. Existing success paths emit one event each:
`class.created {courseId}`, `note.created`, `note.saved`,
`document.added`, `recording.saved`, `chat.sent`, plus `action.failed {kind}`. Steps that only
need the user to reach a screen wait for a route match instead, and the New class picker steps wait
for their field's `data-filled="true"`. Each step lists what it waits for.

Year, semester and course have no separate create controls in this app: they are picked or
created ("Create “X”") inside the New class form's `HierarchyPicker`. So the first-course
chapter guides that one form; picking an existing item is the "use existing" path (FR-014).

**Rationale**: Explicit, synchronous with the real success handler (so it is never fooled by a
failed request), trivial to unit test, and a no-op when no tour is running. Seven one-line
additions to existing success handlers.

**Alternatives considered**: watching the TanStack Query cache for list growth (indirect: the
note save does not grow a list; recordings arrive via `timeline` invalidation; fragile
diffing); watching the DOM (fragile); polling the API (wasteful).

## R5 — Coexisting with modal dialogs (Radix)

(Ending the tour asks for confirmation inside the bubble rather than with an `AlertDialog`, so the
tour never opens a modal of its own.)

**Decision**: The tour layer is portalled to `document.body` above dialogs (`z-[60]`; dialogs use
`z-50`). While a step is *awaiting* a user action, the layer is **passive**: no backdrop clicks,
`pointer-events: none` on everything, no focusable controls, and the bubble text is announced
through an `aria-live="polite"` region. Its "Skip this step" / "End tour" controls come back as
soon as no modal dialog is open (detected via `[role="dialog"][data-state="open"]`). On *show*
steps and when awaiting with no dialog open, the layer is interactive and the backdrop blocks
clicks except inside the highlight hole.

**Rationale**: Radix modal dialogs trap focus and treat any outside pointer-down as "dismiss".
Interactive tour buttons outside the dialog would either be unreachable by keyboard or close the
user's form. A passive Yuii next to the dialog keeps the form working (FR-011) and keeps the
tour on screen (FR-001). Cancelling the dialog returns the skip controls, so nothing is a trap.

**Alternatives considered**: rendering the tour inside each dialog (couples every dialog to the
tour); making dialogs non-modal during the tour (changes app behaviour, WCAG risk).

## R6 — Yuii artwork, poses and mirroring

**Decision**:
- **Pointing** (bust shots, transparent PNG, ~250 kB each, in `Yuii/`): `point-left`,
  `point-left-low`, `point-left-arm-extended`, `point-up-left`, `point-up-left-high`,
  `point-up-left-raised`, `point-up-left-shallow`, `point-up-left-arm-extended`. All point to
  the viewer's left. Right-facing variants are produced by mirroring at render time
  (`transform: scaleX(-1)`), not as extra files.
- **Expressions** (full figure, cropped transparent WebP, ~70–140 kB each, already made for the
  website in `website/assets/yuii/`): `greeting`, `instructional`, `excited`, `thinking`, `shy`,
  `dizzy`, `tablet`; plus `Yuii/finger-heart-wink.png` for the goodbye.
- Copy the used files into `frontend/src/features/tour/assets/` so Vite hashes them and they load
  only with the lazily imported tour chunk.
- **Pose choice**: the engine computes the angle from Yuii's hand anchor to the target centre:
  roughly horizontal → `point-left`; target above → one of the `point-up-left*` poses (steeper →
  `-high`/`-raised`); target below → `point-left-low`; far → `-arm-extended`. Mirrored when Yuii
  stands left of the target. Steps that do not point use an expression image.

**Rationale**: CSS mirroring gives every pose both directions with zero extra bytes and no image
tool (none is installed: no `cwebp`/ImageMagick). The website WebPs are already cropped with
alpha; the original transparent PNGs in `Yuii/` are 1.3–4 MB and would bloat the bundle. The user
allowed saving mirrored copies; it is not needed.

**Alternatives considered**: saving mirrored PNGs into `Yuii/` (doubles assets, needs an image
tool); one sprite sheet (needs tooling; little gain at ~16 images).

## R7 — Placement and sizing (clarification: large, beside the target)

**Decision**: Yuii's height is `min(33vh, 340px)`; she is placed on the side of the target with
more free space (right preferred, since base poses point left), vertically centred on the target
and clamped to the viewport with a 16 px margin. The bubble attaches to her head on the side away
from the target. If the free side is narrower than Yuii + bubble, shrink her to a minimum of
`160px`; if still too tight, hide her and show only the bubble next to the target (FR-025).
Recompute on window resize, scroll, and a `ResizeObserver` on the target.

**Rationale**: Implements FR-025 and SC-002 (correct facing, never covering the target) with a
deterministic, unit-testable function `place(targetRect, viewport) → { side, size, pose, bubble }`.

## R8 — Highlight / dimming

**Decision**: One fixed full-screen SVG with a mask: theme overlay colour (`--overlay` token, the
same dialogs use) with a rounded-rect hole around the target (8 px padding), plus a 2 px ring in
`--ring`. The hole lets pointer events through only on hands-on steps.

**Rationale**: Theme tokens only (Principle V), works in light/dark/custom themes, no layout
changes to target elements.

## R9 — Navigation between screens

**Decision**: A step may declare `route` (a path or a function of the tour context, e.g. the
session the user created/picked). Before showing the step the engine navigates with
`useNavigate`, then waits up to 3 s for the target to appear (`MutationObserver`), scrolls it into
view, and opens collapsed panels via the existing layout actions (`useLayout()` toggles). If the
target still does not appear, the "not on screen" fallback applies (Yuii centred, no pointing).

**Rationale**: FR-009 and the "target not on screen" edge case, using the app's own router and
layout state.

## R10 — Tour context (what the user created or picked)

**Decision**: The running tour keeps `{ yearId, semesterId, courseId, sessionKey }` in memory,
filled from the event payloads (`emit("course.created", { id })`) or from the "use existing"
picker. Only the `chapter` is persisted (R1); after a reload the context is re-derived: the most
recently created course and its first session (from existing queries), or the picker is shown
again.

**Rationale**: Keeps the stored state tiny and avoids storing ids that can go stale (deleted
course).

## R11 — Speech text and tone

**Decision**: All lines live in one file, `features/tour/steps.ts`, next to their step (English,
1–3 sentences, playful). Kaomoji and exclamations are fine; no emoji-only content (screen readers).
The image `alt` describes the expression ("Yuii, excited").

## R12 — Existing end-to-end tests

**Decision**: Every existing Playwright test signs in an account that has never seen the tour,
so the tour would auto-start and cover the app. Under browser automation (`navigator.webdriver`)
the host does not auto-start the tour unless `localStorage["uh.tour.e2e"] === "1"`;
`tour.spec.ts` sets that flag with `addInitScript`. Replay from the button or Settings still works
under automation.

**Rationale**: Patching the shared `signIn` helper was tried first. It did not cover the specs
that sign in through other helpers or by hand (members in `accounts.spec.ts`), and it needed a
reload per test. Real users never run with `navigator.webdriver` set.

## R13 — Auto-start timing

**Decision**: The tour host (registered with `registerGlobalHost`) waits until the user is signed
in, preferences have loaded, and the shell has rendered, then starts if `tour.status` is
`not_seen` (welcome step) or `in_progress` (offer "Continue from <chapter>" / "End tour",
FR-021). Not on the sign-in, setup or admission screens; not while a restore is running.
