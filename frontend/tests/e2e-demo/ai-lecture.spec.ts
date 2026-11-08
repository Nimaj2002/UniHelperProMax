import { expect, guardOrigins, lectureSession, openDemo, test } from "./fixtures";

/** 024 US3: simulated AI and transcription, the sample PDF and audio, and "available in the app". */
guardOrigins();

test("the sample PDF renders in the reader", async ({ page }) => {
  await openDemo(page);
  const lecture = await lectureSession(page);
  await openDemo(page, lecture.url);
  await page.getByRole("region", { name: "Documents" }).getByRole("button", { name: /^Week 3/ }).click();
  const reader = page.getByRole("tabpanel", { name: /^Week 3.*PDF$/ });
  await expect(reader).toBeVisible({ timeout: 30_000 });
  // a rendered page (tiles are images) proves the PDF came through the demo's API
  await expect(reader.locator("img").first()).toBeVisible({ timeout: 30_000 });
});

test("the sample recording plays and can seek", async ({ page }) => {
  await openDemo(page);
  const lecture = await lectureSession(page);
  await openDemo(page, lecture.url);
  const ok = await page.evaluate(async (key) => {
    const recs = await (await fetch(`/api/v1/sessions/${encodeURIComponent(key)}/recordings`)).json();
    const a = new Audio(`/api/v1/recordings/${recs[0].id}/audio?v=${recs[0].version}`);
    a.muted = true;
    await new Promise((res, rej) => { a.onloadedmetadata = res; a.onerror = () => rej(new Error("audio error")); });
    a.currentTime = a.duration / 2;
    await new Promise((res) => (a.onseeked = res));
    return { duration: a.duration, at: a.currentTime };
  }, lecture.key);
  expect(ok.duration).toBeGreaterThan(20);
  expect(ok.at).toBeGreaterThan(10);
});

test("chat replies stream in and say they are demo answers", async ({ page }) => {
  await openDemo(page);
  const lecture = await lectureSession(page);
  await openDemo(page, lecture.url);
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await panel.getByRole("radio", { name: "Chat" }).click();
  const box = panel.getByRole("textbox", { name: "Message" });
  await expect(box).toBeEnabled({ timeout: 15_000 });
  await box.fill("Give me an example of merge sort");
  await box.press("Enter");
  const answer = panel.getByRole("log", { name: "Conversation" }).getByRole("article", { name: "Assistant" }).last();
  await expect(answer).toContainText("Demo answer", { timeout: 30_000 });
});

test("transcription appends below the existing note", async ({ page }) => {
  await openDemo(page);
  const lecture = await lectureSession(page);
  await openDemo(page, lecture.url);
  const before = await page.evaluate(async (key) => {
    const notes = await (await fetch(`/api/v1/sessions/${encodeURIComponent(key)}/notes`)).json();
    return (await (await fetch(`/api/v1/notes/${notes[0].id}`)).json()).content as string;
  }, lecture.key);
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await panel.getByRole("button", { name: /^Transcribe/ }).first().click();
  const dialog = page.getByRole("dialog", { name: /^Transcribe/ });
  await dialog.getByRole("button", { name: "Transcribe" }).click();
  await expect.poll(async () => page.evaluate(async (key) => {
    const notes = await (await fetch(`/api/v1/sessions/${encodeURIComponent(key)}/notes`)).json();
    return (await (await fetch(`/api/v1/notes/${notes[0].id}`)).json()).content as string;
  }, lecture.key), { timeout: 20_000 }).not.toBe(before);
  const after = await page.evaluate(async (key) => {
    const notes = await (await fetch(`/api/v1/sessions/${encodeURIComponent(key)}/notes`)).json();
    return (await (await fetch(`/api/v1/notes/${notes[0].id}`)).json()).content as string;
  }, lecture.key);
  expect(after.startsWith(before)).toBe(true);
});

test("Record says it's in the app and never asks for the microphone", async ({ page }) => {
  await page.addInitScript(() => {
    // count calls that reach the browser's real getUserMedia (the demo replaces it at start)
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as unknown as { realMicCalls: number }).realMicCalls = 0;
    MediaDevices.prototype.getUserMedia = function (c) {
      (window as unknown as { realMicCalls: number }).realMicCalls++;
      return real(c);
    };
  });
  await openDemo(page);
  const lecture = await lectureSession(page);
  await openDemo(page, lecture.url);
  const panel = page.getByRole("complementary", { name: "Session panel" });
  await panel.getByRole("button", { name: "Record", exact: true }).click();
  await expect(page.getByText("Recording is available in the UniHelperProMax app.").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { realMicCalls: number }).realMicCalls)).toBe(0);

  await openDemo(page, "/settings/ai");
  await page.evaluate(() => fetch("/api/v1/ai/endpoints", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  await expect(page.getByText("AI provider setup is available in the UniHelperProMax app.").first()).toBeVisible();
});
