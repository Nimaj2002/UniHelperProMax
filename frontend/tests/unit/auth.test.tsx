import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LoginPage } from "@/features/auth/LoginPage";
import { SetupPage } from "@/features/auth/SetupPage";
import { json, mockFetch, on, problem, renderRoutes } from "./test-utils";

const me = { id: "u1", username: "owner", role: "owner", mustChangePassword: false, timezone: "UTC" };

const routes = [
  { path: "/setup", element: <SetupPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/calendar", element: <p>calendar page</p> },
];

afterEach(() => vi.unstubAllGlobals());

describe("SetupPage", () => {
  it("has labelled fields and no axe violations", async () => {
    mockFetch(on("GET", "/api/v1/setup/status", () => json({ needsOwner: true })));
    const { container } = renderRoutes(routes, "/setup");
    expect(await screen.findByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("validates locally and focuses the first error", async () => {
    mockFetch(on("GET", "/api/v1/setup/status", () => json({ needsOwner: true })));
    renderRoutes(routes, "/setup");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Create account" }));
    expect(await screen.findByText(/Use 3–32 lowercase/)).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveFocus();
  });

  it("creates the owner and continues to the calendar", async () => {
    const { calls } = mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: true })),
      on("POST", "/api/v1/setup/owner", () => json(me, 201)),
    );
    renderRoutes(routes, "/setup");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.type(screen.getByLabelText("Confirm password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("calendar page")).toBeInTheDocument();
    const post = calls.find((c) => c.init.method === "POST")!;
    const body = JSON.parse(String(post.init.body));
    expect(body).toMatchObject({ username: "owner", password: "a-long-password" });
    expect(typeof body.timezone).toBe("string");
  });
});

describe("LoginPage", () => {
  it("shows a generic error on 401 and keeps input", async () => {
    mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: false })),
      on("GET", "/api/v1/auth/me", () => problem(401, "unauthorized")),
      on("POST", "/api/v1/auth/login", () => problem(401, "invalid_credentials", "Incorrect username or password.")),
    );
    const { container } = renderRoutes(routes, "/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Incorrect username or password.");
    expect(screen.getByLabelText("Username")).toHaveValue("owner");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(await axe(container)).toHaveNoViolations();
  });

  it("signs in and navigates to the calendar", async () => {
    mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: false })),
      on("GET", "/api/v1/auth/me", () => problem(401, "unauthorized")),
      on("POST", "/api/v1/auth/login", () => json(me)),
    );
    renderRoutes(routes, "/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "owner");
    await user.type(screen.getByLabelText("Password"), "a-long-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("calendar page")).toBeInTheDocument();
  });

  it("offers no registration link", async () => {
    mockFetch(
      on("GET", "/api/v1/setup/status", () => json({ needsOwner: false })),
      on("GET", "/api/v1/auth/me", () => problem(401, "unauthorized")),
    );
    renderRoutes(routes, "/login");
    await screen.findByLabelText("Username");
    expect(screen.queryByRole("link", { name: /sign up|register|create account/i })).toBeNull();
  });
});
