import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn, tag } from "./helpers";

const TRANSCRIBER = `http://localhost:${process.env.E2E_TRANSCRIBER_PORT ?? 8020}`;
const KEY = "sk-e2e-secret-key-1234";

async function axeClean(page: Page, exclude?: string) {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]);
  const scan = await (exclude ? builder.exclude(exclude) : builder).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
}

// both colour-scheme projects share one account: always return to "Match system"
test.afterEach(async ({ page }) => {
  await page.request.patch("/api/v1/preferences", { data: { theme: "system" }, headers: { "X-CSRF-Token": await csrf(page) } });
});

test("Settings → Transcription: Voice Studio, OpenAI-compatible with a masked key", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings\/transcription$/);
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();

  // Voice Studio: keyboard only
  const vs = page.getByRole("radio", { name: /Voice Studio/ });
  await vs.click();
  await expect(page.getByLabel("API key", { exact: true })).toHaveCount(0);
  const address = page.getByRole("textbox", { name: "Server address" });
  await address.fill(TRANSCRIBER);
  await page.getByRole("button", { name: "Test connection" }).press("Enter");
  await expect(page.getByText("Connection works.")).toBeVisible({ timeout: 15_000 });
  await axeClean(page);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Transcription settings saved.").last()).toBeVisible();
  expect((await (await page.request.get("/api/v1/transcription/status")).json()).configured).toBe(true);

  // OpenAI-compatible with a key: http is fine for this computer
  await page.getByRole("radio", { name: /OpenAI-compatible/ }).click();
  await page.getByRole("textbox", { name: "Server address" }).fill(TRANSCRIBER);
  const replace = page.getByRole("button", { name: "Replace" }); // a key saved by the other project's run
  if (await replace.isVisible()) await replace.click();
  await page.getByLabel("API key", { exact: true }).fill(KEY);
  await page.getByRole("textbox", { name: "Model" }).fill("whisper-1");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Transcription settings saved.").last()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Saved API key ending in 1234/)).toHaveText("••••••••1234");
  expect(await page.content()).not.toContain(KEY);
  expect(await (await page.request.get("/api/v1/settings/transcription")).text()).not.toContain(KEY);

  // a public http address with a key is refused
  await page.getByRole("textbox", { name: "Server address" }).fill("http://93.184.216.34");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Use https:// for this address when an API key is set.")).toBeVisible();

  // back to Voice Studio for the other specs
  await page.reload();
  await page.getByRole("radio", { name: /Voice Studio/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Transcription settings saved.").last()).toBeVisible();
});

test("Settings → Appearance: choose, create, export/import and delete themes", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  await page.getByRole("button", { name: "Settings" }).click(); // top-bar gear
  await page.getByRole("link", { name: "Appearance" }).click();
  await expect(page.getByRole("radio", { name: /Match system/ })).toBeChecked();
  await axeClean(page);

  // Dark applies at once and before the app starts on the next load
  await page.getByRole("radio", { name: /^Dark/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.route("**/src/main.tsx", (r) => r.abort());
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); // theme-boot.js alone
  await page.unroute("**/src/main.tsx");
  await page.reload();

  // a new low-contrast theme from Light
  const name = `E2E Sunny ${t}`;
  await page.getByRole("button", { name: "New theme…" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("button", { name: "Create and edit" }).click();
  const accent = page.getByRole("textbox", { name: "Accent", exact: true });
  await accent.fill("#ffd400");
  await expect(page.getByText(/^Accent on Background — 1\.\d:1, needs 4\.5:1/)).toBeVisible();
  // the preview deliberately shows the chosen (failing) colours; the editor reports them above
  await axeClean(page, '[aria-label="Theme preview"]');
  await page.getByRole("button", { name: "Save theme" }).click();
  await page.getByRole("button", { name: "Save as low contrast" }).click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  const card = page.getByRole("radio", { name: new RegExp(name) });
  await expect(page.getByText("Low contrast").first()).toBeVisible();
  await card.click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--accent"))).toBe("#ffd400");
  await page.goto("/calendar");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())).toBe("#ffd400");
  await page.goBack();

  // export → delete (falls back to Light) → import → identical colours
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export/ }).click();
  const file = await (await download).path();
  const exported = JSON.parse(readFileSync(file!, "utf8"));
  expect(exported).toMatchObject({ format: "unihelper-theme", name, base: "light" });
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await page.getByRole("button", { name: "Delete theme" }).click();
  await expect(page.getByRole("radio", { name: new RegExp(name) })).toHaveCount(0);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("radio", { name: /^Light/ })).toBeChecked();
  await page.getByLabel("Theme file to import").setInputFiles(file!);
  await expect(page.getByRole("radio", { name: new RegExp(name) })).toBeVisible();
  const themes = await (await page.request.get("/api/v1/themes")).json();
  expect(themes.find((x: { name: string }) => x.name === name).colors).toEqual(exported.colors);
});
