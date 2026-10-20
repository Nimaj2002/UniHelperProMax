import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { AiSettingsPage } from "@/features/settings/ai/AiSettings";
import { json, mockFetch, on, problem, renderWithProviders } from "./test-utils";

const LIMITS = { maxAttachments: 10, perFileBytes: {}, perMessageBytes: 1, maxImages: null, maxPdfPages: null, imageTypes: [], audioTypes: [] };
const STYLES = [
  { id: "openai", label: "OpenAI-compatible", exampleBaseUrls: ["http://localhost:11434/v1"], chatPath: "/chat/completions", modelsPath: "/models", keyHeader: "Authorization", defaultCapabilities: { images: true, pdf: false, audio: false }, limits: LIMITS },
  { id: "anthropic", label: "Anthropic", exampleBaseUrls: ["https://api.anthropic.com"], chatPath: "/v1/messages", modelsPath: "/v1/models", keyHeader: "x-api-key", defaultCapabilities: { images: true, pdf: true, audio: false }, limits: LIMITS },
  { id: "gemini", label: "Google Gemini", exampleBaseUrls: ["https://generativelanguage.googleapis.com"], chatPath: "/v1beta/models/{model}:streamGenerateContent", modelsPath: "/v1beta/models", keyHeader: "x-goog-api-key", defaultCapabilities: { images: true, pdf: true, audio: true }, limits: LIMITS },
];
const SECRETS_OK = { store: "os_key_store", protectionNote: null, readable: true, unreadableSecrets: 0, migration: "done", migrationMessage: null };
const SETTINGS = { customInstructions: "", lastModel: null, version: 1 };

const model = (modelId: string, over: Record<string, unknown> = {}) => ({
  id: `id-${modelId}`, modelId, displayName: modelId, capabilities: { images: true, pdf: true, audio: false }, hidden: false, source: "fetched", contextLimit: null, outputLimit: null, ...over,
});
const CLAUDE = {
  id: "ep-1", name: "My Claude", style: "anthropic", baseUrl: "https://api.anthropic.com", locality: "remote", enabled: true,
  key: { configured: true, masked: "••••••••abcd", readable: true }, models: [model("claude-x")], privacyAcknowledged: false, version: 3,
};

function api(endpoints: unknown[] = [], extra: Parameters<typeof on>[] = []) {
  return mockFetch(
    ...extra.map((a) => on(...a)),
    on("GET", "/api/v1/ai/styles", () => json(STYLES)),
    on("GET", "/api/v1/ai/endpoints", () => json(endpoints)),
    on("GET", "/api/v1/ai/settings", () => json(SETTINGS)),
    on("GET", "/api/v1/secrets/status", () => json(SECRETS_OK)),
  );
}

const last = (calls: { url: URL; init: RequestInit }[], path: string, method = "POST") =>
  calls.filter((c) => c.url.pathname === path && c.init.method === method).at(-1);
const bodyOf = (calls: { url: URL; init: RequestInit }[], path: string, method = "POST") =>
  JSON.parse(String(last(calls, path, method)!.init.body));

