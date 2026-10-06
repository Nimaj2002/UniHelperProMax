/**
 * Feature route modules composed under the shell (contracts/ui-shell.md). Each feature
 * exports `routes` and may register shell extensions as a side effect of import.
 */
import type { RouteObject } from "react-router";
import { shellRoutes as authShellRoutes } from "@/features/auth/routes";
import { routes as adminRoutes } from "@/features/admin/routes";
import { routes as calendarRoutes } from "@/features/calendar/routes";
import { routes as courseRoutes } from "@/features/courses/routes";
import "@/features/recordings/routes";
import { routes as sessionRoutes } from "@/features/sessions/routes";
import { routes as settingsRoutes } from "@/features/settings/routes";
import "@/features/transcription/routes";

export const featureRoutes: RouteObject[] = [
  ...authShellRoutes,
  ...calendarRoutes,
  ...courseRoutes,
  ...sessionRoutes,
  ...settingsRoutes,
  ...adminRoutes,
];
