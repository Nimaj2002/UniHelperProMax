/**
 * 026: the Simple interface: one sidebar and one main area over the same routes as Ultimate. The
 * session panel a session page registers is never shown here; the sidebar's session tools open its
 * sections in the main area. The sidebar's width is the user's to resize.
 */
import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router";
import { ActivityPills } from "@/app/shell/ActivityPills";
import { focusSheet, GlobalHosts, OVERLAY_CARD, returnFocus } from "@/app/shell/AppShell";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";
import { Card } from "@/app/shell/Card";
import { SHOW_LEFT_ID, useLayout } from "@/app/shell/layout";
import { CreditStrip } from "@/app/shell/MadeBy";
import { PanelSectionProvider } from "@/app/shell/panelSection";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { readLocal, writeLocal } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { SimpleSidebar } from "./SimpleSidebar";

const COLLAPSED_KEY = "uh.simple.sidebarCollapsed";
const WIDTH_KEY = "uh.simple.sidebarWidth";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const SIDEBAR_DEFAULT = 256;
const SIDEBAR_W = `${SIDEBAR_DEFAULT}px`;
const RAIL_W = "3.5rem";

export function SimpleShell() {
  const layout = useLayout();
  const { mode, overlay, setOverlay, setRightDockable, bareMain, creditStrip, focus } = layout;
  const [collapsed, setCollapsed] = useState(() => readLocal(COLLAPSED_KEY, false));
  useEffect(() => writeLocal(COLLAPSED_KEY, collapsed), [collapsed]);
  const [width, setWidth] = useState(() => {
    const w = readLocal<unknown>(WIDTH_KEY, SIDEBAR_DEFAULT);
    return typeof w === "number" && w >= SIDEBAR_MIN && w <= SIDEBAR_MAX ? w : SIDEBAR_DEFAULT;
  });
  useEffect(() => writeLocal(WIDTH_KEY, width), [width]);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => setRightDockable(false), [setRightDockable]); // no right panel here: session tools open in the main area
  useEffect(() => {
    document.documentElement.dataset.shell = "";
    return () => {
      delete document.documentElement.dataset.shell;
    };
  }, []);
  const docked = mode === "docked" && !focus;

  return (
    <PanelSectionProvider panelVisible={docked ? true : overlay === "left"} showPanel={layout.showLeft}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-background focus:px-3 focus:py-2">
        Skip to main content
      </a>
      <div
        ref={grid}
        className="grid h-dvh gap-2 overflow-hidden bg-surface p-2 pt-[max(0.5rem,var(--titlebar-h,0px))]"
        style={{ gridTemplateColumns: docked ? `${collapsed ? RAIL_W : "var(--sidebar-w)"} minmax(0,1fr)` : "minmax(0,1fr)", "--sidebar-w": `${width}px` } as React.CSSProperties}
      >
        {docked && (
          <div className="relative h-full min-h-0">
            <Card as="div" id="simple-sidebar" body="fill" className="h-full min-h-0">
              <SimpleSidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((c) => !c)} />
            </Card>
            {!collapsed && (
              <PanelResizeHandle
                value={width}
                min={SIDEBAR_MIN}
                max={SIDEBAR_MAX}
                defaultValue={SIDEBAR_DEFAULT}
                onResize={setWidth}
                onDrag={(w) => grid.current?.style.setProperty("--sidebar-w", `${w}px`)}
                grow="right"
                label="Resize sidebar"
                controls="simple-sidebar"
                className="left-[calc(100%-4px)]"
              />
            )}
          </div>
        )}
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <Card as="main" id="main" label="Workspace" body="fill" chrome={!bareMain} className="@container/main min-h-0 flex-1">
            <div className={cn("flex min-h-0 min-w-0 flex-1", bareMain ? "h-full flex-row gap-2" : "flex-col")}>
              <Outlet />
            </div>
            <ActivityPills />
          </Card>
          {creditStrip && !focus && <CreditStrip />}
        </div>
      </div>
      <GlobalHosts />

      {mode === "overlay" && (
        <Sheet open={overlay === "left"} onOpenChange={(o) => !o && setOverlay("none")}>
          <SheetContent side="left" showCloseButton={false} onOpenAutoFocus={focusSheet} onCloseAutoFocus={returnFocus(SHOW_LEFT_ID)} className={cn(OVERLAY_CARD, "left-2")} style={{ width: `min(${SIDEBAR_W}, calc(100vw - 1rem))` }}>
            <SheetTitle className="sr-only">Sidebar</SheetTitle>
            <SheetDescription className="sr-only">Calendar, courses, tasks and settings</SheetDescription>
            <Card as="div" body="fill" className="h-full">
              <SimpleSidebar onNavigate={() => setOverlay("none")} />
            </Card>
          </SheetContent>
        </Sheet>
      )}
    </PanelSectionProvider>
  );
}
