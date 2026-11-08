/**
 * 023: Yuii's script. One flat list of steps in chapters (data-model.md "Tour step").
 * "show" steps advance with Next; "do" steps wait for the user's real action.
 */
import type { Schemas } from "@/lib/api";
import type { TourEventName } from "./events";
import { SETTINGS_SECTIONS, type SettingsSection, type TargetId } from "./targets";

export type ChapterId = NonNullable<Schemas["TourState"]["chapter"]>;
export type Expression = "greeting" | "instructional" | "excited" | "thinking" | "shy" | "dizzy" | "tablet" | "wink";

export interface TourContext {
  courseId?: string;
  /** Path of the session workspace the user opened during the tour. */
  sessionPath?: string;
  aiConfigured?: boolean;
}

/**
 * event: an app signal; route: the user reached a page; filled: the target got
 * `data-filled="true"`; appears: another target showed up (e.g. a panel opened).
 */
export type WaitFor = { event: TourEventName } | { route: RegExp } | { filled: true } | { appears: TargetId };
type Text = string | ((c: TourContext) => string);

export interface Step {
  id: string;
  chapter: ChapterId;
  kind: "show" | "do";
  title: string;
  text: Text;
  /** Pointing pose when the target is found; this expression otherwise (and when no target). */
  expression: Expression;
  target?: TargetId;
  route?: string | ((c: TourContext) => string | undefined);
  /**
   * Elements clicked once when the step starts, to uncover the target (a collapsed section, an
   * unselected panel tab). Selectors must match only the "closed" state so a click is harmless.
   */
  reveal?: string[];
  waitFor?: WaitFor;
  successText?: string;
  errorText?: string;
  errorExpression?: Expression;
  optional?: boolean;
  /**
   * The panel the target lives in. When that panel is closed (and the target can't be found),
   * Yuii first points at the button that opens it and waits for the user to open it.
   */
  panel?: "left" | "right" | "home-right";
  /** Teach opening `panel` even when the target is still visible while it's closed (e.g. its rail). */
  openFirst?: boolean;
  /** What Yuii says while a dialog the step opened covers its target (e.g. the New note box). */
  dialogText?: string;
  /** The user may pick any of several things (e.g. any class): nothing outside the target is blocked. */
  free?: boolean;
  /** Skipped together with this earlier step (it makes no sense without it). */
  dependsOn?: string;
  /**
   * The step runs inside a modal dialog; closing it without finishing goes back to `restartAt`,
   * and the form's success event (`class.created`) jumps straight to `doneAt`.
   */
  dialog?: { restartAt: string; doneAt?: string };
  /** Even when its wait is already met (a preselected field), stay this long so it can be read. */
  minDwellMs?: number;
  /** Skip this step when its target isn't on the page (e.g. fields only a new semester has). */
  skipIfMissing?: boolean;
  requires?: (keyof TourContext)[];
  skipIf?: (c: TourContext) => boolean;
}

export const CHAPTERS: { id: ChapterId; name: string }[] = [
  { id: "welcome", name: "Hello & overview" },
  { id: "first_course", name: "Your first course" },
  { id: "first_note", name: "Your first note" },
  { id: "pdf_recording", name: "PDFs & recording" },
  { id: "ai", name: "AI chat & AI teacher" },
  { id: "settings", name: "Settings" },
  { id: "goodbye", name: "Goodbye" },
];

export const chapterName = (id: ChapterId) => CHAPTERS.find((c) => c.id === id)?.name ?? id;

export const SESSION_ROUTE = /\/(sessions|events)\/[^/]+$/;
const inSession = (c: TourContext) => c.sessionPath;
const noAi = (c: TourContext) => !c.aiConfigured;
const hasAi = (c: TourContext) => !!c.aiConfigured;
/** Show that tab of the home right panel (once the user has opened the panel). */
const homeTab = (id: string) => [`#home-switch-${id}[data-state="off"]`];
const sessionTab = (id: string) => [`#session-switch-${id}[data-state="off"]`];
const expand = (section: string) => [`button[aria-controls="panel-section-${section}-body"][aria-expanded="false"]`];

