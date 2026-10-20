import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { editor, workspaceUrl } from "./notes-helpers";

/** A real, playable 16 kHz mono PCM WAV of silence. */
function wav(ms: number): Buffer {
  const rate = 16000;
  const data = Buffer.alloc(Math.round((rate * ms) / 1000) * 2);
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

async function axeClean(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running")); // dialogs fade in
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(scan.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function openSession(page: Page, testInfo: { project: { name: string } }, course: string, date = "2026-10-05") {
  const t = tag(testInfo.project.name);
  await signIn(page);
  // evening slot: these courses share the e2e calendar with other specs and must not add
  // overlaps to their 10:00 events
  const name = `${course}${t}`;
  const cls = await seedClass(page, {
    course: newHierarchy(name, `Sem ${name}`, `Year ${name}`, "2027-01-10"),
    title: "Lecture", startDate: "2026-09-28", startTime: "19:00", endTime: "20:00", location: "Room 2", color: "teal",
    recurrence: { freq: "weekly", byWeekday: ["MO", "WE"], end: { kind: "semester_end" } },
  });
  const { courseId, lineageId } = { courseId: cls.courseId as string, lineageId: cls.lineageId as string };
  const url = workspaceUrl(courseId, lineageId, date);
  await page.goto(url);
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await expect(panel.getByRole("button", { name: "Upload audio" })).toBeVisible();
  return { panel, url, sessionKey: `${lineageId}:${date}` };
}

const IMPORT_URL = /\/recordings\/import\?/;

test("US1/US3: upload audio with the picker, see it as Imported, play it", async ({ page }, testInfo) => {
  const { panel } = await openSession(page, testInfo, "IMPA ");
  await panel.getByTestId("upload-audio-input").setInputFiles({ name: "Week 3 lecture.wav", mimeType: "audio/wav", buffer: wav(3000) });

  const item = panel.getByRole("button", { name: /^Week 3 lecture/ });
  await expect(item).toBeVisible({ timeout: 15000 });
  await expect(item).toContainText("Imported");
  await expect(item).toContainText(/Imported \d{1,2} \w{3} \d{4}/);
  await expect(item).toContainText("0:03");
  await expect(page.getByText("Uploaded “Week 3 lecture.wav”")).toBeVisible();

  await item.click();
  const player = page.getByRole("group", { name: /^Player: Week 3 lecture/ });
  await expect(player.getByRole("slider", { name: "Seek" })).toBeVisible();
  await player.getByRole("button", { name: "Play" }).click();
  await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
  await axeClean(page);
});

test("US1: drag and drop two files onto the audio panel", async ({ page }, testInfo) => {
  const { panel } = await openSession(page, testInfo, "IMPB ");
  const bytes = [...wav(1000)];
  const dataTransfer = await page.evaluateHandle((b) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(b)], "drop one.wav", { type: "audio/wav" }));
    dt.items.add(new File([new Uint8Array(b)], "drop two.wav", { type: "audio/wav" }));
    return dt;
  }, bytes);
  const zone = panel.getByTestId("audio-drop-zone");
  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(panel.getByText("Drop audio files to upload")).toBeVisible();
  await zone.dispatchEvent("drop", { dataTransfer });
  await expect(panel.getByRole("button", { name: /^drop one/ })).toBeVisible({ timeout: 15000 });
  await expect(panel.getByRole("button", { name: /^drop two/ })).toBeVisible();
  await expect(page.getByText("Uploaded 2 of 2 files")).toBeVisible();
});

