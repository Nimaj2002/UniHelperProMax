/**
 * 012 R10: "/" and the calendar's URLs (`/calendar/:view?/:date?` and its overlay routes) are one
 * layout route rendering the home page, so moving between them keeps the panels mounted.
 * 026: Simple renders the calendar alone there, and has its own `/tasks` page.
 */
import type { RouteObject } from "react-router";
import { calendarChildRoutes } from "@/features/calendar/routes";
import "@/features/tasks/routes";
import { HomeLayout } from "./HomeLayout";
import { SimpleTasks } from "./SimpleHome";

export const routes: RouteObject[] = [
  {
    element: <HomeLayout />,
    children: [{ index: true, element: null }, ...calendarChildRoutes],
  },
  { path: "tasks", element: <SimpleTasks /> },
];
