import { CaretDown } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Outlet } from "react-router";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { readLocal, writeLocal } from "@/lib/storage";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { ActivityBar } from "./ActivityBar";
import { CoursePanelSlot } from "./CoursePanelSlot";
import { PanelSectionProvider, usePanelSectionSlot } from "./panelSection";
import { useGlobalHosts } from "./registry";
import { TopBar } from "./TopBar";
import { ToolbarProvider } from "./toolbar";

const MIN_W = 240;
const MAX_W = 480;
const DEFAULT_W = 280;
const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));
/** Height of the page's section under the courses, in % of the panel (starts in the middle). */
const SECTION_MIN = 15;
const SECTION_MAX = 85;
const SECTION_DEFAULT = 50;
const clampSection = (p: number) => Math.min(SECTION_MAX, Math.max(SECTION_MIN, p));

function GlobalHosts() {
  const hosts = useGlobalHosts();
  return (
    <>
      {hosts.map(({ id, component: C }) => (
        <C key={id} />
      ))}
    </>
  );
}

/**
 * Desktop left panel: courses, and under them the current page's section (if any). Positioned
 * to fill its grid cell so long section content scrolls inside instead of growing the page.
 */
function SidePanel() {
  const { section, setTarget } = usePanelSectionSlot();
  const [pct, setPct] = useState(() => clampSection(readLocal("uh.panel.sectionPct", SECTION_DEFAULT)));
  const panel = useRef<HTMLElement>(null);
  useEffect(() => writeLocal("uh.panel.sectionPct", pct), [pct]);
  const open = section && !section.collapsed;
  return (
    <aside
      id="course-panel"
      ref={panel}
      aria-label="Side panel"
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden border-r border-divider bg-surface"
      style={{ "--section-h": `${pct}%` } as CSSProperties}
    >
      <div className="min-h-0 flex-1">
        <CoursePanelSlot />
      </div>
      {section && (
        <section
          aria-labelledby="panel-section-title"
          className="relative flex min-h-0 shrink-0 flex-col border-t border-divider"
          style={open ? { height: "var(--section-h)" } : undefined}
        >
          {open && (
            <PanelResizeHandle
              value={pct}
              min={SECTION_MIN}
              max={SECTION_MAX}
              defaultValue={SECTION_DEFAULT}
              onResize={setPct}
              onDrag={(p) => panel.current?.style.setProperty("--section-h", `${p}%`)}
              grow="up"
              step={5}
              unitsPerPx={() => 100 / (panel.current?.clientHeight || 1)}
              label={`Resize ${section.title.toLowerCase()}`}
              controls="panel-section-body"
              className="top-0"
            />
          )}
          <h2 id="panel-section-title">
            <button
              type="button"
              onClick={section.onToggle}
              aria-expanded={!section.collapsed}
              aria-controls="panel-section-body"
              aria-keyshortcuts="Alt+["
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <CaretDown size={12} weight="bold" aria-hidden className={cn("transition-transform motion-reduce:transition-none", section.collapsed && "-rotate-90")} />
              {section.title}
            </button>
          </h2>
          <div id="panel-section-body" ref={setTarget} hidden={section.collapsed} className="min-h-0 flex-1 overflow-hidden" />
        </section>
      )}
    </aside>
  );
}

/**
 * Side panel | page columns. Owns the side panel's width, so committing a resize re-renders only
 * this wrapper (the panel and page are unchanged elements), not the whole app.
 */
function ShellColumns({ side, children }: { side: ReactNode; children: ReactNode }) {
  const [width, setWidth] = useState(() => clamp(readLocal("uh.panel.width", DEFAULT_W)));
  const columns = useRef<HTMLDivElement>(null);
  useEffect(() => writeLocal("uh.panel.width", width), [width]);
  return (
    <div
      ref={columns}
      className="grid min-h-0"
      style={{ "--side-w": `${width}px`, gridTemplateColumns: side ? "var(--side-w) minmax(0,1fr)" : "minmax(0,1fr)" } as CSSProperties}
    >
      {side && (
        <div className="relative min-h-0 min-w-0">
          {side}
          <PanelResizeHandle
            value={width}
            min={MIN_W}
            max={MAX_W}
            defaultValue={DEFAULT_W}
            onResize={setWidth}
            onDrag={(w) => columns.current?.style.setProperty("--side-w", `${w}px`)}
            grow="right"
            label="Resize course panel"
            controls="course-panel"
            className="left-full"
          />
        </div>
      )}
      {children}
    </div>
  );
}

export function AppShell() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [collapsed, setCollapsed] = useState(() => readLocal("uh.panel.collapsed", false));
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => writeLocal("uh.panel.collapsed", collapsed), [collapsed]);

  const panelVisible = isDesktop ? !collapsed : drawerOpen;
  const togglePanel = useCallback(() => {
    if (isDesktop) setCollapsed((c) => !c);
    else setDrawerOpen((o) => !o);
  }, [isDesktop]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "[" && !hasModifier(e) && !isTypingTarget(e.target)) {
        e.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel]);

  const showPanel = useCallback(() => setCollapsed(false), []);

  return (
    <PanelSectionProvider panelVisible={isDesktop && !collapsed} showPanel={showPanel}>
      <ToolbarProvider>
        <div className="grid min-h-[100dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] bg-surface">
          <TopBar panelVisible={panelVisible} onTogglePanel={togglePanel} />
          <ShellColumns side={isDesktop && !collapsed ? <SidePanel /> : null}>
            <main id="main" className="min-h-0 min-w-0 overflow-hidden">
              <Outlet />
            </main>
          </ShellColumns>
          <ActivityBar />
        </div>
        <GlobalHosts />
        {!isDesktop && (
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="w-[min(320px,88vw)] p-0">
              <SheetTitle className="sr-only">Courses</SheetTitle>
              <SheetDescription className="sr-only">Browse and search your courses</SheetDescription>
              <div id="course-panel" className="h-full" onClickCapture={(e) => {
                if ((e.target as HTMLElement).closest("a")) setDrawerOpen(false);
              }}>
                <CoursePanelSlot />
              </div>
            </SheetContent>
          </Sheet>
        )}
      </ToolbarProvider>
    </PanelSectionProvider>
  );
}
