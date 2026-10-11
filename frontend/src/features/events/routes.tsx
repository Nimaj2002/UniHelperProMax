/**
 * Feature 009 wiring: `/events/new` (an overlay of the calendar, mounted by the calendar's layout
 * route) and the semester's Events page and event workspaces.
 */
import { lazy, Suspense } from "react";
import type { RouteObject } from "react-router";
import { EventsPage } from "./EventsPage";
import { NewEventDialog } from "./NewEventDialog";

// CodeMirror only loads when a workspace is opened
const WorkspacePage = lazy(() => import("@/features/sessions/WorkspacePage").then((m) => ({ default: m.WorkspacePage })));

/** Children of the calendar layout (rendered over the calendar, like `/classes/new`). */
export const calendarOverlayRoutes: RouteObject[] = [{ path: "events/new", element: <NewEventDialog /> }];

export const routes: RouteObject[] = [
  { path: "semesters/:semesterId/events", element: <EventsPage /> },
  {
    path: "semesters/:semesterId/events/:sessionKey",
    element: (
      <Suspense fallback={<p role="status" className="p-8 text-sm text-muted-foreground">Opening workspace…</p>}>
        <WorkspacePage />
      </Suspense>
    ),
  },
];
