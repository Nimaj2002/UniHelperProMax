/**
 * 014 FR-069–FR-073, SC-008 (T128): the chat by keyboard only — Alt+K, typing, Enter, Escape to
 * stop, the model picker with arrows, the Attach menu, the history menu's Rename/Delete/Undo,
 * Expand and Dock — with focus coming back to the message box; the status region announcing only
 * the start and the end of an answer; axe in light, dark and a user-created theme; and reduced
 * motion (no animations, the indicators still shown).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { tag } from "./helpers";
import { openSession, sessionPanel, VIEWPORT } from "./layout-helpers";
import { answers, axeClean, chatSection, csrf, pickModel, seedEndpoint } from "./chat-helpers";

test.use({ viewport: VIEWPORT });

const panelBox = (page: Page) => page.locator("#chat-box-panel");

/** Collect every text the chat's status region shows from now on. */
async function recordAnnouncements(region: Locator) {
  await region.evaluate((el) => {
    const w = window as unknown as { __said: string[] };
    w.__said = [];
    new MutationObserver(() => {
      const text = el.textContent ?? "";
      if (text && w.__said.at(-1) !== text) w.__said.push(text);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}
const announced = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said);

test("SC-008: the whole chat flow by keyboard, with focus returning to the message box", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const t = tag(testInfo.project.name);
  await openSession(page, `CY${t} 501`);
  await seedEndpoint(page, { name: `Keyboard ${t}`, style: "openai", models: { echo: `Key echo ${t}`, slow: `Key slow ${t}` } });
  await page.reload();
  await expect(sessionPanel(page)).toBeVisible();

  // Alt+] closes the panel; Alt+K opens it with Chat and focuses the box
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Alt+BracketRight");
  await expect(sessionPanel(page)).toBeHidden();
  await page.keyboard.press("Alt+KeyK");
  await expect(panelBox(page)).toBeFocused();
  const chat = chatSection(page);
  await expect(chat.getByRole("button", { name: "New chat" })).toHaveAttribute("aria-keyshortcuts", "Alt+Shift+K");
  await expect(panelBox(page)).toHaveAttribute("aria-keyshortcuts", /Alt\+K/);

  // the model picker by arrows (Tab → Attach → Model); the default is the account's last model
  const models = page.getByRole("listbox", { name: "Models" });
  const choose = async (name: string) => {
    await panelBox(page).focus();
    await page.keyboard.press("Tab");
    await expect(chat.getByRole("button", { name: "Attach" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(chat.getByRole("button", { name: /^Model: / })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(models).toBeFocused();
    for (let i = 0; i < 40; i++) {
      if ((await models.getAttribute("aria-activedescendant")) === (await models.getByRole("option", { name: new RegExp(`^${name}`) }).getAttribute("id"))) break;
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");
    await expect(models).toBeHidden();
    await expect(chat.getByRole("button", { name: new RegExp(`^Model: ${name},`) })).toBeVisible();
    await expect(panelBox(page)).toBeFocused();
  };
  await choose(`Key echo ${t}`);

  // type, Enter (the chat starts), then the next answer: only "started" and "complete" are announced
  await page.keyboard.type("Hello by keyboard");
  await page.keyboard.press("Enter");
  await expect(answers(chat).last()).toContainText("You said: Hello by keyboard");
  const status = chat.getByRole("status");
  await expect(status).toHaveText("Answer complete");
  await recordAnnouncements(status);
  await panelBox(page).focus();
  await page.keyboard.type("And once more");
  await page.keyboard.press("Enter");
  await expect(answers(chat).last()).toContainText("You said: And once more");
  await expect(status).toHaveText("Answer complete");
  expect(await announced(page)).toEqual(["Answer started", "Answer complete"]);
  await expect(panelBox(page)).toBeFocused();

  await choose(`Key slow ${t}`);

  // a slow answer; Escape stops it and focus stays in the box
  await page.keyboard.type("Count slowly");
  await page.keyboard.press("Enter");
  await expect(answers(chat).last()).toContainText("tok2");
  await page.keyboard.press("Escape");
  await expect(answers(chat).last()).toContainText("Stopped");
  await expect(status).toHaveText("Answer stopped");
  await expect(panelBox(page)).toBeFocused();

  // the Attach menu opens and closes by keyboard, back to the box
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Notes…" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Pictures…" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(panelBox(page)).toBeFocused();

  // history: Rename, Delete and Undo from the item's menu
  await chat.getByRole("button", { name: "Back to history" }).focus();
  await page.keyboard.press("Enter");
  await expect(panelBox(page)).toBeFocused();
  const list = chat.getByRole("list", { name: "Chats" });
  await list.getByRole("button", { name: "Chat actions" }).first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeFocused();
  await page.keyboard.press("Enter");
  const title = chat.getByRole("textbox", { name: "Chat title" });
  await expect(title).toBeFocused();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(`Keyboard chat ${t}`);
  await page.keyboard.press("Enter");
  const renamed = list.getByRole("button", { name: `Keyboard chat ${t}` });
  await expect(renamed).toBeFocused();
  await list.getByRole("button", { name: "Chat actions" }).first().focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Delete" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(renamed).toBeHidden();
  const undo = page.locator("[data-sonner-toast]").filter({ hasText: "Chat deleted" }).getByRole("button", { name: "Undo" });
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(renamed).toBeVisible();

  // Expand into a tab and Dock back, focus following the box
  await chat.getByRole("button", { name: "Expand chat into a tab" }).focus();
  await page.keyboard.press("Enter");
  const tabBox = page.locator("[id^=chat-box-tab-]");
  await expect(tabBox).toBeFocused();
  await page.getByRole("button", { name: "Dock chat to the panel" }).focus();
  await page.keyboard.press("Enter");
  await expect(panelBox(page)).toBeFocused();
  // Alt+Shift+K: a new chat in the panel
  await page.keyboard.press("Alt+Shift+KeyK");
  await expect(panelBox(page)).toBeFocused();
  await expect(chat.getByRole("list", { name: "Chats" })).toBeVisible();
});

test("FR-069: axe passes in this colour scheme and in a user-created theme", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const t = tag(testInfo.project.name);
  const { url } = await openSession(page, `CZ${t} 502`);
  await seedEndpoint(page, { name: `Themes ${t}`, style: "openai", models: { echo: `Theme echo ${t}` } });
  await page.reload();
  const chat = chatSection(page);
  await pickModel(page, chat, `Theme echo ${t}`);
  const check = async () => {
    await expect(chat.getByRole("textbox", { name: "Message" })).toBeEnabled();
    await axeClean(page);
    await chat.getByRole("textbox", { name: "Message" }).fill("Theme check with `code` and **bold**");
    await chat.getByRole("textbox", { name: "Message" }).press("Enter");
    await expect(answers(chat).last()).toContainText("You said:");
    await axeClean(page);
    await chat.getByRole("button", { name: "Attach" }).click();
    await axeClean(page, '[role="menu"]');
    await page.keyboard.press("Escape");
  };
  await check();
  if (testInfo.project.name.includes("dark")) return;
  const setTheme = async (theme: string) =>
    expect((await page.request.patch("/api/v1/preferences", { data: { theme }, headers: { "X-CSRF-Token": await csrf(page) } })).ok()).toBe(true);
  try {
    await page.goto("/settings/appearance");
    await page.getByRole("button", { name: "New theme…" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(`Chat a11y ${t}`);
    await page.getByRole("button", { name: "Create and edit" }).click();
    await page.getByRole("button", { name: "Save theme" }).click();
    await page.getByRole("radio", { name: new RegExp(`Chat a11y ${t}`) }).click();
    await page.goto(url);
    await check();
  } finally {
    await setTheme("system");
  }
});

test("FR-073: with reduced motion nothing animates and the indicators stay visible", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openSession(page, `CR${t} 503`);
  await seedEndpoint(page, { name: `Motion ${t}`, style: "openai", models: { slow: `Motion slow ${t}` } });
  await page.reload();
  const chat = chatSection(page);
  await pickModel(page, chat, `Motion slow ${t}`);
  await chat.getByRole("textbox", { name: "Message" }).fill("Take your time");
  await chat.getByRole("textbox", { name: "Message" }).press("Enter");
  await expect(answers(chat).last()).toContainText("tok1");
  await expect(answers(chat).last()).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("region", { name: "Answering" })).toBeVisible();
  await chat.getByRole("button", { name: "Back to history" }).click();
  await expect(chat.getByText("Generating")).toBeVisible();
  const running = await page.evaluate(() =>
    document.getAnimations().filter((a) => a.playState === "running" && (a.effect?.getTiming().iterations ?? 1) === Infinity).length,
  );
  expect(running).toBe(0);
  for (const run of (await (await page.request.get("/api/v1/chat-runs/active")).json()) as { id: string }[])
    await page.request.post(`/api/v1/chat-runs/${run.id}/stop`, { headers: { "X-CSRF-Token": await csrf(page) } });
});
