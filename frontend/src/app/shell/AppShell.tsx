import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Outlet } from "react-router";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { readLocal, writeLocal } from "@/lib/storage";
import { hasModifier, isTypingTarget } from "@/lib/shortcuts";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import { ActivityBar } from "./ActivityBar";
import { CoursePanelSlot } from "./CoursePanelSlot";
import { useGlobalHosts } from "./registry";
import { TopBar } from "./TopBar";
import { ToolbarProvider } from "./toolbar";

const MIN_W = 240;
const MAX_W = 360;
const DEFAULT_W = 280;
const clamp = (w: number) => Math.min(MAX_W, Math.max(MIN_W, w));

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

export function AppShell() {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [width, setWidth] = useState(() => clamp(readLocal("uh.panel.width", DEFAULT_W)));
  const [collapsed, setCollapsed] = useState(() => readLocal("uh.panel.collapsed", false));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dragStart = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => writeLocal("uh.panel.width", width), [width]);
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

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragStart.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragStart.current) setWidth(clamp(dragStart.current.w + e.clientX - dragStart.current.x));
  };
  const onPointerUp = () => {
    dragStart.current = null;
  };
  const onSeparatorKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") setWidth((w) => clamp(w - 16));
    else if (e.key === "ArrowRight") setWidth((w) => clamp(w + 16));
    else if (e.key === "Home") setWidth(MIN_W);
    else if (e.key === "End") setWidth(MAX_W);
    else return;
    e.preventDefault();
  };

  return (
    <ToolbarProvider>
      <div className="grid min-h-[100dvh] grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr_auto] bg-surface">
        <TopBar panelVisible={panelVisible} onTogglePanel={togglePanel} />
        <div
          className="grid min-h-0"
          style={{
            gridTemplateColumns: isDesktop && !collapsed ? `${width}px 1px minmax(0,1fr)` : "minmax(0,1fr)",
          }}
        >
          {isDesktop && !collapsed && (
            <>
              <aside
                id="course-panel"
                aria-label="Courses"
                className="min-h-0 overflow-hidden bg-surface"
              >
                <CoursePanelSlot />
              </aside>
              {/* A focusable separator is an ARIA window-splitter widget (keyboard-resizable). */}
              {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize course panel"
                aria-valuemin={MIN_W}
                aria-valuemax={MAX_W}
                aria-valuenow={width}
                tabIndex={0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onKeyDown={onSeparatorKey}
                className={cn(
                  "relative cursor-col-resize bg-divider",
                  "after:absolute after:inset-y-0 after:-left-1.5 after:w-3 after:content-['']",
                  "focus-visible:bg-ring hover:bg-strong-border",
                )}
              />
              {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
            </>
          )}
          <main id="main" className="min-h-0 min-w-0 overflow-hidden">
            <Outlet />
          </main>
        </div>
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
  );
}
