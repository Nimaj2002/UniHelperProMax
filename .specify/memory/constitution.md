<!--
Sync Impact Report
==================
Version change: 1.1.0 → 1.2.0
Bump rationale: MINOR — Principle II materially expanded: semesters may now contain events,
stored at the semester level in a reserved folder
(`<year>/<semester>/<reserved-events-folder>/<date-and-title>/` with `notes/`, `audios/`,
`documents/`), plus a rule that course names can never take the reserved folder name. No
principle removed or redefined incompatibly.

Modified principles:
  - II. Data Ownership & Open Formats (title unchanged; two rules added)
Added sections: none
Removed sections: none

Templates reviewed (not modified by this command; they read the constitution at runtime):
  - .specify/templates/plan-template.md      ✅ Constitution Check picks up the amended Principle II
  - .specify/templates/spec-template.md      ✅ no change required
  - .specify/templates/tasks-template.md     ✅ no change required

Dependent specs to review for compliance (Governance):
  - Any spec/plan that creates or renames courses must enforce the reserved-name rule.
  - The upcoming events feature's plan must fix the exact reserved folder name.

Deferred TODOs: none
-->

# UniHelperProMax Constitution

UniHelperProMax is an application in which university students manage class schedules, take
per-class Markdown notes, record lecture audio, and transcribe that audio into their notes.

## Core Principles

### I. User Work Is Never Lost (NON-NEGOTIABLE)

- Notes MUST autosave. A user MUST never need to press "save" to avoid losing typed content,
  and the UI MUST show the current save state (e.g., saving / saved / failed).
- Lecture recordings MUST be persisted progressively (chunked uploads or equivalent) while
  recording is in progress. A browser crash, page refresh, closed tab, or lost connection MUST
  NOT lose more than the most recent un-flushed chunk; previously flushed audio MUST be
  recoverable as a playable file.
- Transcription MUST only ever append to a note. No transcription flow may overwrite, truncate,
  or replace existing note content.
- Destructive operations (deleting a note, recording, class, or semester) MUST require explicit
  user confirmation.

**Rationale**: A lost lecture or a clobbered note cannot be recreated. Durability is the core
promise of the product and outranks every other concern.

### II. Data Ownership & Open Formats

- Notes MUST be stored as plain Markdown (`.md`) files; audio MUST be stored in standard,
  widely playable audio formats (e.g., WebM/Opus, OGG, WAV, MP3, M4A); uploaded documents MUST
  be stored as the PDF files the user uploaded.
- Files MUST live in a human-readable folder hierarchy:
  `<year>/<semester>/<syllabus>/<class-date>/notes/`, `.../<class-date>/audios/` and, for
  uploaded PDFs, `.../<class-date>/documents/`.
  Folder and file names MUST be readable by a person (no opaque IDs as the only identifier).
- Besides courses, a semester MAY contain events. Events MUST be stored at the semester level
  in a single reserved folder, as `<year>/<semester>/<reserved-events-folder>/<date-and-title>/`
  with `notes/`, `audios/` and `documents/` inside, following the same file rules as class
  sessions so they stay plain files the user can browse outside the app.
- The reserved events folder name MUST NOT be able to collide with any course folder: course
  names MUST be rejected (or otherwise prevented) from taking the reserved name. The exact
  reserved name is fixed by the feature's plan.
- Original uploaded PDFs MUST never be modified by the app. Annotations MUST be stored outside
  the original file — as a sidecar file or as a separate annotated copy next to it, as the
  feature's plan decides — so the original stays byte-for-byte intact and the user's work stays
  in plain files.
- A user MUST be able to browse, open, copy, and back up their notes, audio, documents and
  annotations with ordinary OS tools, without running the app.
- The database (SQLite) stores metadata and indexes; it MUST NOT be the sole location of note
  bodies, audio content, documents or annotations.

**Rationale**: Students own their academic work. Open formats and a browsable layout guarantee
the data outlives the app and stays portable.

### III. Strict Frontend/Backend Separation

- The frontend MUST communicate with the backend only through a versioned RESTful JSON API
  (e.g., `/api/v1/...`). Binary transfer (audio upload/stream) MUST go through documented
  endpoints of that same versioned API.
- The frontend MUST NOT access the database or the file system directly.
- Breaking API changes MUST be introduced under a new API version; existing versions MUST keep
  working until explicitly deprecated in the spec.
- Every endpoint MUST have a documented contract (request, response, error shapes).

**Rationale**: A single, versioned boundary keeps the system testable, lets either side evolve
independently, and keeps all data-integrity guarantees enforced in one place.

### IV. Pluggable Transcription & Secret Handling

- All transcription providers MUST implement one shared backend interface. Adding, removing, or
  switching a provider MUST NOT require changes to UI code; the UI discovers available
  providers through the API.
