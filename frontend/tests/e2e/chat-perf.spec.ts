/**
 * 014 SC-007 (T127): a 1,000-message chat (500 turns, seeded through the API against the echo
 * model) opens in under 2 s, scrolls to the top and back with no long task over 100 ms, and takes
 * typing at under 50 ms per keystroke; during two concurrent `slow` streams, typing in a note
 * stays under 50 ms per keystroke. Keystrokes are measured with the Event Timing API (input to
 * the next paint), after one warm-up key (the first key after focusing an editor costs the same
 * with or without streams).
 */
import { expect, test, type Page } from "@playwright/test";
import { tag } from "./helpers";
import { LAYOUT_DATE, openSession, VIEWPORT } from "./layout-helpers";
import { answers, ask, chatSection, conversation, csrf, messageBox, noteEditor as editor, pickModel, seedEndpoint } from "./chat-helpers";
import { seedNote } from "./chat-fixtures";

test.use({ viewport: VIEWPORT });

const TURNS = 500;

async function seedLongChat(page: Page, sessionKey: string, model: { endpointId: string; modelId: string }) {
  const headers = { "X-CSRF-Token": await csrf(page) };
  const first = await page.request.post(`/api/v1/sessions/${encodeURIComponent(sessionKey)}/chats`, {
    headers,
    data: { text: "Long chat message 0", model },
  });
  expect(first.status(), await first.text()).toBe(201);
  const chatId = ((await first.json()) as { chat: { id: string } }).chat.id;
  for (let i = 1; i < TURNS; i++) {
    for (;;) {
      const r = await page.request.post(`/api/v1/chats/${chatId}/messages`, { headers, data: { text: `Long chat message ${i}`, model } });
      if (r.status() === 202) break;
      expect(r.status(), await r.text()).toBe(409); // run_active: the previous answer is still being saved
      await new Promise((res) => setTimeout(res, 20));
    }
  }
  await expect.poll(async () => (await page.request.get("/api/v1/chat-runs/active")).json(), { timeout: 30_000 }).toEqual([]);
  return chatId;
}

/** Start recording keystroke latencies (Event Timing: from the key to the next paint). */
async function watchKeys(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __keys: number[] };
    w.__keys = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (["keydown", "keypress", "keyup", "input", "beforeinput"].includes(e.name)) w.__keys.push(e.duration);
    }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  });
}
const worstKey = (page: Page) => page.evaluate(() => Math.max(0, ...(window as unknown as { __keys: number[] }).__keys));

test("SC-007: a 1,000-message chat opens, scrolls and takes typing without lag; two streams don't slow a note", async ({ page }, testInfo) => {
  // seeding 500 turns rewrites a growing chat file each time: slow on a loaded machine
  test.setTimeout(900_000);
  const t = tag(testInfo.project.name);
  const { url, lineageId } = await openSession(page, `CP${t} 401`);
  const sessionKey = `${lineageId}:${LAYOUT_DATE}`;
  const ep = await seedEndpoint(page, { name: `Perf ${t}`, style: "openai", models: { echo: `Perf echo ${t}`, slow: `Perf slow ${t}` } });
  const echo = ep.models.find((m) => m.modelId === "echo")!;
  await seedLongChat(page, sessionKey, { endpointId: ep.id, modelId: echo.id });
  const note = await seedNote(page, sessionKey, `Perf note ${t}`, "Typing here while answers stream.");
  await page.goto(`${url}?note=${note.id}`);
  const chat = chatSection(page);

  // open it: the last message is on screen in under 2 s
  const item = chat.getByRole("button", { name: "Long chat message 0" });
  await expect(item).toBeVisible();
  const started = Date.now();
  await item.click();
  await expect(conversation(chat).getByRole("article", { name: "You" }).last()).toHaveText(`Long chat message ${TURNS - 1}`);
  await expect(answers(chat).last()).toContainText(`You said: Long chat message ${TURNS - 1}`);
  const openMs = Date.now() - started;
  expect(openMs, `opened in ${openMs} ms`).toBeLessThan(2000);
  // the earlier messages follow in small batches
  await expect.poll(() => conversation(chat).getByRole("article").count(), { timeout: 15_000 }).toBe(TURNS * 2);
  await expect(conversation(chat).getByRole("article", { name: "You" }).last()).toBeInViewport();

  // scroll to the top and back: no long task over 100 ms
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask", buffered: false });
  });
  const scroller = conversation(chat).locator("xpath=..");
  for (const to of ["top", "bottom", "top", "bottom"]) {
    await scroller.evaluate((el, where) => el.scrollTo({ top: where === "top" ? 0 : el.scrollHeight }), to);
    await page.waitForTimeout(400);
  }
  const longest = await page.evaluate(() => Math.max(0, ...(window as unknown as { __long: number[] }).__long));
  expect(longest, `longest task while scrolling: ${longest} ms`).toBeLessThanOrEqual(100);

  // typing in the message box
  await messageBox(chat).click();
  await page.keyboard.type("A");
  await page.waitForTimeout(300);
  await watchKeys(page);
  await page.keyboard.type(" question typed into a long chat", { delay: 30 });
  const boxWorst = await worstKey(page);
  expect(boxWorst, `worst keystroke in the box: ${boxWorst} ms`).toBeLessThan(50);
  await messageBox(chat).fill("");

  // two answers streaming at once (this chat and a new one) while typing in the note
  await pickModel(page, chat, `Perf slow ${t}`);
  await ask(chat, "First slow answer");
  await expect(answers(chat).last()).toContainText("tok1");
  await chat.getByRole("button", { name: "New chat" }).click();
  await pickModel(page, chat, `Perf slow ${t}`);
  await ask(chat, "Second slow answer");
  await expect(answers(chat).last()).toContainText("tok1");
  await expect.poll(async () => ((await (await page.request.get("/api/v1/chat-runs/active")).json()) as unknown[]).length).toBe(2);
  // the first key after focusing the editor wakes it up (also without any stream): warm up first
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" ");
  await page.waitForTimeout(300);
  await watchKeys(page);
  await page.keyboard.type("Notes typed during two streams.", { delay: 30 });
  const noteWorst = await worstKey(page);
  await expect(editor(page)).toContainText("Notes typed during two streams.");
  expect(noteWorst, `worst keystroke in the note: ${noteWorst} ms`).toBeLessThan(50);
  for (const run of (await (await page.request.get("/api/v1/chat-runs/active")).json()) as { id: string }[])
    await page.request.post(`/api/v1/chat-runs/${run.id}/stop`, { headers: { "X-CSRF-Token": await csrf(page) } });
});
