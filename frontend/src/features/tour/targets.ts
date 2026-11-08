/** 023: what Yuii can point at. Reuses existing hooks where the app already has them. */
export const SETTINGS_SECTIONS = [
  "ai", "transcription", "proxy", "appearance", "time", "shortcuts", "import-export", "backup", "trash", "account", "version",
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

const SELECTORS = {
  "side-panel": "#course-panel",
  home: '#course-panel a[href="/"], a[href="/"][aria-label="Go to home"]', // the app name, or the rail's icon
  calendar: '[data-panel="calendar"]',
  "home-right-panel": '[data-panel="tasks"]',
  "home-switch-tasks": "#home-switch-tasks",
  "home-switch-notes": "#home-switch-notes",
  "home-switch-time": "#home-switch-time",
  "home-switch-graph": "#home-switch-graph",
  // buttons that open a closed panel (Yuii teaches these before the panel's own steps)
  "open-left": '#show-side-panel, button[aria-label="Show side panel"]',
  "open-right": "#show-session-panel",
  "open-home-right": "#show-tasks",
  "settings-button": 'button[aria-label="Settings"]',
  "new-class": '[data-tour="new-class"]',
  "class-year": '[data-tour="class-year"]',
  "class-semester": '[data-tour="class-semester"]',
  "class-semester-dates": '[data-tour="class-semester-dates"]',
  "class-course": '[data-tour="class-course"]',
  "class-save": '[data-tour="class-save"]',
  "session-link": 'a[href*="/sessions/"], [data-session-key]', // a course page's list or a calendar block
  "new-note": '[data-tour="new-note"]',
  "note-editor": '[data-tour="note-editor"]',
  "save-status": '[data-tour="save-status"]',
  "upload-document": '[data-tour="upload-document"]',
  record: '[data-tour="record"]',
  "record-stop": '[data-tour="record-stop"], button[aria-label="Stop recording"]',
  transcribe: 'button[aria-label^="Transcribe "]',
  "right-panel": "#workspace-session-panel",
  "ai-chat": '#session-switch-chat, [data-rail-item="chat"]',
  "ai-teacher": '#session-switch-teacher, [data-rail-item="teacher"]',
  "teacher-new": 'button[aria-label="New teacher chat"]',
  // any visible part of an opened lesson tab
  "teacher-tab": 'main section[aria-label="Your questions"], main section[aria-label="Teacher"], main nav[aria-label="Questions menu"]',
  // the middle column, or its message box when a narrow main card squeezes the column away
  "teacher-conversation": 'main section[aria-label="Teacher"], main textarea[aria-label="Message"]',
  "teacher-questions": 'section[aria-label="Your questions"]',
  "teacher-current": 'section[aria-label="Current question"]',
  "teacher-menu": 'nav[aria-label="Questions menu"]',
  "tour-button": '[data-tour="tour-button"]',
  ...(Object.fromEntries(SETTINGS_SECTIONS.map((s) => [`settings-${s}`, `a[href="/settings/${s}"]`])) as Record<
    `settings-${SettingsSection}`,
    string
  >),
} as const;
export type TargetId = keyof typeof SELECTORS;

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0; // off-screen is fine: the tour scrolls it into view
}

/**
 * The most prominent visible element for this target (e.g. the toolbar's "New class" rather
 * than the small "+" beside Courses), or null: the step then shows Yuii centred.
 */
export function findTarget(id: TargetId): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const el of document.querySelectorAll(SELECTORS[id])) {
    if (!visible(el) || el.closest("[data-tour-layer]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height > bestArea) [best, bestArea] = [el, r.width * r.height];
  }
  return best;
}
