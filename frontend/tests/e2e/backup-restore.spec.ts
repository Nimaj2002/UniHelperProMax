import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

/**
 * 016: back up, change something, restore the backup. The restore puts the whole account back
 * as it was when the backup was made, so the data other specs rely on is unchanged afterwards
 * (only this spec's own later note disappears).
 */

async function api(page: Page, method: "GET" | "POST", path: string, data?: unknown) {
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const r = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { "X-CSRF-Token": csrf } });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}

async function axe(page: Page, label: string) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const r = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} → ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test("back up, then restore the backup", async ({ page }, info) => {
  const t = tag(info.project.name);
  await signIn(page);
  const cls = await seedClass(page, {
    // evening slot: the shared e2e calendar must not gain overlaps in other specs' weeks
    course: newHierarchy(`BAK${t} 101`, `Backup ${t}`, `Backup year ${t}`), startDate: "2026-09-28", startTime: "21:00",
    endTime: "21:45", color: "teal", recurrence: { freq: "weekly", byWeekday: ["MO"], end: { kind: "semester_end" } },
  });
  const key = `${cls.lineageId}:2026-09-28`;
  await api(page, "POST", `/sessions/${key}/notes`, { name: `Kept ${t}`, content: "in the backup" });

  await page.goto("/settings");
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("link", { name: "Backup & restore" }).click();
  await expect(page.getByRole("heading", { name: "Backup & restore", level: 2 })).toBeVisible();
  await axe(page, "backup page");

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Create backup" }).click();
  const file = await (await downloaded).path();
  await expect(page.getByText(/Your backup is ready/)).toBeVisible();
  expect((await downloaded).suggestedFilename()).toMatch(/^UniHelperProMax-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);

  await api(page, "POST", `/sessions/${key}/notes`, { name: `Later ${t}`, content: "after the backup" });

  await page.getByLabel("Backup file").setInputFiles(file);
  await expect(page.getByRole("table", { name: /What the backup holds/ })).toBeVisible({ timeout: 30_000 });
  await axe(page, "restore summary");
  await page.getByRole("button", { name: "Restore…" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Replace all your data?" });
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Replace my data" }).click();

  // the restore itself: the note written after the backup is gone, the earlier one is back
  const noteNames = async () => {
    const r = await page.request.get(`/api/v1/sessions/${key}/notes`);
    return r.ok() ? (await r.json()).map((n: { name: string }) => n.name) : `HTTP ${r.status()}`; // 423 while restoring
  };
  await expect.poll(noteNames, { timeout: 60_000 }).toEqual([`Kept ${t}`]);
  // then the page reloads and says so
  await expect(page.getByText("Your data was restored.")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Safety backup" })).toBeVisible();
  await expect(page.getByText(/Safety backup from/)).toBeVisible();
});
