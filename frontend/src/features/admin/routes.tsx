import type { RouteObject } from "react-router";
import { AccountsPage } from "./AccountsPage";

export const routes: RouteObject[] = [{ path: "admin/accounts", element: <AccountsPage /> }];
