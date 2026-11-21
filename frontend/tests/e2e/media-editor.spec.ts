import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { workspaceUrl } from "./notes-helpers";

/** A playable 16 kHz mono WAV with a varying loudness. */
function wav(ms: number): Buffer {
  const rate = 16000;
  const n = Math.round((rate * ms) / 1000);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.abs(Math.sin(t * 1.7) * Math.sin(t * 0.5 + 1));
    data.writeInt16LE(Math.round(18000 * env * Math.sin(2 * Math.PI * 220 * t)), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function sessionWithAudio(page: Page, testInfo: { project: { name: string } }, names: string[]) {
  await signIn(page);
  const name = `MEDIA ${tag(testInfo.project.name)}`;
  const cls = await seedClass(page, {
    course: newHierarchy(name, `Sem ${name}`, `Year ${name}`, "2027-01-10"),
    title: "Lecture", startDate: "2026-09-28", startTime: "21:00", endTime: "22:00", location: "Room 3", color: "teal",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  await page.goto(workspaceUrl(cls.courseId as string, cls.lineageId as string, "2026-10-05"));
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await expect(panel.getByRole("button", { name: "Upload audio" })).toBeVisible();
  for (const n of names) {
    await panel.getByTestId("upload-audio-input").setInputFiles({ name: `${n}.wav`, mimeType: "audio/wav", buffer: wav(6000) });
    await expect(panel.getByRole("button", { name: new RegExp(`^${n}`) })).toBeVisible({ timeout: 15000 });
  }
  return { panel, className: name };
}

async function setEnd(page: Page, text: string) {
  const end = page.getByLabel("End", { exact: true });
  await end.fill(text);
  await end.press("Enter");
}

test("US1+US2: Edit from a session, trim, save as new, overwrite, switch recordings", async ({ page }, testInfo) => {
  const { panel, className } = await sessionWithAudio(page, testInfo, ["Trim me", "Other take"]);

  await panel.getByRole("button", { name: "Actions for Trim me" }).click();
  await page.getByRole("menuitem", { name: "Edit…" }).click();
  await expect(page).toHaveURL(/\/media-editor\?recording=/);

  // the editor and its Recordings browser, with this audio's class and session open and current
  await expect(page.getByRole("group", { name: /^Waveform of Trim me/ })).toBeVisible({ timeout: 15000 });
  const browser = page.getByRole("navigation", { name: "Recordings" });
  await expect(browser.getByRole("button", { name: new RegExp(className) })).toHaveAttribute("aria-expanded", "true");
  await expect(browser.getByRole("button", { name: /Trim me/ })).toHaveAttribute("aria-current", "true");
  // the right panel holds the recordings tree; closed, it leaves only the editor icon
  await page.getByRole("button", { name: "Close recordings" }).click();
  const rail = page.getByRole("navigation", { name: "Media editor rail" });
  await expect(rail.getByRole("button")).toHaveCount(1);
  await rail.getByRole("button", { name: "Show recordings" }).click();
  await expect(browser.getByRole("button", { name: /Trim me/ })).toHaveAttribute("aria-current", "true");

  // the pins: keyboard sliders, and draggable
  const startPin = page.getByRole("slider", { name: "Selection start" });
  await startPin.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("0:01.000");
  const endPin = page.getByRole("slider", { name: "Selection end" });
  const box = (await endPin.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x - 120, box.y + 30, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByLabel("End", { exact: true })).not.toHaveValue("0:06.000");
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("0:00.000");

  // save as new
  await setEnd(page, "0:04");
  await page.getByRole("button", { name: "Save…" }).click();
  await page.getByRole("alertdialog").getByLabel("Name").fill("Trimmed copy");
  await page.getByRole("button", { name: "Save new recording" }).click();
  await expect(page.getByText("Saved “Trimmed copy”.")).toBeVisible();
  await expect(browser.getByRole("button", { name: /Trimmed copy/ })).toContainText(/0:0[34]/);
  await expect(browser.getByRole("button", { name: /Trim me/ })).toContainText("0:06"); // original untouched

  // overwrite the original
  await setEnd(page, "0:02");
  await page.getByRole("button", { name: "Save…" }).click();
  await page.getByRole("radio", { name: /Overwrite the original/ }).click();
  await expect(page.getByText("The original audio will be replaced.")).toBeVisible();
  await page.getByRole("button", { name: "Overwrite original" }).click();
  await expect(browser.getByRole("button", { name: /Trim me/ })).toContainText(/0:0[12]/);

  // switching with an unsaved selection asks first; switching is possible from the list
  await setEnd(page, "0:01");
  await browser.getByRole("button", { name: /Other take/ }).click();
  await expect(page.getByText("Discard your changes?")).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await browser.getByRole("button", { name: /Other take/ }).click();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("group", { name: /^Waveform of Other take/ })).toBeVisible({ timeout: 15000 });

  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

  // the overwritten original is in Settings → Trash, and restoring it adds it back as a new recording
  await page.goto("/settings/trash");
  const entry = page.locator('[data-entry-id]').filter({ hasText: "Trim me" }).first();
  await expect(entry).toContainText("Old audio, kept by an edit");
  await entry.getByRole("button", { name: /^Restore Trim me/ }).click();
  await expect(page.getByText("Added back to its session as a new recording.")).toBeVisible();
});

test("US2: the right panel's Media editor button opens the editor with nothing chosen", async ({ page }, testInfo) => {
  const { panel } = await sessionWithAudio(page, testInfo, [`Pick me ${tag(testInfo.project.name)}`]);
  await panel.getByRole("radio", { name: "Media editor" }).click();
  await expect(page).toHaveURL(/\/media-editor$/);
  await expect(page.getByRole("heading", { name: "Choose a recording to edit" })).toBeVisible();
  const browser = page.getByRole("navigation", { name: "Recordings" });
  await browser.getByLabel("Filter recordings by name").fill(`Pick me ${tag(testInfo.project.name)}`); // opens the matching class and session
  await browser.getByRole("button", { name: /Pick me/ }).first().click();
  await expect(page.getByRole("group", { name: /^Waveform of Pick me/ })).toBeVisible({ timeout: 15000 });
});

test("US1: several windows: add at the playhead, never inside one, save separately or merged", async ({ page }, testInfo) => {
  const { panel } = await sessionWithAudio(page, testInfo, [`Windows ${tag(testInfo.project.name)}`]);
  await panel.getByRole("button", { name: /Actions for Windows/ }).click();
  await page.getByRole("menuitem", { name: "Edit…" }).click();
  await expect(page.getByRole("group", { name: /^Waveform of Windows/ })).toBeVisible({ timeout: 20000 });
  const add = page.getByRole("button", { name: "Add window" });
  const status = page.locator("#add-window-note");

  // the playhead starts inside the only window: no new window there
  await expect(status).toContainText("inside a window");
  await expect(add).toBeDisabled();
  await expect(page.getByRole("slider", { name: /^Window \d/ })).toHaveCount(0);

  // shorten the first window to 0:02, move the playhead past it, add a window there
  const end = page.getByLabel("End", { exact: true });
  await end.fill("0:02");
  await end.press("Enter");
  const playhead = page.getByRole("slider", { name: "Playhead" });
  await playhead.focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect(status).toContainText("puts a new window at the playhead");
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.getByRole("slider", { name: "Window 2 start" })).toHaveAttribute("aria-valuenow", "4000");
  await expect(page.getByRole("list", { name: "Windows" })).toContainText("Window 2");

  // windows never collide: pushing window 2's start left stops at window 1's end
  const start2 = page.getByRole("slider", { name: "Window 2 start" });
  await start2.focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(start2).toHaveAttribute("aria-valuenow", "2000");
  await page.screenshot({ path: "/tmp/claude-1000/windows-" + testInfo.project.name + ".png" });

  // the playhead inside a window again: refused
  await playhead.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(status).toContainText("inside a window");
  await expect(add).toBeDisabled();

  // saving asks how: separate windows
  await page.getByRole("button", { name: "Save…" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("radio", { name: /Merge into one recording/ })).toBeChecked();
  await dialog.getByRole("radio", { name: /Save each window as its own recording/ }).click();
  await expect(dialog.getByRole("radio", { name: /Overwrite the original/ })).toBeDisabled();
  await dialog.getByLabel("Base name").fill("Split");
  await dialog.getByRole("button", { name: "Save 2 recordings" }).click();
  await expect(page.getByText("Saved 2 recordings.")).toBeVisible();
  const browser = page.getByRole("navigation", { name: "Recordings" });
  await expect(browser.getByRole("button", { name: /Split 1/ })).toBeVisible();
  await expect(browser.getByRole("button", { name: /Split 2/ })).toBeVisible();

  // merged into one
  await page.getByRole("button", { name: "Save…" }).click();
  await dialog.getByLabel("Name").fill("Merged");
  await dialog.getByRole("button", { name: "Save new recording" }).click();
  await expect(page.getByText("Saved “Merged”.")).toBeVisible();
  await expect(browser.getByRole("button", { name: /Merged/ })).toContainText(/0:0[34]/);
});
