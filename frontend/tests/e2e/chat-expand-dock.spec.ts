/**
 * 014 US5: Expand a chat into a workspace tab and Dock it back, mid-answer — the answer never
 * stops, the draft is kept, focus lands in the message box, and a chat is in one place at a time
 * (contracts/ui-contract.md "Chat tab"). Attachments arrive with US6, so only the draft is checked.
 */
import { expect, test } from "@playwright/test";
import { tag } from "./helpers";
import { mainCard, openSession, sessionPanel, sessionRail } from "./layout-helpers";
import { answers, ask, axeClean, chatSection, conversation, messageBox, pickModel, seedEndpoint } from "./chat-helpers";

// wide enough for split view beside the session panel (007 FR-014a: from 1100 px of main card)
test.use({ viewport: { width: 1920, height: 1080 } });

/** The last "tokN" of a slow answer. */
const tokens = async (text: Promise<string | null>) => Number([...((await text) ?? "").matchAll(/tok(\d+)/g)].at(-1)?.[1] ?? -1);

test("US5: expand mid-answer, split beside a note, dock back, close the tab — nothing interrupted", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const t = tag(testInfo.project.name);
  await openSession(page, `CHX${t} 301`, { note: "Reading notes" });
  await seedEndpoint(page, { name: `Expand ${t}`, style: "openai", models: { slow: `Exp slow ${t}` } });
  await page.reload();
  const panelChat = chatSection(page);
  await pickModel(page, panelChat, `Exp slow ${t}`);
  await ask(panelChat, "A long answer please");
  await expect(answers(panelChat).last()).toContainText("tok1");

  // Expand: the panel closes to its rail, the tab shows the same streaming answer, focus in its box
  await panelChat.getByRole("button", { name: "Expand chat into a tab" }).click();
  await expect(sessionPanel(page)).toBeHidden();
  await expect(sessionRail(page)).toBeVisible();
  const tab = mainCard(page).getByRole("tab", { name: "A long answer please" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const tabPane = mainCard(page).getByRole("tabpanel", { name: "A long answer please" });
  const tabAnswer = answers(tabPane).last();
  const before = await tokens(tabAnswer.textContent());
  await expect.poll(() => tokens(tabAnswer.textContent())).toBeGreaterThan(before);
  await expect(messageBox(tabPane)).toBeFocused();
  await axeClean(page);

  // the panel lists it as "Open in tab"; choosing it switches to the tab
  await sessionRail(page).getByRole("button", { name: /^Chat/ }).click();
  const entry = chatSection(page).getByRole("listitem").filter({ hasText: "Open in tab" });
  await expect(entry).toContainText("A long answer please");
  await expect(conversation(chatSection(page))).toHaveCount(0); // never in both places
  await mainCard(page).getByRole("tab", { name: /^Reading notes/ }).click();
  await entry.getByRole("button", { name: "A long answer please" }).click();
  await expect(tab).toHaveAttribute("aria-selected", "true");

  // split beside the note: both show, the answer keeps streaming
  await page.getByRole("button", { name: "Split" }).click();
  await expect(mainCard(page).getByRole("tabpanel")).toHaveCount(2);
  await expect(conversation(mainCard(page))).toBeVisible();
  await expect(mainCard(page).getByRole("tabpanel", { name: /^Reading notes/ })).toBeVisible();
  const split = await tokens(answers(mainCard(page)).last().textContent());
  await expect.poll(() => tokens(answers(mainCard(page)).last().textContent())).toBeGreaterThan(split);
  await page.getByRole("button", { name: "Split" }).click();

  // a draft typed in the tab goes with the chat; Dock: the tab closes, the panel shows it
  await tab.click();
  await messageBox(tabPane).fill("Follow-up draft");
  await tabPane.getByRole("button", { name: "Dock chat to the panel" }).click();
  await expect(tab).toHaveCount(0);
  const docked = chatSection(page);
  await expect(docked.getByRole("heading", { level: 3, name: "A long answer please" })).toBeVisible();
  await expect(messageBox(docked)).toBeFocused();
  await expect(messageBox(docked)).toHaveValue("Follow-up draft");
  const dockedAt = await tokens(answers(docked).last().textContent());
  await expect.poll(() => tokens(answers(docked).last().textContent())).toBeGreaterThan(dockedAt);

  // expand again, then close the tab: the answer finishes and is saved
  await docked.getByRole("button", { name: "Expand chat into a tab" }).click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await tab.press("Delete");
  await expect(tab).toHaveCount(0);
  await expect.poll(async () => (await (await page.request.get("/api/v1/chat-runs/active")).json()).length, { timeout: 30_000 }).toBe(0);
  await sessionRail(page).getByRole("button", { name: /^Chat/ }).click();
  const back = chatSection(page);
  await back.getByRole("button", { name: "A long answer please" }).click();
  await expect(answers(back).last()).toContainText("tok199");
  await expect(answers(back).last()).not.toContainText("Stopped");
});

test("US5: expanding a new empty chat opens an empty chat tab; docking it shows the new-chat box", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `CHX${t} 302`);
  await seedEndpoint(page, { name: `Empty ${t}`, style: "openai", models: { echo: `Empty echo ${t}` } });
  await page.reload();
  await chatSection(page).getByRole("button", { name: "Expand chat into a tab" }).click();
  const tab = mainCard(page).getByRole("tab", { name: "New chat" });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const pane = mainCard(page).getByRole("tabpanel", { name: "New chat" });
  await expect(messageBox(pane)).toBeFocused();
  // sending from the empty tab turns it into that chat
  await pickModel(page, pane, `Empty echo ${t}`);
  await messageBox(pane).fill("Started in a tab");
  await messageBox(pane).press("Enter");
  const named = mainCard(page).getByRole("tab", { name: "Started in a tab" });
  await expect(named).toHaveAttribute("aria-selected", "true");
  await expect(answers(mainCard(page)).last()).toContainText("You said: Started in a tab");
  await mainCard(page).getByRole("button", { name: "Dock chat to the panel" }).click();
  await expect(named).toHaveCount(0);
  await expect(chatSection(page).getByRole("heading", { level: 3, name: "Started in a tab" })).toBeVisible();
  await expect(messageBox(chatSection(page))).toBeFocused();
});
