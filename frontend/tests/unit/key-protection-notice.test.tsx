import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { KeyProtectionNotice } from "@/features/settings/KeyProtectionNotice";
import { json, mockFetch, on, renderWithProviders } from "./test-utils";

const status = (over: Record<string, unknown> = {}) => ({
  store: "os_key_store", protectionNote: null, readable: true, unreadableSecrets: 0, migration: "done", migrationMessage: null, ...over,
});
const NOTE = "Keys are encrypted, but the encryption key is kept in a file in your user profile. Anyone who can sign in to this computer as you can read your keys.";

describe("KeyProtectionNotice (014 T026)", () => {
  it("says nothing extra with the OS key store", async () => {
    mockFetch(on("GET", "/api/v1/secrets/status", () => json(status())));
    const { container } = renderWithProviders(<KeyProtectionNotice />);
    await waitFor(() => expect(container.querySelector("p, [role=alert]")).toBeNull());
  });

  it("states the weaker protection of a key file", async () => {
    mockFetch(on("GET", "/api/v1/secrets/status", () => json(status({ store: "key_file", protectionNote: NOTE }))));
    const { container } = renderWithProviders(<KeyProtectionNotice />);
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains a failed migration", async () => {
    const message = "Saved transcription keys couldn't be moved into the encrypted store. Nothing was changed; the app will try again at the next start.";
    mockFetch(on("GET", "/api/v1/secrets/status", () => json(status({ migration: "failed", migrationMessage: message }))));
    renderWithProviders(<KeyProtectionNotice />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be moved");
  });

  it("offers a new key store when keys can't be read", async () => {
    const { calls } = mockFetch(
      on("GET", "/api/v1/secrets/status", () => json(status({ readable: false, unreadableSecrets: 2 }))),
      on("POST", "/api/v1/secrets/reset", () => json(status())),
    );
    const { container } = renderWithProviders(<KeyProtectionNotice />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved keys can't be read on this computer. Enter them again.");
    expect(screen.getByRole("alert")).toHaveTextContent("2 saved keys affected");
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole("button", { name: "Start a new key store" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Notes, recordings, chats and all other data stay as they are.");
    await userEvent.click(screen.getAllByRole("button", { name: "Start a new key store" }).at(-1)!);
    await waitFor(() => expect(calls.some((c) => c.url.pathname === "/api/v1/secrets/reset")).toBe(true));
    const reset = calls.find((c) => c.url.pathname === "/api/v1/secrets/reset")!;
    expect(JSON.parse(String(reset.init.body))).toEqual({ confirm: true });
    await waitFor(() => expect(screen.queryByText(/can't be read/)).toBeNull());
  });
});
