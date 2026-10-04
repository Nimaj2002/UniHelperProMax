import type { RouteObject } from "react-router";
import { registerAccountMenu } from "./AccountMenu";
import { ChangePasswordPage } from "./ChangePasswordPage";
import { LoginPage } from "./LoginPage";
import { SetupPage } from "./SetupPage";

registerAccountMenu();

/** Routes outside the authenticated shell. */
export const publicRoutes: RouteObject[] = [
  { path: "/setup", element: <SetupPage /> },
  { path: "/login", element: <LoginPage /> },
];

/** Routes inside the shell. */
export const shellRoutes: RouteObject[] = [{ path: "account/password", element: <ChangePasswordPage /> }];