describe("Settings → AI", () => {
  it("starts empty, adds an endpoint with a normalised URL, tests, refreshes and saves", async () => {
    const user = userEvent.setup();
    const saved = { ...CLAUDE, id: "ep-2", name: "Workstation", style: "openai", baseUrl: "http://localhost:8021/v1", locality: "local", key: { configured: false, masked: null, readable: true }, models: [model("echo", { capabilities: { images: true, pdf: false, audio: false } })], version: 1 };
    const { calls } = api([], [
      ["POST", "/api/v1/ai/base-url/check", () => json({ baseUrl: "http://localhost:8021/v1", removedPath: "/chat/completions", locality: "local" })],
      ["POST", "/api/v1/ai/endpoints/test", () => json({ outcome: "working", message: "Connected. The endpoint answered.", modelCount: 2 })],
      ["POST", "/api/v1/ai/endpoints/models/discover", () => json({ outcome: "working", message: null, models: [
        { modelId: "echo", displayName: "echo", capabilities: { images: true, pdf: false, audio: false }, hidden: false, source: "fetched" },
        { modelId: "slow", displayName: "slow", capabilities: { images: true, pdf: false, audio: false }, hidden: false, source: "fetched" },
      ] })],
      ["POST", "/api/v1/ai/endpoints", () => json(saved, 201)],
    ]);
    const { container } = renderWithProviders(<AiSettingsPage />);
    expect(await screen.findByText(/No endpoints yet/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Add endpoint" }));
    expect(screen.getByRole("radio", { name: /OpenAI-compatible/ })).toBeChecked();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Workstation");
    await user.type(screen.getByRole("textbox", { name: "Base URL" }), "http://localhost:8021/v1/chat/completions/");
    expect(await screen.findByText("Removed /chat/completions — the app adds it")).toBeInTheDocument();
    expect(screen.getByText("Local", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(screen.getByLabelText("API key (optional for local endpoints)")).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Test connection" }));
    const status = await screen.findByText(/Connected\. The endpoint answered\./);
    expect(status.closest("[data-outcome]")).toHaveAttribute("data-outcome", "working");
    expect(bodyOf(calls, "/api/v1/ai/endpoints/test")).toEqual({ style: "openai", baseUrl: "http://localhost:8021/v1/chat/completions/" });
    // an edit clears the result
    await user.type(screen.getByRole("textbox", { name: "Name" }), "!");
    expect(screen.queryByText(/Connected\. The endpoint answered\./)).not.toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Workstation");

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Found 2 models, 2 new.")).toBeInTheDocument();
    const slowName = screen.getAllByRole("textbox", { name: "Display name" })[1];
    await user.clear(slowName);
    await user.type(slowName, "Slow one");
    await user.click(screen.getByRole("button", { name: "Refresh" })); // keeps local edits
    expect(await screen.findByText("Found 2 models, none new.")).toBeInTheDocument();
    expect(screen.getAllByRole("textbox", { name: "Display name" })[1]).toHaveValue("Slow one");
    await user.click(screen.getByRole("button", { name: "Remove slow" }));
    expect(screen.getAllByRole("textbox", { name: "Display name" })).toHaveLength(1);
    expect(calls.some((c) => c.init.method !== "GET" && c.url.pathname === "/api/v1/ai/endpoints")).toBe(false); // nothing saved yet

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/ai/endpoints")).toEqual({
      name: "Workstation", style: "openai", baseUrl: "http://localhost:8021/v1/chat/completions/", enabled: true,
      models: [{ modelId: "echo", displayName: "echo", capabilities: { images: true, pdf: false, audio: false }, hidden: false, source: "fetched" }],
    }));
    const row = (await screen.findByText("http://localhost:8021/v1")).closest("li")!;
    expect(within(row).getByText("Local")).toBeInTheDocument();
    expect(within(row).getByText("OpenAI-compatible")).toBeInTheDocument();
  }, 20_000); // many interactions; slow under a full parallel run

  it("shows the https error inline and each Test outcome distinctly", async () => {
    const user = userEvent.setup();
    const outcomes = [
      { outcome: "key_rejected", message: "The API key was rejected." },
      { outcome: "unreachable", message: "The endpoint couldn't be reached.", hint: "Start the local server and try again." },
      { outcome: "not_this_style", message: "The address answered, but it doesn't look like this request style.", looksLike: "gemini" },
    ];
    api([], [
      ["POST", "/api/v1/ai/base-url/check", () => problem(422, "validation_error", "Validation failed", [{ field: "/baseUrl", code: "https_required", message: "Use https:// for this address. Only addresses on this computer or your local network may use plain http://." }])],
      ["POST", "/api/v1/ai/endpoints/test", () => json(outcomes.shift())],
    ]);
    renderWithProviders(<AiSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Add endpoint" }));
    const url = screen.getByRole("textbox", { name: "Base URL" });
    await user.type(url, "http://example.com");
    expect(await screen.findByText(/Use https:\/\/ for this address/)).toBeInTheDocument();
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(url).toHaveAccessibleDescription(/Use https:\/\//);

    const test = screen.getByRole("button", { name: "Test connection" });
    const outcome = () => document.querySelector("[data-outcome]");
    await user.click(test);
    await waitFor(() => expect(outcome()).toHaveAttribute("data-outcome", "key_rejected"));
    expect(screen.getByText("Key rejected.")).toBeInTheDocument();
    await user.click(test);
    await waitFor(() => expect(outcome()).toHaveAttribute("data-outcome", "unreachable"));
    expect(screen.getByText("Address unreachable.")).toBeInTheDocument();
    expect(screen.getByText("Start the local server and try again.")).toBeInTheDocument();
    await user.click(test);
    await waitFor(() => expect(outcome()).toHaveAttribute("data-outcome", "not_this_style"));
    expect(screen.getByText(/It looks like Google Gemini\./)).toBeInTheDocument();
  }, 20_000);

  it("edits a saved key with Remove → Undo, disables Anthropic audio, toggles and confirms delete", async () => {
    const user = userEvent.setup();
    const { calls } = api([CLAUDE], [
      ["POST", "/api/v1/ai/base-url/check", () => json({ baseUrl: "https://api.anthropic.com", removedPath: null, locality: "remote" })],
      ["PATCH", "/api/v1/ai/endpoints/ep-1", () => json({ ...CLAUDE, enabled: false, version: 4 })],
      ["DELETE", "/api/v1/ai/endpoints/ep-1", () => new Response(null, { status: 204 })],
    ]);
    const { container } = renderWithProviders(<AiSettingsPage />);
    const row = (await screen.findByText("My Claude")).closest("li")!;
    expect(within(row).getByText("Remote")).toBeInTheDocument();

    await user.click(within(row).getByRole("button", { name: "Edit My Claude" }));
    expect(screen.getByLabelText("Saved API key ending in abcd")).toHaveTextContent("••••••••abcd");
    expect(document.body.textContent).not.toMatch(/sk-/);
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.getByText("The saved key will be removed when you save.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByLabelText("Saved API key ending in abcd")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByRole("button", { name: "Keep saved key" })).toBeInTheDocument();

    const audio = screen.getByRole("switch", { name: "Audio" });
    expect(audio).toBeDisabled();
    expect(audio).toHaveAccessibleDescription("Anthropic doesn't accept audio");
    expect(screen.getByRole("switch", { name: "PDF documents" })).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("switch", { name: "Enable My Claude" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/ai/endpoints/ep-1", "PATCH")).toEqual({ enabled: false }));
    expect(new Headers(last(calls, "/api/v1/ai/endpoints/ep-1", "PATCH")!.init.headers).get("If-Match")).toBe('"3"');

    await user.click(screen.getByRole("button", { name: "Delete My Claude" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Delete "My Claude"?')).toBeInTheDocument();
    expect(within(dialog).getByText("Chats that used it keep their history.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(last(calls, "/api/v1/ai/endpoints/ep-1", "DELETE")).toBeTruthy());
    expect(new Headers(last(calls, "/api/v1/ai/endpoints/ep-1", "DELETE")!.init.headers).get("If-Match")).toBe('"4"');
    expect(await screen.findByText(/No endpoints yet/)).toBeInTheDocument();
  }, 20_000);

  it("sends apiKey null when the saved key is removed", async () => {
    const user = userEvent.setup();
    const { calls } = api([CLAUDE], [
      ["POST", "/api/v1/ai/base-url/check", () => json({ baseUrl: "https://api.anthropic.com", removedPath: null, locality: "remote" })],
      ["PATCH", "/api/v1/ai/endpoints/ep-1", () => json({ ...CLAUDE, key: { configured: false, masked: null, readable: true }, version: 4 })],
    ]);
    renderWithProviders(<AiSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit My Claude" }));
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(bodyOf(calls, "/api/v1/ai/endpoints/ep-1", "PATCH")).toMatchObject({ name: "My Claude", style: "anthropic", apiKey: null }));
  }, 20_000);

  it("saves the custom instructions with the settings' version (FR-060)", async () => {
    const user = userEvent.setup();
    const { calls } = api([], [["PUT", "/api/v1/ai/settings", (_u, init) => json({ ...SETTINGS, ...JSON.parse(String(init.body)), version: 2 })]]);
    renderWithProviders(<AiSettingsPage />);
    const box = await screen.findByRole("textbox", { name: "Custom instructions" });
    await waitFor(() => expect(box).toBeEnabled());
    const save = screen.getByRole("button", { name: "Save instructions" });
    expect(save).toBeDisabled();
    await user.type(box, "Answer briefly.");
    expect(screen.getByText("15 / 8,000")).toBeInTheDocument();
    await user.click(save);
    await waitFor(() => expect(bodyOf(calls, "/api/v1/ai/settings", "PUT")).toEqual({ customInstructions: "Answer briefly." }));
    expect(new Headers(last(calls, "/api/v1/ai/settings", "PUT")!.init.headers).get("If-Match")).toBe('"1"');
    await waitFor(() => expect(save).toBeDisabled());
    expect(box).toHaveValue("Answer briefly.");
  }, 20_000);

  it("shows more than five models as a compact, filterable list that opens a row to edit it", async () => {
    const user = userEvent.setup();
    const many = { ...CLAUDE, models: ["a", "b", "c", "d", "e", "f"].map((x) => model(`claude-${x}`)) };
    api([many], [["POST", "/api/v1/ai/base-url/check", () => json({ baseUrl: "https://api.anthropic.com", removedPath: null, locality: "remote" })]]);
    renderWithProviders(<AiSettingsPage />);
    await user.click(await screen.findByRole("button", { name: "Edit My Claude" }));
    const list = screen.getByRole("list", { name: "Models" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(within(list).queryByLabelText("Display name")).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Filter models" }), "claude-c");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    const row = within(list).getByRole("button", { name: /claude-c/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    await user.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(within(list).getByLabelText("Display name")).toHaveValue("claude-c");
  }, 20_000);
});
