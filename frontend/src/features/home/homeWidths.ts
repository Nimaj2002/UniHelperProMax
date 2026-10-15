/**
 * Home page width rules (research R11, FR-076–FR-081). The main column holds the Calendar and
 * Tasks panels (or their 44 px rails) with an 8 px gap. Both open needs Calendar ≥ 480 px and
 * Tasks ≥ 320 px; below 1100 px (narrow mode) at most one is open; at least one always is.
 * Pure: inputs in, decisions out.
 */
import { GAP, RAIL_W } from "@/app/shell/widths";

export { GAP, RAIL_W };
export const CAL_MIN = 480;
export const TASKS_MIN = 320;
export const TASKS_DEFAULT = 420;
export const TASKS_MAX_RATIO = 0.6;

export type Panel = "calendar" | "tasks";
export interface PanelsOpen {
  calendar: boolean;
  tasks: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Both panels fit side by side at their minimum widths. */
export function bothFit(mainWidth: number): boolean {
  return mainWidth >= CAL_MIN + TASKS_MIN + GAP;
}

/** Largest Tasks width now: 60 % of the window, and the Calendar keeps 480 px (never below 320). */
export function tasksMax(mainWidth: number, windowWidth: number): number {
  return Math.max(TASKS_MIN, Math.floor(Math.min(TASKS_MAX_RATIO * windowWidth, mainWidth - CAL_MIN - GAP)));
}

/** The displayed Tasks width for a stored preference (the preference itself is never rewritten). */
export function clampTasks(width: number, mainWidth: number, windowWidth: number): number {
  const w = Number.isFinite(width) ? width : TASKS_DEFAULT;
  return Math.round(clamp(w, TASKS_MIN, tasksMax(mainWidth, windowWidth)));
}

export interface ResolveInput {
  open: PanelsOpen;
  /** Width of the main column; null while not measured yet (only the narrow rule applies). */
  mainWidth: number | null;
  /** Window ≥ 1100 px. */
  wide: boolean;
  /** The panel the user is opening now (it wins a conflict); absent for loads and resizes. */
  opening?: Panel;
}

export interface Resolved {
  open: PanelsOpen;
  /** The panel the rules closed (for the notice; the caller keeps loads silent). */
  closedAutomatically?: Panel;
}

/**
 * Applies the rules: at least one open; when both are open but may not be (narrow window or no
 * room) the one being opened stays and the other closes; on a load or a shrink Tasks closes.
 */
export function resolvePanels({ open, mainWidth, wide, opening }: ResolveInput): Resolved {
  if (!open.calendar && !open.tasks) return { open: { calendar: opening !== "tasks", tasks: opening === "tasks" } };
  if (!(open.calendar && open.tasks)) return { open };
  const fits = wide && (mainWidth === null || bothFit(mainWidth));
  if (fits) return { open };
  const closed: Panel = opening === "tasks" ? "calendar" : "tasks";
  return { open: { calendar: closed !== "calendar", tasks: closed !== "tasks" }, closedAutomatically: closed };
}

export interface PanelWidthsInput {
  open: PanelsOpen;
  mainWidth: number;
  windowWidth: number;
  /** Stored Tasks width preference. */
  tasksWidth: number;
  /** Focus mode hides the rails (FR-086). */
  focus?: boolean;
}

export interface PanelWidths {
  /** Width of each panel's slot: the open panel, its 44 px rail, or 0 (hidden rail in focus mode). */
  calendar: number;
  tasks: number;
}

/** Effective widths: Calendar takes what is left; Tasks fills the column when Calendar is closed. */
export function panelWidths({ open, mainWidth, windowWidth, tasksWidth, focus = false }: PanelWidthsInput): PanelWidths {
  const rail = focus ? 0 : RAIL_W;
  const railSlot = rail ? rail + GAP : 0;
  if (open.calendar && open.tasks) {
    const tasks = clampTasks(tasksWidth, mainWidth, windowWidth);
    return { calendar: Math.max(0, mainWidth - tasks - GAP), tasks };
  }
  if (open.calendar) return { calendar: Math.max(0, mainWidth - railSlot), tasks: rail };
  return { calendar: rail, tasks: Math.max(0, mainWidth - railSlot) };
}
