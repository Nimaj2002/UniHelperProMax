import { createBrowserRouter, type RouteObject } from "react-router";
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
      // "/" is the home page (features/home/routes.tsx, 012)
      ...featureRoutes,
      { path: "*", element: <NotFound /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(routes);
}
