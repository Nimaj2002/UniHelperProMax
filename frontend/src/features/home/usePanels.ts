/**
 * Home panel state (research R12, FR-076–FR-085): which of Calendar / Tasks is open and the Tasks
 * width, remembered per browser. The stored choice is a preference: the width rules decide what
 * is shown (a shrink closes Tasks; widening again brings it back), and a load applies them
 * silently. `HomePage` owns one instance and shares it through `PanelsProvider`; other components
 * read it with `useHomePanels()`.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { readLocal, writeLocal } from "@/lib/storage";
import { useMediaQuery, WIDE_QUERY } from "@/lib/useMediaQuery";
import { resolvePanels, TASKS_DEFAULT, type Panel, type PanelsOpen } from "./homeWidths";

export const PANELS_KEY = "uh.home.panels";
export const TASKS_WIDTH_KEY = "uh.home.tasksWidth";

export type CloseResult = "closed" | "last-open" | "already-closed";
export type OpenResult = "opened" | "already-open";

export interface PanelsOptions {
  /** Width of the main column (measured by the page); null until measured. */
  mainWidth?: number | null;
  /** Called when the width rules close a panel after load (window/left card change, or opening a
   * panel that leaves no room for the other) so the page can show and announce why. */
  onAutoClose?: (panel: Panel) => void;
}

export interface Panels {
  /** What is shown now (the stored preference within the width rules). */
  panels: PanelsOpen;
  /** Only this panel is open: it can't be closed (FR-076). */
  lastOpen: Panel | null;
  wide: boolean;
  mainWidth: number | null;
  windowWidth: number;
  /** Stored Tasks width preference (clamp with `clampTasks` for display). */
  tasksWidth: number;
  setTasksWidth: (width: number) => void;
  open: (panel: Panel) => OpenResult;
  close: (panel: Panel) => CloseResult;
  toggle: (panel: Panel) => OpenResult | CloseResult;
}

function isPanels(v: unknown): v is PanelsOpen {
  return !!v && typeof v === "object" && typeof (v as PanelsOpen).calendar === "boolean" && typeof (v as PanelsOpen).tasks === "boolean";
}

function useWindowWidth() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("resize", onChange);
      return () => window.removeEventListener("resize", onChange);
    },
    () => window.innerWidth,
    () => 1366,
  );
}

export function usePanels({ mainWidth = null, onAutoClose }: PanelsOptions = {}): Panels {
  const wide = useMediaQuery(WIDE_QUERY);
  const windowWidth = useWindowWidth();
  // first use: both open on wide windows, Calendar only on narrow ones (FR-084)
  const [pref, setPref] = useState<PanelsOpen>(() => {
    const stored = readLocal<unknown>(PANELS_KEY, null);
    return isPanels(stored) ? stored : { calendar: true, tasks: window.matchMedia(WIDE_QUERY).matches };
  });
  const [tasksWidth, setWidth] = useState(() => {
    const w = readLocal<unknown>(TASKS_WIDTH_KEY, TASKS_DEFAULT);
    return typeof w === "number" && Number.isFinite(w) ? w : TASKS_DEFAULT;
  });

  const panels = useMemo(() => resolvePanels({ open: pref, mainWidth, wide }).open, [pref, mainWidth, wide]);
  const lastOpen: Panel | null = panels.calendar && !panels.tasks ? "calendar" : panels.tasks && !panels.calendar ? "tasks" : null;

  const autoClose = useRef(onAutoClose);
  useEffect(() => {
    autoClose.current = onAutoClose;
  });

  // a resize that closes a panel is announced; the first measurement (load) is silent (FR-085)
  const seen = useRef<{ panels: PanelsOpen; pref: PanelsOpen; measured: boolean } | null>(null);
  useEffect(() => {
    const prev = seen.current;
    seen.current = { panels, pref, measured: mainWidth !== null };
    if (!prev || !prev.measured || prev.pref !== pref) return;
    for (const p of ["tasks", "calendar"] as const) if (prev.panels[p] && !panels[p]) autoClose.current?.(p);
  }, [panels, pref, mainWidth]);

  const commit = useCallback((next: PanelsOpen) => {
    setPref(next);
    writeLocal(PANELS_KEY, next);
  }, []);

  const open = useCallback(
    (panel: Panel): OpenResult => {
      if (panels[panel]) return "already-open";
      const r = resolvePanels({ open: { ...panels, [panel]: true }, mainWidth, wide, opening: panel });
      commit(r.open);
      if (r.closedAutomatically) autoClose.current?.(r.closedAutomatically);
      return "opened";
    },
    [panels, mainWidth, wide, commit],
  );

  const close = useCallback(
    (panel: Panel): CloseResult => {
      if (!panels[panel]) return "already-closed";
      if (lastOpen === panel) return "last-open";
      commit({ ...panels, [panel]: false });
      return "closed";
    },
    [panels, lastOpen, commit],
  );

  const toggle = useCallback((panel: Panel) => (panels[panel] ? close(panel) : open(panel)), [panels, open, close]);

  const setTasksWidth = useCallback((w: number) => {
    setWidth(w);
    writeLocal(TASKS_WIDTH_KEY, w);
  }, []);

  return { panels, lastOpen, wide, mainWidth, windowWidth, tasksWidth, setTasksWidth, open, close, toggle };
}

const PanelsContext = createContext<Panels | null>(null);
export const PanelsProvider = PanelsContext.Provider;

const NONE: Panels = {
  panels: { calendar: true, tasks: false },
  lastOpen: "calendar",
  wide: true,
  mainWidth: null,
  windowWidth: 1366,
  tasksWidth: TASKS_DEFAULT,
  setTasksWidth: () => {},
  open: () => "already-open",
  close: () => "last-open",
  toggle: () => "last-open",
};

/** The home page's panels, for components inside it (outside the home page: a no-op). */
export function useHomePanels(): Panels {
  return useContext(PanelsContext) ?? NONE;
}