test("US1/US2: cancel an upload; unsupported files are refused without a request", async ({ page }, testInfo) => {
  const { panel } = await openSession(page, testInfo, "IMPC ");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (IMPORT_URL.test(r.url())) requests.push(r.url());
  });

  await panel.getByTestId("upload-audio-input").setInputFiles({ name: "slides.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
  await expect(
    panel.getByRole("region", { name: "Uploads" }).getByText(/slides\.pdf: this file type isn't supported\. Use MP3, M4A, AAC, WAV, OGG, Opus, WebM or FLAC\./),
  ).toBeVisible();
  expect(requests).toEqual([]);
  await panel.getByRole("button", { name: "Dismiss slides.pdf" }).click();

  // hold the upload so it can be cancelled while running
  await page.route(IMPORT_URL, async (route) => {
    await new Promise((r) => setTimeout(r, 10_000));
    await route.continue().catch(() => undefined);
  });
  await panel.getByTestId("upload-audio-input").setInputFiles({ name: "long.wav", mimeType: "audio/wav", buffer: wav(4000) });
  const cancel = panel.getByRole("button", { name: "Cancel upload of long.wav" });
  await expect(cancel).toBeVisible();
  await axeClean(page); // panel with an upload row
  const started = Date.now();
  await cancel.click();
  await expect(cancel).toBeHidden();
  expect(Date.now() - started).toBeLessThan(1000); // SC-003
  await expect(panel.getByTestId("upload-announcer")).toHaveText("long.wav upload cancelled");
  await page.waitForTimeout(500);
  await expect(panel.getByRole("button", { name: /^long/ })).toHaveCount(0);
});

test("US1: reloading during an upload asks first", async ({ page }, testInfo) => {
  const { panel } = await openSession(page, testInfo, "IMPD ");
  await page.route(IMPORT_URL, async (route) => {
    await new Promise((r) => setTimeout(r, 10_000));
    await route.continue().catch(() => undefined);
  });
  await panel.getByTestId("upload-audio-input").setInputFiles({ name: "held.wav", mimeType: "audio/wav", buffer: wav(1000) });
  await expect(panel.getByRole("button", { name: "Cancel upload of held.wav" })).toBeVisible();
  const dialog = page.waitForEvent("dialog");
  void page.reload().catch(() => undefined);
  const d = await dialog;
  expect(d.type()).toBe("beforeunload");
  await d.dismiss();
  await expect(panel.getByRole("button", { name: "Cancel upload of held.wav" })).toBeVisible();
});

test("US4/US5: import notes and resolve name conflicts", async ({ page }, testInfo) => {
  await openSession(page, testInfo, "IMPN ");
  const pick = (files: { name: string; text: string }[]) =>
    page.getByTestId("import-note-input").setInputFiles(files.map((f) => ({ name: f.name, mimeType: "text/plain", buffer: Buffer.from(f.text) })));
  const notes = page.getByRole("region", { name: "Notes" }).or(page.locator("section[aria-labelledby='notes-heading']"));

  await pick([
    { name: "Lecture 3.md", text: "# Trees\n\nRed-black trees." },
    { name: "questions.txt", text: "Why O(log n)?" },
  ]);
  await expect(page.getByText("Imported 2 of 2 notes")).toBeVisible();
  await expect(notes.getByRole("button", { name: /^Lecture 3/ })).toBeVisible();
  await notes.getByRole("button", { name: /^Lecture 3/ }).click();
  await expect(editor(page)).toContainText("Red-black trees.");

  // Rename (suggested name)
  await pick([{ name: "Lecture 3.md", text: "second copy" }]);
  let prompt = page.getByRole("alertdialog", { name: /A note named “Lecture 3” already exists/ });
  await expect(prompt.getByLabel("Import as a new note named")).toHaveValue("Lecture 3 (2)");
  await expect(prompt.getByLabel("Import as a new note named")).toBeFocused();
  await axeClean(page);
  await prompt.getByRole("button", { name: "Import as new note" }).click();
  await expect(notes.getByRole("button", { name: /^Lecture 3 \(2\)/ })).toBeVisible();

  // Skip, and Escape (also Skip)
  await pick([{ name: "Lecture 3.md", text: "skipped" }]);
  prompt = page.getByRole("alertdialog", { name: /already exists/ });
  await prompt.getByRole("button", { name: "Skip" }).click();
  await pick([{ name: "Lecture 3.md", text: "escaped" }]);
  await expect(page.getByRole("alertdialog", { name: /already exists/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeHidden();

  // Replace → Cancel returns to the prompt; Replace → Replace changes the open note
  await notes.getByRole("button", { name: /^Lecture 3( \(open\))?$/ }).click();
  await expect(editor(page)).toContainText("Red-black trees.");
  await pick([{ name: "Lecture 3.md", text: "# Replaced\n\nnew content" }]);
  prompt = page.getByRole("alertdialog", { name: /already exists/ });
  await prompt.getByRole("button", { name: "Replace…" }).click();
  let confirm = page.getByRole("alertdialog", { name: "Replace the content of “Lecture 3”?" });
  await axeClean(page);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  prompt = page.getByRole("alertdialog", { name: /already exists/ });
  await prompt.getByRole("button", { name: "Replace…" }).click();
  confirm = page.getByRole("alertdialog", { name: "Replace the content of “Lecture 3”?" });
  await confirm.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByText("Replaced “Lecture 3”")).toBeVisible();
  await expect(editor(page)).toContainText("new content");
  await expect(editor(page)).not.toContainText("Red-black trees.");
});

test("keyboard only: Alt+Shift+N opens the note picker; Upload audio is reachable", async ({ page }, testInfo) => {
  const { panel } = await openSession(page, testInfo, "IMPK ");
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Alt+Shift+N");
  const fc = await chooser;
  expect(fc.isMultiple()).toBe(true);
  await fc.setFiles({ name: "kb.md", mimeType: "text/markdown", buffer: Buffer.from("typed by keyboard") });
  await expect(page.getByText("Imported “kb”")).toBeVisible();

  const upload = panel.getByRole("button", { name: "Upload audio" });
  await upload.focus();
  await expect(upload).toBeFocused();
  const audioChooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Enter");
  await (await audioChooser).setFiles({ name: "kb.wav", mimeType: "audio/wav", buffer: wav(1000) });
  await expect(panel.getByRole("button", { name: /^kb/ })).toBeVisible({ timeout: 15000 });
});
