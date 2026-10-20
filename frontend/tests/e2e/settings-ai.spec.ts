import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signIn, tag } from "./helpers";

// 014 US1: Settings → AI against the scripted fake of the three styles (tests/fake_llm.py)
const LLM = `http://localhost:${process.env.E2E_LLM_PORT ?? 8021}`;

async function axeClean(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function openAiSettings(page: Page) {
  await signIn(page);
  await page.goto("/settings/transcription");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "AI", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/ai$/);
  await expect(page.getByRole("heading", { name: "Endpoints" })).toBeVisible();
}

async function endpoints(page: Page) {
  return (await (await page.request.get("/api/v1/ai/endpoints")).json()) as { name: string; enabled: boolean; baseUrl: string; locality: string; models: { modelId: string }[] }[];
}

test("add a local endpoint from a pasted full path, test, refresh, save, disable and delete", async ({ page }, testInfo) => {
  const name = `Local fake ${tag(testInfo.project.name)}`;
  await openAiSettings(page);
  await axeClean(page);

  await page.getByRole("button", { name: "Add endpoint" }).click();
  const form = page.getByRole("form", { name: "Add endpoint" });
  await expect(form.getByRole("radio", { name: /OpenAI-compatible/ })).toBeChecked();
  await form.getByRole("textbox", { name: "Name" }).fill(name);
  await form.getByRole("textbox", { name: "Base URL" }).fill(`${LLM}/v1/chat/completions/`);
  await expect(form.getByText("Removed /chat/completions — the app adds it")).toBeVisible();
  await expect(form.getByText("Local", { exact: true })).toBeVisible();

  const before = (await endpoints(page)).length;
  await form.getByRole("button", { name: "Test connection" }).click();
  await expect(form.getByText(/^Working\./)).toBeVisible({ timeout: 20_000 });
  await form.getByRole("button", { name: "Refresh" }).click();
  await expect(form.getByText("echo", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(form.getByText("slow", { exact: true })).toBeVisible();
  expect((await endpoints(page)).length).toBe(before); // Test and Refresh never save
  await axeClean(page);

  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Endpoint saved.").last()).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row.getByText(`${LLM}/v1`, { exact: true })).toBeVisible();
  await expect(row.getByText("Local", { exact: true })).toBeVisible();
  const saved = (await endpoints(page)).find((e) => e.name === name)!;
  expect(saved.baseUrl).toBe(`${LLM}/v1`);
  expect(saved.locality).toBe("local");
  expect(saved.models.map((m) => m.modelId)).toEqual(expect.arrayContaining(["echo", "slow"]));

  // disable and enable
  const enabled = row.getByRole("switch", { name: `Enable ${name}` });
  await enabled.click();
  await expect(enabled).not.toBeChecked();
  await expect.poll(async () => (await endpoints(page)).find((e) => e.name === name)?.enabled).toBe(false);
  await enabled.click();
  await expect(enabled).toBeChecked();
  await expect.poll(async () => (await endpoints(page)).find((e) => e.name === name)?.enabled).toBe(true);

  // delete with confirmation
  await row.getByRole("button", { name: `Delete ${name}` }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText(`Delete "${name}"?`)).toBeVisible();
  await expect(dialog.getByText("Chats that used it keep their history.")).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row).toHaveCount(0);
  expect((await endpoints(page)).some((e) => e.name === name)).toBe(false);
});

test("a remote http address is refused", async ({ page }, testInfo) => {
  await openAiSettings(page);
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const form = page.getByRole("form", { name: "Add endpoint" });
  await form.getByRole("textbox", { name: "Name" }).fill(`Remote http ${tag(testInfo.project.name)}`);
  const url = form.getByRole("textbox", { name: "Base URL" });
  await url.fill("http://example.com");
  await expect(form.getByText(/Use https:\/\/ for this address/)).toBeVisible();
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form.getByText(/Use https:\/\/ for this address/)).toBeVisible();
  expect((await endpoints(page)).some((e) => e.baseUrl.startsWith("http://example.com"))).toBe(false);
  await form.getByRole("button", { name: "Cancel" }).click();
});

test("a rejected key against the Anthropic fake reads as key rejected; audio is off for Anthropic", async ({ page }, testInfo) => {
  await openAiSettings(page);
  await page.getByRole("button", { name: "Add endpoint" }).click();
  const form = page.getByRole("form", { name: "Add endpoint" });
  await form.getByRole("radio", { name: /Anthropic/ }).click();
  await form.getByRole("textbox", { name: "Name" }).fill(`Claude fake ${tag(testInfo.project.name)}`);
  await form.getByRole("textbox", { name: "Base URL" }).fill(`${LLM}/anthropic`);
  await form.getByLabel("API key", { exact: false }).fill("sk-ant-wrong-key-1234");
  // the fake answers 401 for this model id, as a provider does for a wrong key
  await form.getByRole("textbox", { name: /Model to test/ }).fill("fail-401");
  await form.getByRole("button", { name: "Test connection" }).click();
  await expect(form.getByText(/^Key rejected\./)).toBeVisible({ timeout: 20_000 });
  await expect(form.getByText(/^Working\./)).toHaveCount(0);

  await form.getByRole("button", { name: "Refresh" }).click();
  await expect(form.getByText("echo", { exact: true })).toBeVisible({ timeout: 20_000 });
  const audio = form.getByRole("switch", { name: "Audio" }).first();
  await expect(audio).toBeDisabled();
  await expect(form.getByText("Anthropic doesn't accept audio").first()).toBeVisible();
  await expect(form.getByRole("switch", { name: "PDF documents" }).first()).toBeChecked();
  await axeClean(page);
  await form.getByRole("button", { name: "Cancel" }).click();
  expect((await endpoints(page)).some((e) => e.name.startsWith("Claude fake"))).toBe(false);
});
