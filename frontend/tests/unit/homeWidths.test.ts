/** 012 R11 / SC-011: home panel width rules over the window × left-card matrix. */
import { describe, expect, it } from "vitest";
import { GAP, layoutWidths } from "@/app/shell/widths";
import {
  bothFit, CAL_MIN, clampTasks, panelWidths, RAIL_W, resolvePanels, TASKS_DEFAULT, TASKS_MAX_RATIO, TASKS_MIN, tasksMax,
  type Panel, type PanelsOpen,
} from "@/features/home/homeWidths";

const BOTH: PanelsOpen = { calendar: true, tasks: true };

/** The shell's main column for a window, with the left card open (280 px) or closed. */
function mainOf(windowWidth: number, leftClosed: boolean) {
  const wide = windowWidth >= 1100;
  const w = layoutWidths({
    viewport: windowWidth, mode: wide ? "docked" : "overlay", focus: false, leftClosed, leftWidth: 280,
    rightPresent: false, rightClosed: true, rightWidth: 300,
  });
  return { wide, main: windowWidth - 2 * GAP - (w.leftEff ? w.leftEff + GAP : 0) };
}

describe("bothFit / clampTasks", () => {
  it("needs 480 + 320 + gap", () => {
    expect(bothFit(CAL_MIN + TASKS_MIN + GAP)).toBe(true);
    expect(bothFit(CAL_MIN + TASKS_MIN + GAP - 1)).toBe(false);
  });

  it("clamps to [320, min(60 % window, main − 480 − gap)]", () => {
    expect(clampTasks(100, 1062, 1366)).toBe(TASKS_MIN);
    expect(clampTasks(TASKS_DEFAULT, 1062, 1366)).toBe(TASKS_DEFAULT);
    expect(clampTasks(5000, 1062, 1366)).toBe(1062 - CAL_MIN - GAP);
    expect(clampTasks(5000, 1904, 1920)).toBe(Math.floor(1920 * TASKS_MAX_RATIO));
    expect(clampTasks(Number.NaN, 1062, 1366)).toBe(TASKS_DEFAULT);
    // never below the minimum, even when the room is smaller (both can't be open then)
    expect(tasksMax(700, 800)).toBe(TASKS_MIN);
  });
});

describe("resolvePanels", () => {
  it("keeps at least one panel open", () => {
    expect(resolvePanels({ open: { calendar: false, tasks: false }, mainWidth: 1000, wide: true }).open).toEqual({ calendar: true, tasks: false });
    expect(resolvePanels({ open: { calendar: false, tasks: false }, mainWidth: 1000, wide: true, opening: "tasks" }).open).toEqual({ calendar: false, tasks: true });
  });

  it("keeps both when they fit on a wide window", () => {
    expect(resolvePanels({ open: BOTH, mainWidth: 1062, wide: true })).toEqual({ open: BOTH });
    expect(resolvePanels({ open: BOTH, mainWidth: null, wide: true })).toEqual({ open: BOTH });
  });

  it("closes Tasks on load or shrink, and the other panel when one is being opened", () => {
    expect(resolvePanels({ open: BOTH, mainWidth: 700, wide: true })).toEqual({ open: { calendar: true, tasks: false }, closedAutomatically: "tasks" });
    expect(resolvePanels({ open: BOTH, mainWidth: 700, wide: true, opening: "calendar" }).closedAutomatically).toBe("tasks");
    expect(resolvePanels({ open: BOTH, mainWidth: 700, wide: true, opening: "tasks" })).toEqual({ open: { calendar: false, tasks: true }, closedAutomatically: "calendar" });
  });

  it("allows at most one panel below 1100 px whatever the room", () => {
    expect(resolvePanels({ open: BOTH, mainWidth: 5000, wide: false }).open).toEqual({ calendar: true, tasks: false });
    expect(resolvePanels({ open: BOTH, mainWidth: null, wide: false }).open).toEqual({ calendar: true, tasks: false });
    expect(resolvePanels({ open: BOTH, mainWidth: 5000, wide: false, opening: "tasks" }).open).toEqual({ calendar: false, tasks: true });
  });
});

describe("SC-011 matrix", () => {
  const cases = [800, 1024, 1099, 1100, 1366, 1920].flatMap((w) => [false, true].map((leftClosed) => [w, leftClosed] as const));

  it.each(cases)("window %i, left card closed: %s", (windowWidth, leftClosed) => {
    const { wide, main } = mainOf(windowWidth, leftClosed);
    const check = (open: PanelsOpen, stored: number) => {
      expect(open.calendar || open.tasks).toBe(true);
      if (!wide) expect(open.calendar && open.tasks).toBe(false);
      const w = panelWidths({ open, mainWidth: main, windowWidth, tasksWidth: stored });
      if (open.calendar) expect(w.calendar).toBeGreaterThanOrEqual(CAL_MIN);
      else expect(w.calendar).toBe(RAIL_W);
      if (open.tasks) {
        expect(w.tasks).toBeGreaterThanOrEqual(TASKS_MIN);
        if (open.calendar) expect(w.tasks).toBeLessThanOrEqual(windowWidth * TASKS_MAX_RATIO);
      } else expect(w.tasks).toBe(RAIL_W);
      // the slots fill the main column exactly
      expect(w.calendar + w.tasks + GAP).toBe(main);
    };
    for (const stored of [0, TASKS_MIN, TASKS_DEFAULT, 5000]) {
      check(resolvePanels({ open: BOTH, mainWidth: main, wide }).open, stored);
      for (const opening of ["calendar", "tasks"] as Panel[]) {
        const from: PanelsOpen = { calendar: opening !== "calendar", tasks: opening !== "tasks" };
        const r = resolvePanels({ open: { ...from, [opening]: true }, mainWidth: main, wide, opening });
        expect(r.open[opening]).toBe(true);
        check(r.open, stored);
      }
    }
    // the auto-close choice: both fit only on wide windows with room
    const fits = wide && bothFit(main);
    expect(resolvePanels({ open: BOTH, mainWidth: main, wide }).closedAutomatically).toBe(fits ? undefined : "tasks");
  });

  it("1366 × 768 with the left card open fits both at the default width", () => {
    const { wide, main } = mainOf(1366, false);
    expect(resolvePanels({ open: BOTH, mainWidth: main, wide }).open).toEqual(BOTH);
    expect(panelWidths({ open: BOTH, mainWidth: main, windowWidth: 1366, tasksWidth: TASKS_DEFAULT }).tasks).toBe(TASKS_DEFAULT);
  });

  it("Tasks fills the column when the Calendar is closed; focus mode hides the rail", () => {
    expect(panelWidths({ open: { calendar: false, tasks: true }, mainWidth: 1000, windowWidth: 1366, tasksWidth: 420 })).toEqual({ calendar: RAIL_W, tasks: 1000 - RAIL_W - GAP });
    expect(panelWidths({ open: { calendar: false, tasks: true }, mainWidth: 1000, windowWidth: 1366, tasksWidth: 420, focus: true })).toEqual({ calendar: 0, tasks: 1000 });
  });
});
