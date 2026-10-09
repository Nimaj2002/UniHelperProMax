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
import { CollapsibleSection, PanelSectionProvider, usePanelSectionSlot } from "./panelSection";
import { useGlobalHosts } from "./registry";
import { TopBar } from "./TopBar";
import { ToolbarProvider } from "./toolbar";

const MIN_W = 240;
const MAX_W = 480;
const DEFAULT_W = 280;
const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));
/** Share of an open section in the space it splits with the open section above it (%). */
const PAIR_MIN = 10;
const PAIR_MAX = 90;
const COURSES = { id: "courses", title: "Academic years" };

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
 * Desktop left panel: a stack of collapsible sections — the academic years (courses), then the
 * current page's sections (if any). Open sections share the panel's height; the edge between two
 * open sections resizes them. Positioned to fill its grid cell so long content scrolls inside
 * each section instead of growing the page.
 */
function SidePanel() {
  const { sections: pageSections, setTarget, collapsed, setCollapsed } = usePanelSectionSlot();
  const [weights, setWeights] = useState<Record<string, number>>(() => readLocal("uh.panel.sectionWeights", {}));
  useEffect(() => writeLocal("uh.panel.sectionWeights", weights), [weights]);
  // section elements, for live resizing; stable ref callbacks per section
  const [elements] = useState(() => new Map<string, HTMLElement>());
  const [refs] = useState(() => new Map<string, { section: (el: HTMLElement | null) => void; body: (el: HTMLDivElement | null) => void }>());
  const refsFor = (id: string) => {
    let r = refs.get(id);
    if (!r) {
      r = {
        section: (el) => void (el ? elements.set(id, el) : elements.delete(id)),
        body: (el) => setTarget(id, el),
      };
      refs.set(id, r);
    }
    return r;
  };
  const sections = [COURSES, ...pageSections];
  const weight = (id: string) => weights[id] ?? 1;
  let previousOpen: string | null = null;
  return (
    <aside
      id="course-panel"
      aria-label="Side panel"
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden border-r border-divider bg-surface"
    >
      {sections.map(({ id, title }, i) => {
        const isCollapsed = collapsed[id] ?? false;
        const above = isCollapsed ? null : previousOpen;
        if (!isCollapsed) previousOpen = id;
        const pair = () => weight(id) + (above ? weight(above) : 0);
        const share = above ? Math.round((100 * weight(id)) / pair()) : 0;
        const bodyId = `panel-section-${id}-body`;
        return (
          <CollapsibleSection
            key={id}
            id={id}
            title={title}
            collapsed={isCollapsed}
            onToggle={() => setCollapsed([id], !isCollapsed)}
            sectionRef={refsFor(id).section}
            bodyRef={id === COURSES.id ? undefined : refsFor(id).body}
            bodyClassName={id === COURSES.id ? "overflow-hidden" : "overflow-x-hidden overflow-y-auto"}
            className={cn(i > 0 && "border-t border-divider", isCollapsed && "shrink-0")}
            style={isCollapsed ? undefined : { flex: `${weight(id)} 1 0` }}
            handle={
              above && (
                <PanelResizeHandle
                  value={share}
                  min={PAIR_MIN}
                  max={PAIR_MAX}
                  defaultValue={50}
                  onResize={(p) => {
                    const total = pair();
                    setWeights((w) => ({ ...w, [id]: (total * p) / 100, [above]: (total * (100 - p)) / 100 }));
                  }}
                  onDrag={(p) => {
                    const total = pair();
                    elements.get(id)?.style.setProperty("flex-grow", String((total * p) / 100));
                    elements.get(above)?.style.setProperty("flex-grow", String((total * (100 - p)) / 100));
                  }}
                  grow="up"
                  step={5}
                  unitsPerPx={() => 100 / ((elements.get(id)?.clientHeight ?? 0) + (elements.get(above)?.clientHeight ?? 0) || 1)}
                  label={`Resize ${title.toLowerCase()}`}
                  controls={bodyId}
                  className="top-0"
                />
              )
            }
          >
            {id === COURSES.id && <CoursePanelSlot />}
          </CollapsibleSection>
        );
      })}
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
