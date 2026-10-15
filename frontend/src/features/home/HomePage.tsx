/**
 * The home page (012 Part B): the Calendar and Tasks panels side by side in the shell's main
 * column, each closable to a 44 px rail; at least one stays open; Shift+C / Shift+T toggle them.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { useBareMain, useLayout } from "@/app/shell/layout";
import { useTaskCounts } from "@/features/tasks/useTaskCounts";
import { FocusModeButton, ShowSidePanelButton } from "@/app/shell/MainBarControls";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { CalendarPanel } from "./CalendarPanel";
import { GAP, panelWidths, RAIL_W, TASKS_DEFAULT, TASKS_MIN, tasksMax, type Panel } from "./homeWidths";
import { requestTaskDetails } from "./openTask";
import { LAST_OPEN_MESSAGE, PanelCloseButton } from "./PanelCloseButton";
import { PANEL_ID, PANEL_NAME, PanelRail, SHOW_PANEL_ID } from "./PanelRail";
import { TasksPanel } from "./TasksPanel";
import { PanelsProvider, usePanels } from "./usePanels";

const OTHER: Record<Panel, Panel> = { calendar: "tasks", tasks: "calendar" };
const MAKE_ROOM: Record<Panel, string> = {
  tasks: "Tasks closed to make room for the calendar",
  calendar: "Calendar closed to make room for tasks",
};
const FIRST_CONTROL = "[data-panel-header] :is(button, input, a[href]):not([disabled]):not([tabindex='-1'])";

/** Width of an element, kept current by a ResizeObserver (null until first measured). */
function useWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/** Focus an element once it exists and is shown (panels and rails render on the next frame). */
function focusWhenReady(find: () => HTMLElement | null | undefined, frames = 12) {
  requestAnimationFrame(() => {
    const el = find();
    if (el && el.offsetParent !== null) return el.focus();
    if (frames > 0) focusWhenReady(find, frames - 1);
  });
}

const firstControl = (panel: Panel) => document.getElementById(PANEL_ID[panel])?.querySelector<HTMLElement>(FIRST_CONTROL);

