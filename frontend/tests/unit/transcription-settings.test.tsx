import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { TranscriptionSettingsPage } from "@/features/settings/transcription/TranscriptionSettings";
import { json, mockFetch, on, problem, renderWithProviders } from "./test-utils";

const PROVIDERS = [
  { id: "voice-studio", name: "Voice Studio", maxUploadBytes: null, fields: [
    { key: "address", label: "Server address", kind: "url", required: true, placeholder: "http://localhost:8000" },
    { key: "model", label: "Model", kind: "text", required: false, placeholder: "whisper-1" },
  ] },
  { id: "openai-compatible", name: "OpenAI-compatible", maxUploadBytes: 26214400, fields: [
    { key: "address", label: "Server address", kind: "url", required: true, placeholder: null },
    { key: "apiKey", label: "API key", kind: "secret", required: true, placeholder: null },
    { key: "model", label: "Model", kind: "text", required: true, placeholder: "whisper-1" },
  ] },
];

const SECRETS_OK = { store: "os_key_store", protectionNote: null, readable: true, unreadableSecrets: 0, migration: "done", migrationMessage: null };

const provider = (id: string, over: Record<string, unknown> = {}) => ({
  providerId: id, values: {}, secret: { configured: false, last4: null }, status: "not_configured", lastError: null, testedAt: null, ...over,
});

function api(settings: Record<string, unknown> = {}, extra: Parameters<typeof on>[] = []) {
  const body = {
    activeProviderId: null,
    defaultLanguage: "auto",
    providers: [provider("voice-studio"), provider("openai-compatible")],
    ...settings,
  };
  return mockFetch(
    on("GET", "/api/v1/transcription/providers", () => json(PROVIDERS)),
    on("GET", "/api/v1/settings/transcription", () => json(body)),
    ...extra.map((a) => on(...a)),
    on("GET", "/api/v1/secrets/status", () => json(SECRETS_OK)), // 014 key protection notice
  );
}

const bodyOf = (calls: { url: URL; init: RequestInit }[], path: string) =>
  JSON.parse(String(calls.filter((c) => c.url.pathname === path && c.init.method !== "GET").at(-1)!.init.body));

describe("Settings → Transcription", () => {
  it("preselects Voice Studio with only its fields, tests and saves", async () => {
    const user = userEvent.setup();
    const { calls } = api({}, [
      ["POST", "/api/v1/settings/transcription/test", () => json({ ok: true, category: null, message: null })],
      ["PUT", "/api/v1/settings/transcription", () => json({ activeProviderId: "voice-studio", defaultLanguage: "auto", providers: [provider("voice-studio", { status: "not_tested", values: { address: "http://localhost:8020" } }), provider("openai-compatible")] })],
    ]);
    const { container } = renderWithProviders(<TranscriptionSettingsPage />);
    expect(await screen.findByRole("radio", { name: /Voice Studio/ })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Server address" })).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.type(screen.getByRole("textbox", { name: "Server address" }), "http://localhost:8020");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection works.")).toBeInTheDocument();
    expect(bodyOf(calls, "/api/v1/settings/transcription/test")).toEqual({ providerId: "voice-studio", values: { address: "http://localhost:8020" }, useSavedKey: false });
    // editing resets the result
    await user.type(screen.getByRole("textbox", { name: "Server address" }), "/");
    expect(screen.queryByText("Connection works.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/settings/transcription")).toEqual({
      activeProviderId: "voice-studio", defaultLanguage: "auto", provider: { providerId: "voice-studio", values: { address: "http://localhost:8020/" } },
    }));
  });

  it("shows test failures and inline address errors", async () => {
    const user = userEvent.setup();
    api({}, [
      ["POST", "/api/v1/settings/transcription/test", () => json({ ok: false, category: "unreachable", message: "The server couldn't be reached." })],
      ["PUT", "/api/v1/settings/transcription", () => problem(422, "invalid_address", "Validation failed", [{ field: "/provider/values/address", code: "invalid_address", message: "Enter a full web address, such as http://localhost:8000." }])],
    ]);
    renderWithProviders(<TranscriptionSettingsPage />);
    const address = await screen.findByRole("textbox", { name: "Server address" });
    await user.type(address, "nope");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("The server couldn't be reached.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Enter a full web address/)).toBeInTheDocument();
    expect(address).toHaveAttribute("aria-invalid", "true");
    expect(address).toHaveAccessibleDescription(/Enter a full web address/);
  });

  it("masks a saved key: Replace, Remove, and keeps it when only the model changes", async () => {
    const user = userEvent.setup();
    const saved = provider("openai-compatible", { values: { address: "https://api.example.com", model: "whisper-1" }, secret: { configured: true, last4: "abcd" }, status: "connected", testedAt: "2026-10-05T07:02:00Z" });
    const { calls } = api({ activeProviderId: "openai-compatible", providers: [provider("voice-studio", { values: { address: "http://studio.lan" } }), saved] }, [
      ["PUT", "/api/v1/settings/transcription", () => json({ activeProviderId: "openai-compatible", defaultLanguage: "auto", providers: [provider("voice-studio"), saved] })],
    ]);
    renderWithProviders(<TranscriptionSettingsPage />);
    expect(await screen.findByLabelText("Saved API key ending in abcd")).toHaveTextContent("••••••••abcd");
    expect(screen.getByText(/^Connected · tested/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sk-/);

    const model = screen.getByRole("textbox", { name: "Model" });
    await user.clear(model);
    await user.type(model, "whisper-large");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/settings/transcription").provider).toEqual({ providerId: "openai-compatible", values: { address: "https://api.example.com", model: "whisper-large" } }));

    await user.click(screen.getByRole("button", { name: "Replace" }));
    const keyInput = screen.getByLabelText("API key");
    expect(keyInput).toHaveAttribute("type", "password");
    expect(keyInput).toHaveValue("");
    await user.type(keyInput, "sk-new-key-1234");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/settings/transcription").provider.apiKey).toBe("sk-new-key-1234"));

    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(screen.getByText("The saved key will be removed when you save.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/settings/transcription").provider.apiKey).toBeNull());
  });

  it("switching providers shows each provider's own saved values", async () => {
    const user = userEvent.setup();
    api({ activeProviderId: "voice-studio", providers: [
      provider("voice-studio", { values: { address: "http://studio.lan:7000" }, status: "not_tested" }),
      provider("openai-compatible", { values: { address: "https://api.example.com", model: "whisper-1" }, secret: { configured: true, last4: "wxyz" }, status: "connected" }),
    ] });
    renderWithProviders(<TranscriptionSettingsPage />);
    expect(await screen.findByRole("textbox", { name: "Server address" })).toHaveValue("http://studio.lan:7000");
    await user.click(screen.getByRole("radio", { name: /OpenAI-compatible/ }));
    expect(screen.getByRole("textbox", { name: "Server address" })).toHaveValue("https://api.example.com");
    expect(screen.getByLabelText("Saved API key ending in wxyz")).toBeInTheDocument();
    const group = screen.getByRole("radiogroup", { name: "Provider" });
    await user.click(within(group).getByRole("radio", { name: /Voice Studio/ }));
    expect(screen.getByRole("textbox", { name: "Server address" })).toHaveValue("http://studio.lan:7000");
  });
});
