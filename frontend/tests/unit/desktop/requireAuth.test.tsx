import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { AccountSettings } from "@/features/settings/account/AccountSettings";
import { json, mockFetch, on, problem, renderRoutes } from "../test-utils";

const me = { id: "u1", username: "student", role: "owner", mustChangePassword: false, timezone: "UTC" };

const routes = [
  { path: "/login", element: <p>login page</p> },
  { path: "/setup", element: <p>setup page</p> },
  { path: "/calendar", element: <RequireAuth><p>calendar page</p></RequireAuth> },
  { path: "/settings/account", element: <AccountSettings /> },
];

afterEach(() => vi.unstubAllGlobals());

describe("desktop single-user mode (015)", () => {
  it("opens the app without a login screen in desktop mode", async () => {
    mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: false, mode: "desktop" })),
      on("GET", "/api/v1/auth/me", () => json(me)),
    );
    renderRoutes(routes, "/calendar");
    expect(await screen.findByText("calendar page")).toBeInTheDocument();
  });

  it("still sends a signed-out web user to the login page", async () => {
    mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: false, mode: "web" })),
      on("GET", "/api/v1/auth/me", () => problem(401, "unauthorized")),
    );
    renderRoutes(routes, "/calendar");
    expect(await screen.findByText("login page")).toBeInTheDocument();
  });

  it("hides password, accounts and sign-out in the desktop Account settings", async () => {
    mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: false, mode: "desktop" })),
      on("GET", "/api/v1/auth/me", () => json(me)),
    );
    renderRoutes(routes, "/settings/account");
    expect(await screen.findByText("Time zone")).toBeInTheDocument();
    // the mode arrives with /setup/status (in the app it is already cached by RequireAuth)
    await waitFor(() => expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull());
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage accounts" })).toBeNull();
  });

  it("keeps them in the web build", async () => {
    mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: false, mode: "web" })),
      on("GET", "/api/v1/auth/me", () => json(me)),
    );
    renderRoutes(routes, "/settings/account");
    expect(await screen.findByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
  });
});