export function HomePage() {
  useBareMain();
  const { focus } = useLayout();
  const root = useRef<HTMLDivElement>(null);
  const mainWidth = useWidth(root);
  const announcer = useRef<HTMLDivElement>(null);

  // set the text directly (the region renders no children) so a repeated message is re-announced
  const announce = useCallback((text: string) => {
    const el = announcer.current;
    if (!el) return;
    el.textContent = "";
    requestAnimationFrame(() => {
      el.textContent = text;
    });
  }, []);

  const autoClosed = useRef<Panel | null>(null);
  const onAutoClose = useCallback(
    (panel: Panel) => {
      autoClosed.current = panel;
      toast(MAKE_ROOM[panel]);
      announce(MAKE_ROOM[panel]);
      if (document.getElementById(PANEL_ID[panel])?.contains(document.activeElement)) focusWhenReady(() => document.getElementById(SHOW_PANEL_ID[panel]));
    },
    [announce],
  );

  const panels = usePanels({ mainWidth, onAutoClose });
  const counts = useTaskCounts();
  const { panels: open, lastOpen, close, open: openPanel, windowWidth, tasksWidth, setTasksWidth } = panels;

  const closeOne = useCallback(
    (panel: Panel) => {
      const r = close(panel);
      if (r === "last-open") return announce(LAST_OPEN_MESSAGE);
      if (r !== "closed") return;
      announce(`${PANEL_NAME[panel]} closed`);
      // focus mode hides the rails: focus goes to the other panel (FR-093)
      focusWhenReady(() => (focus ? firstControl(OTHER[panel]) : document.getElementById(SHOW_PANEL_ID[panel])));
    },
    [close, announce, focus],
  );

  const openOne = useCallback(
    (panel: Panel) => {
      autoClosed.current = null;
      if (openPanel(panel) !== "opened") return;
      const made = autoClosed.current as Panel | null;
      announce(made ? `${PANEL_NAME[panel]} opened. ${MAKE_ROOM[made]}` : `${PANEL_NAME[panel]} opened`);
      focusWhenReady(() => firstControl(panel));
    },
    [openPanel, announce],
  );

  // `/?task=<id>` (a course page's task, FR-052): open the Tasks panel once the column is measured
  // (the width rules apply), show the details, then drop the parameter so Back returns to the
  // page that linked here
  const [params, setParams] = useSearchParams();
  const taskParam = params.get("task");
  const measured = mainWidth !== null;
  useEffect(() => {
    if (!taskParam || !measured) return;
    openPanel("tasks");
    requestTaskDetails(taskParam);
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        next.delete("task");
        return next;
      },
      { replace: true },
    );
  }, [taskParam, measured, openPanel, setParams]);

  // Shift+C / Shift+T (FR-070, R13): by key position so other layouts work; never while typing
  const toggle = useRef<(p: Panel) => void>(() => {});
  useEffect(() => {
    toggle.current = (p) => (open[p] ? closeOne(p) : openOne(p));
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.defaultPrevented || hasModifier(e) || isTypingTarget(e.target)) return;
      const panel: Panel | null = e.code === "KeyC" ? "calendar" : e.code === "KeyT" ? "tasks" : null;
      if (!panel) return;
      if (document.querySelector("[role='dialog'][data-state='open'],[role='alertdialog'][data-state='open']")) return;
      e.preventDefault();
      toggle.current(panel);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const widths = mainWidth === null ? null : panelWidths({ open, mainWidth, windowWidth, tasksWidth, focus });
  const slot = (panel: Panel): { className: string; style?: CSSProperties } => {
    const shown = open[panel];
    if (!shown && focus) return { className: "hidden" };
    if (widths) return { className: "shrink-0", style: { width: widths[panel] } };
    // before the first measurement: Calendar takes the rest
    if (!shown) return { className: "shrink-0", style: { width: RAIL_W } };
    if (panel === "calendar" || !open.calendar) return { className: "flex-1" };
    return { className: "shrink-0", style: { width: TASKS_DEFAULT } };
  };
  // the left card's opener (narrow windows) sits at the start of the first open panel's header;
  // the focus mode button in the Calendar header, or in the Tasks header while the Calendar is closed
  const opener = <ShowSidePanelButton />;
  const trailing = (panel: Panel) => (
    <>
      {(panel === "calendar" ? open.calendar : !open.calendar) && <FocusModeButton />}
      <PanelCloseButton panel={panel} disabled={lastOpen === panel} onClose={() => closeOne(panel)} />
    </>
  );

  // the divider between the panels (FR-077, US11): a drag previews straight on the DOM (no
  // re-render mid-drag) with transitions off; the user's value is stored, the clamped one shown
  const resizing = (on: boolean) => {
    if (root.current) root.current.dataset.resizing = on ? "true" : "false";
  };
  const previewTasks = (w: number) => {
    const el = root.current;
    if (!el || mainWidth === null) return;
    resizing(true);
    const cal = el.querySelector<HTMLElement>(":scope > [data-slot-panel=calendar]");
    const tsk = el.querySelector<HTMLElement>(":scope > [data-slot-panel=tasks]");
    const handle = el.querySelector<HTMLElement>(":scope > [data-testid=tasks-divider]");
    if (cal) cal.style.width = `${mainWidth - w - GAP}px`;
    if (tsk) tsk.style.width = `${w}px`;
    if (handle) handle.style.left = `${mainWidth - w - GAP / 2}px`;
  };
  const divider = open.calendar && open.tasks && widths && mainWidth !== null && (
    <PanelResizeHandle
      value={widths.tasks}
      min={TASKS_MIN}
      max={tasksMax(mainWidth, windowWidth)}
      defaultValue={TASKS_DEFAULT}
      onResize={(w) => {
        resizing(false);
        setTasksWidth(w);
      }}
      onDrag={previewTasks}
      grow="left"
      step={16}
      label="Resize tasks panel"
      controls="tasks-panel"
      data-testid="tasks-divider"
      style={{ left: widths.calendar + GAP / 2 }}
    />
  );

  return (
    <PanelsProvider value={panels}>
      <div ref={root} data-resizing="false" className="relative flex h-full min-h-0 min-w-0 flex-1 gap-2">
        {(["calendar", "tasks"] as const).map((panel) => {
          const { className, style } = slot(panel);
          return (
            <div
              key={panel}
              data-slot-panel={panel}
              className={cn(
                "h-full min-w-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none in-data-[resizing=true]:transition-none",
                className,
              )}
              style={style}
            >
              {panel === "calendar" ? (
                <CalendarPanel open={open.calendar} leading={open.calendar && opener} trailing={trailing("calendar")} />
              ) : (
                <TasksPanel open={open.tasks} leading={!open.calendar && opener} trailing={trailing("tasks")} />
              )}
              {!open[panel] && !focus && (
                <PanelRail
                  panel={panel}
                  onOpen={() => openOne(panel)}
                  openCount={panel === "tasks" ? counts.open : undefined}
                  overdueCount={panel === "tasks" ? counts.overdue : undefined}
                />
              )}
            </div>
          );
        })}
        {divider}
        <div ref={announcer} role="status" aria-live="polite" className="sr-only" data-testid="home-announcer" />
      </div>
    </PanelsProvider>
  );
}
