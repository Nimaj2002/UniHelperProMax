import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { OWNER, signIn, tag } from "./helpers";
import { editor, newNote, seedCourse, waitSaved, workspaceUrl } from "./notes-helpers";

const BACKEND = fileURLToPath(new URL("../../../backend", import.meta.url));
const TRANSCRIBER = `http://localhost:${process.env.E2E_TRANSCRIBER_PORT ?? 8020}`;

/** Until feature 005's Settings screens exist, configure the provider in the database. */
function seedProvider(model: string) {
  execFileSync(
    "uv",
    ["run", "python", "-m", "tests.e2e_seed", "set-provider", "--data", "../data-e2e", "--user", OWNER.username,
      "--provider", "voice-studio", "--address", TRANSCRIBER, "--model", model],
    { cwd: BACKEND, stdio: "pipe" },
  );
}

async function axeClean(page: Page) {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function record(page: Page) {
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await panel.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByRole("region", { name: "Recording", exact: true })).toBeVisible();
  await page.waitForTimeout(6500);
  await panel.getByRole("button", { name: "Stop" }).click();
  const transcribe = panel.getByRole("button", { name: /^Transcribe Recording \d{2}:\d{2}/ }).first();
  await expect(transcribe).toBeEnabled({ timeout: 15_000 });
  return { panel, transcribe };
}

async function noteContent(page: Page, sessionKey: string, name: string) {
  const notes = await (await page.request.get(`/api/v1/sessions/${encodeURIComponent(sessionKey)}/notes`)).json();
  const id = notes.find((n: { name: string }) => n.name === name).id;
  return (await (await page.request.get(`/api/v1/notes/${id}`)).json()).content as string;
}

test("US1/US3: transcribe into the open note while typing — text kept, transcript appended live", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `TR${t} 101`);
  seedProvider("slow-3");
  await page.goto(workspaceUrl(courseId, lineageId, "2026-10-05"));
  const { panel, transcribe } = await record(page);
  await newNote(page, "Lecture notes");
  await editor(page).click();
  await page.keyboard.type("My notes about trees");
  await waitSaved(page, "Lecture notes");

  await transcribe.click();
  const dialog = page.getByRole("dialog", { name: /^Transcribe “Recording/ });
  await expect(dialog.getByRole("radio", { name: "Lecture notes" })).toBeChecked();
  await expect(dialog).toContainText("Using Voice Studio");
  await axeClean(page);
  await dialog.getByRole("button", { name: "Transcribe" }).click();
  await expect(dialog).toBeHidden();

  // running: progress in the panel and the activity bar, every Transcribe button disabled
  const bar = page.getByRole("region", { name: "Transcription" });
  await expect(bar).toBeVisible();
  await expect(panel.getByRole("progressbar", { name: "Transcription progress" })).toBeVisible();
  await expect(transcribe).toBeDisabled();
  await axeClean(page);

  // keep typing while the provider works: nothing typed may be lost (FR-009)
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" — typed during transcription");

  // wait for this job (the other colour-scheme project shares the account and may leave an
  // earlier "Transcript added" notification to be shown on load)
  await expect(bar).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText("Transcript added to “Lecture notes”.").first()).toBeVisible({ timeout: 10_000 });
  await expect(editor(page)).toContainText("My notes about trees — typed during transcription");
  await expect(editor(page)).toContainText(/Transcript — Recording \d{2}:\d{2}/, { timeout: 10_000 });
  await expect(page.getByRole("dialog", { name: /conflict|changed/i })).toHaveCount(0);
  await waitSaved(page, "Lecture notes");
  const content = await noteContent(page, `${lineageId}:2026-10-05`, "Lecture notes");
  expect(content.startsWith("My notes about trees — typed during transcription")).toBe(true);
  expect(content).toMatch(/\n\n## Transcript — Recording \d{2}:\d{2} · 2026-\d{2}-\d{2} \d{2}:\d{2} · \d+s\n\nTranscript of Recording/);
  await expect(panel.getByRole("link", { name: "Lecture notes" })).toBeVisible();
  await expect(transcribe).toBeEnabled();
});

test("US2/US3: new note, failure with Settings link, Retry, Cancel", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await signIn(page);
  const { courseId, lineageId } = await seedCourse(page, `TRF${t} 101`);
  const key = `${lineageId}:2026-10-07`;
  seedProvider("fail-401");
  await page.goto(workspaceUrl(courseId, lineageId, "2026-10-07"));
  const { panel, transcribe } = await record(page);

  // no notes yet: name a new one (keyboard only)
  await transcribe.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: /^Transcribe “Recording/ });
  await expect(dialog.getByRole("textbox", { name: "Note name" })).toHaveValue("Transcript");
  await dialog.getByRole("textbox", { name: "Note name" }).press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: /^Transcript/ }).first()).toBeVisible(); // in the note list at once

  await expect(panel.getByText(/^Transcription failed: The provider rejected the credentials/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("link", { name: "Open Settings → Transcription" })).toBeVisible();
  expect(await noteContent(page, key, "Transcript")).toBe("");
  await axeClean(page);

  seedProvider("whisper-1"); // "fix the settings"
  await panel.getByRole("button", { name: "Retry" }).click();
  await expect(panel.getByRole("link", { name: "Transcript", exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await noteContent(page, key, "Transcript")).toMatch(/^## Transcript — Recording/);

  // cancel a slow job: nothing appended
  seedProvider("slow-5");
  await transcribe.click();
  await expect(dialog.getByText(/already transcribed into “Transcript”/)).toBeVisible();
  await dialog.getByRole("button", { name: "Transcribe again" }).click();
  await panel.getByRole("button", { name: "Cancel" }).click();
  await expect(panel.getByText("Transcription cancelled.")).toBeVisible({ timeout: 20_000 });
  expect((await noteContent(page, key, "Transcript")).match(/## Transcript/g)).toHaveLength(1);
});
