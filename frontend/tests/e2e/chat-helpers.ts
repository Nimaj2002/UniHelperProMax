/** 014 e2e helpers: AI endpoints seeded through the API against the fake LLM, and the Chat section. */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

const LLM = `http://localhost:${process.env.E2E_LLM_PORT ?? 8021}`;
export const FAKE = { openai: `${LLM}/v1`, anthropic: `${LLM}/anthropic`, gemini: `${LLM}/gemini` } as const;

export async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
}

export interface SeedModel {
  name: string;
  images?: boolean;
  pdf?: boolean;
  audio?: boolean;
  contextLimit?: number;
}

/** Create an endpoint with these models ({modelId: displayName or capabilities}); returns it. */
export async function seedEndpoint(
  page: Page,
  opts: { name: string; style: "openai" | "anthropic" | "gemini"; baseUrl?: string; models: Record<string, string | SeedModel>; apiKey?: string },
) {
  const r = await page.request.post("/api/v1/ai/endpoints", {
    headers: { "X-CSRF-Token": await csrf(page) },
    data: {
      name: opts.name,
      style: opts.style,
      baseUrl: opts.baseUrl ?? FAKE[opts.style],
      apiKey: opts.apiKey ?? "sk-test",
      enabled: true,
      models: Object.entries(opts.models).map(([modelId, m]) => {
        const spec: SeedModel = typeof m === "string" ? { name: m } : m;
        return {
          modelId,
          displayName: spec.name,
          capabilities: { images: !!spec.images, pdf: !!spec.pdf, audio: !!spec.audio },
          hidden: false,
          source: "manual",
          ...(spec.contextLimit ? { contextLimit: spec.contextLimit } : {}),
        };
      }),
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { id: string; models: { id: string; modelId: string }[] };
}

/** The Chat section of the session panel. */
export const chatSection = (page: Page) => page.locator("section:has(> div > #panel-section-session-chat-title)");
export const messageBox = (scope: Locator) => scope.getByRole("textbox", { name: "Message" });
export const conversation = (scope: Locator) => scope.getByRole("log", { name: "Conversation" });
export const answers = (scope: Locator) => conversation(scope).getByRole("article", { name: "Assistant" });

/** Choose a model in a message box's model picker by its display name. */
export async function pickModel(page: Page, scope: Locator, displayName: string) {
  await scope.getByRole("button", { name: /^Model:/ }).click();
  const search = page.getByRole("searchbox", { name: "Search models" });
  if (await search.isVisible()) await search.fill(displayName);
  await page.getByRole("listbox", { name: "Models" }).getByRole("option", { name: new RegExp(`^${displayName}`) }).click();
  await expect(scope.getByRole("button", { name: new RegExp(`^Model: ${displayName},`) })).toBeVisible();
}

/** Type a message and press Enter. */
export async function ask(scope: Locator, text: string) {
  const box = messageBox(scope);
  await box.fill(text);
  await box.press("Enter");
  await expect(box).toHaveValue("");
}

/** axe on the page, or only inside `include` (e.g. an open dialog over a dimmed page). */
export async function axeClean(page: Page, include?: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  const scan = await (include ? builder.include(include) : builder).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

/** The open note's editor, in live (rich) or raw mode. */
export const noteEditor = (page: Page) => page.locator('.cm-content, [aria-label="editable markdown"]').first();