const SETTINGS_LINES: Record<SettingsSection, [string, string]> = {
  ai: ["AI providers", "Plug in an AI provider here and I get a big brain upgrade! Your keys stay locked up safe, promise~"],
  transcription: ["Transcription", "Pick who turns your recordings into text. Lectures → notes, like magic ✨"],
  proxy: ["Proxy", "If your network needs a proxy to reach the AI, set it up here. Totally optional!"],
  appearance: ["Appearance", "Themes! Light, dark, or make your own. The pink one is mine, hehe."],
  time: ["Study time", "Pomodoro lengths, daily goals and timer style. I'll cheer for every focused minute!"],
  shortcuts: ["Keyboard shortcuts", "Change any shortcut to your liking. Speedy fingers, speedy studying!"],
  "import-export": ["Import & export", "Bring your timetable in from a calendar file, or take it with you."],
  backup: ["Backup & restore", "Make a backup now and then. Your notes are precious to me too!"],
  trash: ["Trash", "Deleted something by accident? Peek in here before it's gone for good."],
  account: ["Account", "Your password and time zone live here, and you can replay this tour from here too!"],
  version: ["Version", "Which version you're on, and whether there's a shiny new one."],
};

export const STEPS: Step[] = [
  // ---- welcome ----------------------------------------------------------------------------
  {
    id: "welcome.hello",
    chapter: "welcome",
    kind: "show",
    expression: "greeting",
    title: "Hi there, I'm Yuii!",
    text: "Welcome to UniHelper! I'll show you around and help you set up your first course. It only takes a few minutes~",
  },
  {
    id: "welcome.side-panel",
    chapter: "welcome",
    kind: "show",
    route: "/",
    target: "side-panel",
    panel: "left",
    openFirst: true,
    expression: "instructional",
    title: "Your side panel",
    text: "All your years, semesters and courses live over here. It's like my school bag, but tidier!",
  },
  {
    id: "welcome.home",
    chapter: "welcome",
    kind: "show",
    target: "home",
    panel: "left",
    expression: "instructional",
    title: "Home, sweet home",
    text: "Lost? Click here and you're back home in one hop.",
  },
  {
    id: "welcome.calendar",
    chapter: "welcome",
    kind: "show",
    route: "/",
    target: "calendar",
    expression: "excited",
    title: "Your calendar",
    text: "Every class and event shows up here. Click one to open its notes, PDFs and recordings!",
  },
  {
    id: "welcome.right-panel",
    chapter: "welcome",
    kind: "show",
    route: "/",
    target: "home-right-panel",
    panel: "home-right",
    expression: "tablet",
    title: "Your right panel",
    text: "This side has four little helpers. Switch between them with the buttons at the top. Let me show you each one!",
  },
  {
    id: "welcome.tasks",
    chapter: "welcome",
    kind: "show",
    route: "/",
    reveal: homeTab("tasks"),
    target: "home-switch-tasks",
    panel: "home-right",
    expression: "tablet",
    title: "Tasks",
    text: "Homework, readings, exam prep... add them here and drag them across the board as you go. So satisfying!",
  },
  {
    id: "welcome.notes",
    chapter: "welcome",
    kind: "show",
    route: "/",
    reveal: homeTab("notes"),
    target: "home-switch-notes",
    panel: "home-right",
    expression: "instructional",
    title: "General notes",
    text: "Notes that don't belong to any class: shopping lists for the dorm, club ideas, secret crush diaries~",
  },
  {
    id: "welcome.time",
    chapter: "welcome",
    kind: "show",
    route: "/",
    reveal: homeTab("time"),
    target: "home-switch-time",
    panel: "home-right",
    expression: "excited",
    title: "Study time",
    text: "Timers and Pomodoros live here, plus how long you studied each day. Let's beat yesterday!",
  },
  {
    id: "welcome.graph",
    chapter: "welcome",
    kind: "show",
    route: "/",
    reveal: homeTab("graph"),
    target: "home-switch-graph",
    panel: "home-right",
    expression: "thinking",
    title: "Knowledge graph",
    text: "Every idea your AI teacher helps you learn becomes a dot here, linked to related ones. Watch your brain grow!",
  },

  // ---- first course -----------------------------------------------------------------------
  {
    id: "first_course.new-class",
    chapter: "first_course",
    kind: "do",
    route: "/",
    reveal: ["#show-calendar"], // a narrow window may have closed the calendar for the right panel
    target: "new-class",
    expression: "instructional",
    title: "Let's add your first class!",
    text: "Click New class. Your year, semester and course get made right inside that form, all in one go!",
    waitFor: { route: /\/classes\/new$/ },
    optional: true,
  },
  {
    id: "first_course.year",
    chapter: "first_course",
    kind: "do",
    target: "class-year",
    expression: "instructional",
    title: "Pick a year",
    text: "A year holds your semesters, like “2026” or “Year 2”. Pick one you have, or type a new name and choose Create.",
    waitFor: { filled: true },
    minDwellMs: 4500,
    dialog: { restartAt: "first_course.new-class", doneAt: "first_course.done" },
    dependsOn: "first_course.new-class",
  },
  {
    id: "first_course.semester",
    chapter: "first_course",
    kind: "do",
    target: "class-semester",
    expression: "instructional",
    title: "Now a semester",
    text: "A semester holds your courses, like “Fall 2026”. Pick one, or type a new name and choose Create.",
    waitFor: { filled: true },
    minDwellMs: 4500,
    dialog: { restartAt: "first_course.new-class", doneAt: "first_course.done" },
    dependsOn: "first_course.year",
  },
  {
    id: "first_course.semester-dates",
    chapter: "first_course",
    kind: "do",
    target: "class-semester-dates",
    expression: "thinking",
    title: "When does the semester run?",
    text: "A brand-new semester needs its start and end dates. Weekly classes then stop by themselves when the semester ends!",
    waitFor: { filled: true },
    skipIfMissing: true,
    dialog: { restartAt: "first_course.new-class", doneAt: "first_course.done" },
    dependsOn: "first_course.semester",
  },
  {
    id: "first_course.course",
    chapter: "first_course",
    kind: "do",
    target: "class-course",
    expression: "instructional",
    title: "And your course",
    text: "Which course is this class for? “Linear Algebra”? “Art History”? Ooh, exciting!",
    waitFor: { filled: true },
    minDwellMs: 3000,
    dialog: { restartAt: "first_course.new-class", doneAt: "first_course.done" },
    dependsOn: "first_course.semester-dates",
  },
  {
    id: "first_course.save",
    chapter: "first_course",
    kind: "do",
    target: "class-save",
    expression: "thinking",
    title: "When is it?",
    text: "Set the day and time (and repeat it weekly if you like), then save the class!",
    waitFor: { event: "class.created" },
    errorText: "Oopsie, something's not quite right. Check the message on the form and try again!",
    dialog: { restartAt: "first_course.new-class", doneAt: "first_course.done" },
    dependsOn: "first_course.course",
  },
  {
    id: "first_course.done",
    chapter: "first_course",
    kind: "show",
    expression: "excited",
    title: "Yaaay, your first course!",
    text: "Look at you go! Your year, semester and course are all set up. Let's write something!",
    dependsOn: "first_course.save",
  },

  // ---- first note -------------------------------------------------------------------------
  {
    id: "first_note.open-session",
    chapter: "first_note",
    kind: "do",
    route: (c) => (c.courseId ? `/courses/${c.courseId}` : undefined),
    target: "session-link",
    expression: "instructional",
    title: "Open a class session",
    text: (c) =>
      c.courseId
        ? "Each class meeting gets its own space. Click one to open it!"
        : "Click a class in your calendar and choose Open notes, and I'll follow you there! No classes yet? Skip this part for now~",
    dialogText: "Choose Open notes and I'll follow you there!",
    waitFor: { route: SESSION_ROUTE },
    free: true,
    optional: true,
  },
  {
    id: "first_note.new-note",
    chapter: "first_note",
    kind: "do",
    route: inSession,
    reveal: expand("notes"),
    target: "new-note",
    panel: "left",
    expression: "instructional",
    title: "Make a note",
    text: "Click here to make a new note and give it a name. “Lecture 1” is a classic!",
    dialogText: "Give it a name, like “Lecture 1”, and press Create note!",
    waitFor: { event: "note.created" },
    requires: ["sessionPath"],
    optional: true,
  },
  {
    id: "first_note.type",
    chapter: "first_note",
    kind: "do",
    route: inSession,
    target: "note-editor",
    expression: "tablet",
    title: "Write something!",
    text: "Click into the note and type anything you like. Markdown works too: try a # heading or a - list!",
    waitFor: { event: "note.saved" },
    requires: ["sessionPath"],
    optional: true,
    dependsOn: "first_note.new-note",
  },
  {
    id: "first_note.saved",
    chapter: "first_note",
    kind: "show",
    route: inSession,
    target: "save-status",
    expression: "excited",
    title: "Saved all by itself!",
    text: "See? Your note saves on its own while you type. No save button, no lost work. Ever!",
    dependsOn: "first_note.type",
  },

  // ---- PDFs & recording -------------------------------------------------------------------
  {
    id: "pdf_recording.upload",
    chapter: "pdf_recording",
    kind: "do",
    route: inSession,
    reveal: expand("documents"),
    target: "upload-document",
    panel: "left",
    expression: "instructional",
    title: "Got lecture slides?",
    text: "Upload a PDF here and read it right next to your notes. No PDF handy? Just skip, no worries!",
    waitFor: { event: "document.added" },
    successText: "Got it! Open it any time to read and highlight~",
    errorText: "Hmm, that upload didn't work. Try another file, or skip this one!",
    errorExpression: "shy",
    requires: ["sessionPath"],
    optional: true,
  },
  {
    id: "pdf_recording.right-panel",
    chapter: "pdf_recording",
    kind: "show",
    route: inSession,
    target: "right-panel",
    panel: "right",
    expression: "instructional",
    title: "The right panel",
    text: "Recordings, AI chat, the AI teacher and your study timer all live over here. Let's start with recording!",
    requires: ["sessionPath"],
  },
  {
    id: "pdf_recording.record",
    chapter: "pdf_recording",
    kind: "do",
    route: inSession,
    reveal: sessionTab("recordings"),
    target: "record",
    panel: "right",
    expression: "instructional",
    title: "Record the lecture",
    text: "Press Record and say something cute! Your browser may ask to use the microphone. Say yes~",
    waitFor: { event: "recording.started" },
    errorText: "I couldn't hear you... maybe the microphone isn't allowed? You can skip this one!",
    errorExpression: "shy",
    requires: ["sessionPath"],
    optional: true,
  },
  {
    id: "pdf_recording.stop",
    chapter: "pdf_recording",
    kind: "do",
    route: inSession,
    target: "record-stop",
    expression: "excited",
    title: "Now stop it",
    text: "I'm listening! Press Stop when you're done. It saves in little pieces as you go, so nothing gets lost even if your laptop naps.",
    waitFor: { event: "recording.saved" },
    successText: "Recorded! It's in the list now. You can play it back any time~",
    requires: ["sessionPath"],
    dependsOn: "pdf_recording.record",
  },
  {
    id: "pdf_recording.transcribe",
    chapter: "pdf_recording",
    kind: "show",
    route: inSession,
    reveal: sessionTab("recordings"),
    target: "transcribe",
    panel: "right",
    expression: "thinking",
    title: "Turn it into text",
    dialogText: "Check the options and start. The text is added to the end of your note, never replacing it~",
    text: "Press Transcribe and I'll write down what was said, added to the end of your note. It never replaces what you wrote! Greyed out? Pick a transcription service in Settings → Transcription first.",
    requires: ["sessionPath"],
    dependsOn: "pdf_recording.stop",
  },

  // ---- AI ---------------------------------------------------------------------------------
  {
    id: "ai.chat",
    chapter: "ai",
    kind: "show",
    route: inSession,
    reveal: sessionTab("chat"),
    target: "ai-chat",
    panel: "right",
    expression: "thinking",
    title: "AI chat",
    text: (c) =>
      c.aiConfigured
        ? "Ask questions about this class! The AI can read your notes and PDFs to help you."
        : "Ask questions about this class! But first, add an AI provider in Settings → AI. I'll show you soon~",
    requires: ["sessionPath"],
  },
  {
    id: "ai.try",
    chapter: "ai",
    kind: "do",
    route: inSession,
    reveal: sessionTab("chat"),
    target: "right-panel",
    panel: "right",
    expression: "thinking",
    title: "Want to try?",
    text: "Type a question in the message box and send it. Or press Skip, totally fine!",
    waitFor: { event: "chat.sent" },
    successText: "Your first question! I'm so proud~",
    requires: ["sessionPath"],
    optional: true,
    skipIf: noAi,
  },
  {
    id: "ai.teacher",
    chapter: "ai",
    kind: "do",
    route: inSession,
    target: "ai-teacher",
    panel: "right",
    expression: "excited",
    title: "Meet your AI teacher",
    text: "Your AI teacher explains topics step by step and quizzes you. Click the graduation cap to open it!",
    waitFor: { appears: "teacher-new" },
    requires: ["sessionPath"],
    optional: true,
  },
  {
    id: "ai.teacher-no-ai",
    chapter: "ai",
    kind: "show",
    route: inSession,
    target: "teacher-new",
    panel: "right",
    expression: "shy",
    title: "Your lessons live here",
    text: "Past lessons and practice chats show up in this list. The + starts a new one, but it's asleep until you add an AI model in Settings → AI. Come back after, okay?",
    requires: ["sessionPath"],
    dependsOn: "ai.teacher",
    skipIf: hasAi,
  },
  {
    id: "ai.teacher-new",
    chapter: "ai",
    kind: "do",
    route: inSession,
    target: "teacher-new",
    panel: "right",
    expression: "instructional",
    title: "Start a lesson",
    text: "Click + and pick New lesson (I explain things) or New practice (I quiz you). The lesson opens as a big tab in the middle!",
    waitFor: { appears: "teacher-tab" },
    requires: ["sessionPath"],
    optional: true,
    dependsOn: "ai.teacher",
    skipIf: noAi,
  },
  {
    id: "ai.teacher-conversation",
    chapter: "ai",
    kind: "show",
    target: "teacher-conversation",
    expression: "tablet",
    title: "The lesson",
    text: "Your teacher talks with you in the middle column. Ask anything, say “explain it simpler”, or ask for a diagram!",
    dependsOn: "ai.teacher-new",
    skipIf: noAi,
  },
  {
    id: "ai.teacher-questions",
    chapter: "ai",
    kind: "show",
    target: "teacher-questions",
    expression: "instructional",
    title: "Your questions",
    text: "Everything you ask the teacher is collected on the left, so you can jump back to any answer.",
    dependsOn: "ai.teacher-conversation",
    skipIf: noAi,
  },
  {
    id: "ai.teacher-current",
    chapter: "ai",
    kind: "show",
    target: "teacher-current",
    expression: "thinking",
    title: "Answer here",
    text: "The teacher's questions pop up here as cards. Answer right in the card, and the teacher checks it and explains. You've got this!",
    dependsOn: "ai.teacher-conversation",
    skipIf: noAi,
  },
  {
    id: "ai.teacher-menu",
    chapter: "ai",
    kind: "show",
    target: "teacher-menu",
    expression: "thinking",
    title: "Your past questions",
    text: "This strip lists the questions you've already answered, marked right or wrong. Click one to look at it again!",
    dependsOn: "ai.teacher-conversation",
    skipIf: noAi,
  },

  // ---- settings ---------------------------------------------------------------------------
  {
    id: "settings.enter",
    chapter: "settings",
    kind: "do",
    target: "settings-button",
    panel: "left",
    expression: "instructional",
    title: "Settings",
    text: "Everything you can tweak hides behind this little gear. Click it and let's peek inside!",
    waitFor: { route: /^\/settings/ },
    optional: true,
  },
  ...SETTINGS_SECTIONS.map(
    (s, i): Step => ({
      id: `settings.${s}`,
      chapter: "settings",
      kind: "show",
      route: `/settings/${s}`,
      target: `settings-${s}`,
      expression: i % 2 ? "tablet" : "instructional",
      title: SETTINGS_LINES[s][0],
      text: SETTINGS_LINES[s][1],
    }),
  ),

  // ---- goodbye ----------------------------------------------------------------------------
  {
    id: "goodbye.replay",
    chapter: "goodbye",
    kind: "show",
    target: "tour-button",
    expression: "wink",
    title: "That's the tour!",
    text: "You can call me back any time with the chicks button, or from Settings → Account. Good luck with your studies!",
  },
];

export const firstStepOf = (chapter: ChapterId) => STEPS.findIndex((s) => s.chapter === chapter);
export const stepIndex = (id: string) => STEPS.findIndex((s) => s.id === id);
export const textOf = (t: Text, c: TourContext) => (typeof t === "function" ? t(c) : t);

/** Where "Skip this step" goes: past this step and every later step that depends on it. */
export function afterSkipping(index: number): number {
  const skipped = new Set([STEPS[index].id]);
  let i = index + 1;
  while (i < STEPS.length && STEPS[i].dependsOn && skipped.has(STEPS[i].dependsOn!)) skipped.add(STEPS[i++].id);
  return i;
}
