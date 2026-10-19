/**
 * 012 R10: "/" and the calendar's URLs (`/calendar/:view?/:date?` and its overlay routes) are one
 * layout route rendering the home page, so moving between them keeps the panels mounted.
 */
import type { RouteObject } from "react-router";
import { calendarChildRoutes } from "@/features/calendar/routes";
import "@/features/tasks/routes";
import { HomeLayout } from "./HomeLayout";

export const routes: RouteObject[] = [
  {
    element: <HomeLayout />,
    children: [{ index: true, element: null }, ...calendarChildRoutes],
  },
];
