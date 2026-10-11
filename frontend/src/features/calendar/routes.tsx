import { Navigate, type RouteObject } from "react-router";
import { registerPanelAction } from "@/app/shell/registry";
import { NewClassButton } from "@/features/classes/NewClassButton";
import { NewClassDialog } from "@/features/classes/NewClassDialog";
import { DeleteSessionFlow } from "@/features/classes/DeleteSessionFlow";
import { EditSessionFlow } from "@/features/classes/EditSessionFlow";
import { DeleteSessionAction, EditSessionAction } from "@/features/classes/SessionActions";
import { registerSessionAction } from "@/features/classes/session-actions";
import { SessionDetailsRoute } from "@/features/classes/SessionDetails";
import { NewEventButton } from "@/features/events/NewEventButton";
import { calendarOverlayRoutes as eventOverlayRoutes } from "@/features/events/routes";
import { CalendarLayout } from "./CalendarLayout";

registerPanelAction({ id: "new-class", slot: "courses-heading", component: NewClassButton, priority: 0 });
registerPanelAction({ id: "new-event", slot: "courses-heading", component: NewEventButton, priority: 1 });
registerSessionAction({ id: "edit", component: EditSessionAction, priority: 1 });
registerSessionAction({ id: "delete", component: DeleteSessionAction, priority: 2 });

export const routes: RouteObject[] = [
  {
    element: <CalendarLayout />,
    children: [
      { path: "calendar/:view?/:date?", element: null },
      { path: "classes/new", element: <NewClassDialog /> },
      ...eventOverlayRoutes,
      { path: "sessions/:sessionKey", element: <SessionDetailsRoute /> },
      { path: "sessions/:sessionKey/edit", element: <EditSessionFlow /> },
      { path: "sessions/:sessionKey/delete", element: <DeleteSessionFlow /> },
    ],
  },
];

export const fallbackRoutes: RouteObject[] = [{ path: "calendar/*", element: <Navigate to="/calendar" replace /> }];