- Provider API keys MUST be stored server-side only. The API MUST NEVER return a full key to
  the frontend; at most a masked form (e.g., last 4 characters) and a "configured" flag.
- API keys MUST NOT be written to logs, error messages, or note/audio files.
- Provider failures MUST surface as clear, recoverable errors and MUST NOT alter the target
  note (see Principle I).

**Rationale**: Transcription vendors change frequently; isolating them behind one interface
keeps the product stable, and server-side secrets prevent credential leakage.

### V. UI Quality & Accessibility

- UI MUST be built from shadcn/ui primitives as the base component layer. Custom components
  MUST compose these primitives rather than replace them without justification.
- Visual decisions (layout, typography, spacing, color, motion) MUST follow the project's
  taste-skill design guidance (`design-taste-frontend`).
- Every screen MUST work correctly in light, dark, and user-created themes. Colors MUST be
  driven by theme tokens; hard-coded colors that bypass the theme are prohibited.
- Every screen MUST be fully keyboard accessible: all interactive elements reachable and
  operable by keyboard, with visible focus indicators and no keyboard traps.
- Text and essential UI elements MUST meet WCAG 2.x AA contrast in every built-in theme; the
  theme editor MUST warn when a user-created theme fails AA contrast.

**Rationale**: Students use the app for hours in varied environments; consistent, accessible,
themeable UI is a functional requirement, not polish.

### VI. Test Coverage for Endpoints and Critical Flows

- Every API endpoint MUST have automated tests covering success and primary error cases.
- The following critical flows MUST have integration tests that exercise the real API, real
  SQLite database, and real file system (temporary directories allowed):
  1. Record → save (including recovery of progressively persisted audio after interruption).
  2. Transcribe → append to note (verifying existing content is preserved).
  3. Recurring class creation (verifying generated sessions and folder hierarchy).
- A change MUST NOT be merged while any of these tests fail.

**Rationale**: The guarantees in Principles I–IV are only real if they are continuously
verified.

### VII. Simplicity & Spec Discipline

- SQLite is the only database. No additional infrastructure (separate DB servers, message
  queues, caches, external object stores) MAY be introduced.
- No feature outside the approved spec MAY be implemented. Scope changes MUST be made by
  updating the spec first (via `/speckit-specify` or `/speckit-clarify`), then planning and
  implementing.
- Any added complexity (new dependency, new abstraction layer, new service) MUST be justified
  in the plan's Complexity Tracking section.

**Rationale**: A small, single-user-friendly stack is easier to run, back up, and reason about;
spec discipline keeps the product focused.

## Technical Constraints

- **Storage**: SQLite for metadata; file system (hierarchy defined in Principle II) for note,
  audio and document content (including annotation files).
- **API**: RESTful JSON, versioned under a path prefix (e.g., `/api/v1`).
- **UI**: shadcn/ui primitives, theme tokens for all colors, light + dark + user-created themes.
- **Transcription**: provider-agnostic interface on the backend; keys stored server-side only.
- **Durability**: autosave for notes; progressive (chunked) persistence for recordings;
  append-only transcription writes.
- **Security**: secrets never returned in full by the API and never logged.

## Development Workflow & Quality Gates

- Work follows the Spec Kit flow: specify → clarify (as needed) → plan → tasks → implement.
- Every plan MUST include a Constitution Check that evaluates the design against Principles
  I–VII; violations MUST be resolved or explicitly justified before tasks are generated.
- Every change MUST pass: all endpoint tests, all critical-flow integration tests, and lint/type
  checks before merge.
- UI changes MUST be verified in light and dark themes and with keyboard-only navigation before
  merge.
- Reviews MUST check for: frontend access to DB/file system (forbidden), transcription writes
  that are not append-only (forbidden), and API responses that expose full API keys (forbidden).

## Governance

- This constitution supersedes all other project practices and guidance. Where a spec, plan,
  or task conflicts with it, the constitution wins until it is amended.
- **Amendments** MUST be made via `/speckit-constitution`, include a Sync Impact Report, and
  state the reason for the change. Dependent specs/plans affected by an amendment MUST be
  reviewed for compliance.
- **Versioning** follows semantic versioning:
  - MAJOR: removal or backward-incompatible redefinition of a principle or governance rule.
  - MINOR: a new principle or section, or materially expanded guidance.
  - PATCH: clarifications, wording, or typo fixes with no change in meaning.
- **Compliance review**: every plan's Constitution Check and every code review MUST verify
  compliance with Principles I–VII. Unjustified violations block merge.

**Version**: 1.2.0 | **Ratified**: 2026-10-04 | **Last Amended**: 2026-10-10
