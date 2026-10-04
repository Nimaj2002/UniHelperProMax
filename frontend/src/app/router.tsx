import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { publicRoutes } from "@/features/auth/routes";
import { featureRoutes } from "./features";
import { AppShell } from "./shell/AppShell";
import { NotFound } from "./NotFound";

export const routes: RouteObject[] = [
  ...publicRoutes,
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/calendar" replace /> },
      ...featureRoutes,
      { path: "*", element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
