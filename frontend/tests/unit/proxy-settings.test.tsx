import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { ProxySettingsPage } from "@/features/settings/proxy/ProxySettings";
import { UseProxySwitch } from "@/features/settings/UseProxySwitch";
import { json, mockFetch, on, problem, renderWithProviders } from "./test-utils";

const SAVED = {
  scheme: "socks5", host: "proxy.example.com", port: 1080, username: "me",
  password: { configured: true, last4: "wxyz", readable: true }, version: 3, updatedAt: "2026-11-05T10:00:00+00:00",
};

const bodyOf = (calls: { url: URL; init: RequestInit }[], path: string, method: string) =>
  JSON.parse(String(calls.filter((c) => c.url.pathname === path && c.init.method === method).at(-1)!.init.body));

describe("Settings → Proxy (021 US1)", () => {
  it("starts empty, validates inline, tests and saves", async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch(
      on("GET", "/api/v1/settings/proxy", () => json({ proxy: null, usedBy: [] })),
      on("POST", "/api/v1/settings/proxy/test", () => json({ outcome: "unreachable", message: "Couldn't reach the proxy." })),
      on("PUT", "/api/v1/settings/proxy", () => json({ proxy: { ...SAVED, scheme: "http", port: 8080, username: null }, usedBy: [] })),
    );
    const { container } = renderWithProviders(<ProxySettingsPage />);
    const host = await screen.findByRole("textbox", { name: "Host" });
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("HTTP");
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("type", "password");
    expect(screen.queryByRole("button", { name: "Delete proxy" })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // inline errors, nothing sent
    await user.type(host, "http://x/y");
    await user.type(screen.getByRole("textbox", { name: "Port" }), "70000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Enter only the host name/)).toBeInTheDocument();
    expect(screen.getByText("Enter a port from 1 to 65535.")).toBeInTheDocument();
    expect(host).toHaveAttribute("aria-invalid", "true");
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);

    await user.clear(host);
    await user.type(host, "proxy.example.com");
    const port = screen.getByRole("textbox", { name: "Port" });
    await user.clear(port);
    await user.type(port, "8080");
    await user.type(screen.getByLabelText(/^Password/), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Test proxy" }));
    expect(await screen.findByText("Couldn't reach the proxy.")).toBeInTheDocument();
    expect(bodyOf(calls, "/api/v1/settings/proxy/test", "POST")).toEqual({
      scheme: "http", host: "proxy.example.com", port: 8080, username: null, password: "secret-pass", useSavedPassword: false,
    });

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/settings/proxy", "PUT")).toEqual({
      scheme: "http", host: "proxy.example.com", port: 8080, username: null, password: "secret-pass",
    }));
  });

  it("shows the saved password masked, keeps it on save, and deletes after confirming", async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch(
      on("GET", "/api/v1/settings/proxy", () => json({ proxy: SAVED, usedBy: ["transcription", "ai"] })),
      on("PUT", "/api/v1/settings/proxy", () => json({ proxy: SAVED, usedBy: ["transcription", "ai"] })),
      on("DELETE", "/api/v1/settings/proxy", () => json({ disabledSections: ["transcription", "ai"] })),
    );
    renderWithProviders(<ProxySettingsPage />);
    expect(await screen.findByLabelText("Saved password ending in wxyz")).toHaveTextContent("••••••••wxyz");
    expect(screen.getByText("In use by Transcription and AI.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(calls.some((c) => c.init.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.init.method === "PUT")!;
    expect(JSON.parse(String(put.init.body))).not.toHaveProperty("password"); // absent = keep
    expect(new Headers(put.init.headers).get("If-Match")).toBe('"3"');

    await user.click(screen.getByRole("button", { name: "Delete proxy" }));
    expect(await screen.findByText("Transcription and AI will connect directly again.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(calls.some((c) => c.init.method === "DELETE")).toBe(true));
  });

  it("splits a whole proxy address typed into Host into the fields", async () => {
    const user = userEvent.setup();
    mockFetch(on("GET", "/api/v1/settings/proxy", () => json({ proxy: null, usedBy: [] })));
    renderWithProviders(<ProxySettingsPage />);
    const host = await screen.findByRole("textbox", { name: "Host" });
    await user.type(host, "socks5://me:p%40ss@127.0.0.1:10808");
    await user.tab();
    expect(host).toHaveValue("127.0.0.1");
    expect(screen.getByRole("textbox", { name: "Port" })).toHaveValue("10808");
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveTextContent("SOCKS5");
    expect(screen.getByRole("textbox", { name: /Username/ })).toHaveValue("me");
    expect(screen.getByLabelText(/^Password/)).toHaveValue("p@ss");
  });

  it("shows server field errors next to the field", async () => {
    const user = userEvent.setup();
    mockFetch(
      on("GET", "/api/v1/settings/proxy", () => json({ proxy: null, usedBy: [] })),
      on("PUT", "/api/v1/settings/proxy", () =>
        problem(422, "invalid_host", "Validation failed", [{ field: "/host", code: "invalid_host", message: "Server says no." }])),
    );
    renderWithProviders(<ProxySettingsPage />);
    await user.type(await screen.findByRole("textbox", { name: "Host" }), "bad_host");
    await user.type(screen.getByRole("textbox", { name: "Port" }), "8080");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Server says no.")).toBeInTheDocument();
  });
});

describe("Use proxy switch (021 US2/US3)", () => {
  it("is off and disabled with a link when no proxy is saved", async () => {
    mockFetch(on("GET", "/api/v1/settings/proxy", () => json({ proxy: null, usedBy: [] })));
    const { container } = renderWithProviders(<UseProxySwitch id="t" checked onCheckedChange={() => {}} what="requests" />);
    expect(await screen.findByRole("link", { name: "Add a proxy first" })).toHaveAttribute("href", "/settings/proxy");
    const toggle = screen.getByRole("switch", { name: "Use proxy" });
    expect(toggle).toBeDisabled();
    expect(toggle).not.toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("is enabled when a proxy is saved and mentions the local bypass", async () => {
    const user = userEvent.setup();
    mockFetch(on("GET", "/api/v1/settings/proxy", () => json({ proxy: SAVED, usedBy: [] })));
    const changes: boolean[] = [];
    renderWithProviders(<UseProxySwitch id="t" checked={false} onCheckedChange={(v) => changes.push(v)} what="requests" />);
    expect(await screen.findByText(/always connect directly/)).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "Use proxy" });
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(toggle);
    expect(changes).toEqual([true]);
  });
});
