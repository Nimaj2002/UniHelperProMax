/**
 * 014 US4: each session's chat history — its own chats only, five then More, rename, delete with
 * Undo, title search, two answers at once, drafts that survive a reload, and deletions that name
 * the chats (contracts/ui-contract.md "History view").
 */
import { expect, test, type Page } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";
import { LAYOUT_DATE, mainCard, sessionPanel, sessionRail, VIEWPORT } from "./layout-helpers";
import { workspaceUrl } from "./notes-helpers";
import { answers, ask, axeClean, chatSection, messageBox, pickModel, seedEndpoint } from "./chat-helpers";

test.use({ viewport: VIEWPORT });

async function csrfHeaders(page: Page) {
  return { "X-CSRF-Token": (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "" };
}

/** A one-session course on LAYOUT_DATE; returns its workspace URL and session key. */
async function seedSession(page: Page, course: string) {
  const cls = await seedClass(page, {
    course: newHierarchy(course, `Sem ${course}`, `Year ${course}`, "2027-01-10"),
    title: "Lecture", startDate: LAYOUT_DATE, startTime: "10:00", endTime: "11:30", color: "teal", recurrence: { freq: "none" },
  });
  return { url: workspaceUrl(cls.courseId, cls.lineageId, LAYOUT_DATE), key: `${cls.lineageId}:${LAYOUT_DATE}`, course };
}

/** A chat with its first message, through the API (the echo answer comes within a second). */
async function seedChat(page: Page, key: string, text: string, model: { endpointId: string; modelId: string }) {
  const r = await page.request.post(`/api/v1/sessions/${encodeURIComponent(key)}/chats`, { headers: await csrfHeaders(page), data: { text, model } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as { chat: { id: string } };
}

async function openWorkspace(page: Page, url: string) {
  await page.goto(url);
  await expect(mainCard(page)).toBeVisible();
  const reopen = sessionRail(page).getByRole("button", { name: "Show session panel" });
  await expect(sessionPanel(page).or(reopen).first()).toBeVisible();
  if (await reopen.isVisible()) await reopen.click();
  await expect(chatSection(page)).toBeVisible();
}

test("US4: chats per session, More, rename, delete and Undo, search, drafts, deletion names chats", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const t = tag(testInfo.project.name);
  await signIn(page);
  const ep = await seedEndpoint(page, { name: `History ${t}`, style: "openai", models: { echo: `Hist echo ${t}`, slow: `Hist slow ${t}` } });
  const echo = { endpointId: ep.id, modelId: ep.models.find((m) => m.modelId === "echo")!.id };
  const a = await seedSession(page, `CHH${t} 201`);
  const b = await seedSession(page, `CHH${t} 202`);
  const titles = ["Heaps and stacks", "Graph search", "Dynamic programming", "Exam topics", "Week 3 recap", "Hash tables"];
  for (const title of titles) await seedChat(page, a.key, title, echo);
  await seedChat(page, b.key, "Only in B", echo);

  // A shows its own chats, newest first, five then More (1)
  await openWorkspace(page, a.url);
  const chat = chatSection(page);
  const list = chat.getByRole("list", { name: "Chats" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await expect(list.getByRole("listitem").first()).toContainText("Hash tables");
  await expect(list.getByRole("listitem").first().locator("time")).toHaveAttribute("title", /\d{4}/);
  await expect(chat.getByRole("button", { name: "Only in B" })).toHaveCount(0);
  await chat.getByRole("button", { name: "More (1)" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(6);
  await expect(chat.getByRole("button", { name: "Heaps and stacks" })).toBeVisible();
  await axeClean(page);

  // rename by keyboard
  const graph = list.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Graph search" }) });
  await graph.getByRole("button", { name: "Chat actions" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Rename" }).press("Enter");
  const input = chat.getByRole("textbox", { name: "Chat title" });
  await input.fill("Graph search (BFS, DFS)");
  await input.press("Enter");
  await expect(chat.getByRole("button", { name: "Graph search (BFS, DFS)" })).toBeVisible();

  // delete, then Undo
  const exam = list.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Exam topics" }) });
  await exam.getByRole("button", { name: "Chat actions" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(chat.getByRole("button", { name: "Exam topics" })).toHaveCount(0);
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Chat deleted" });
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(chat.getByRole("button", { name: "Exam topics" })).toBeVisible();

  // title search
  await chat.getByRole("button", { name: "Search chats" }).click();
  await chat.getByRole("searchbox", { name: "Search chats" }).fill("graph");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(chat.getByRole("button", { name: "Graph search (BFS, DFS)" })).toBeVisible();
  await chat.getByRole("button", { name: "Search chats" }).click();
  await expect(chat.getByRole("searchbox", { name: "Search chats" })).toBeHidden();

  // two answers at once in one session
  await chat.getByRole("button", { name: "Heaps and stacks" }).click();
  await pickModel(page, chat, `Hist slow ${t}`);
  await ask(chat, "Slow one");
  await expect(answers(chat).last()).toContainText("tok1");
  await chat.getByRole("button", { name: "Back to history" }).click();
  await chat.getByRole("button", { name: "Hash tables" }).click();
  await pickModel(page, chat, `Hist slow ${t}`);
  await ask(chat, "Slow two");
  await expect(answers(chat).last()).toContainText("tok1");
  await chat.getByRole("button", { name: "New chat" }).click();
  await expect(list.getByText("Generating")).toHaveCount(2);
  const active = (await (await page.request.get("/api/v1/chat-runs/active")).json()) as { id: string }[];
  expect(active.length).toBeGreaterThanOrEqual(2);
  for (const r of active) await page.request.post(`/api/v1/chat-runs/${r.id}/stop`, { headers: await csrfHeaders(page) });
  await expect(list.getByText("Generating")).toHaveCount(0);

  // the new-chat draft survives a reload
  await messageBox(chat).fill("An unsent question");
  await page.waitForTimeout(700);
  await page.reload();
  await expect(messageBox(chatSection(page))).toHaveValue("An unsent question");

  // B shows only its own chat
  await openWorkspace(page, b.url);
  await expect(chatSection(page).getByRole("list", { name: "Chats" }).getByRole("listitem")).toHaveCount(1);
  await expect(chatSection(page).getByRole("button", { name: "Only in B" })).toBeVisible();

  // deleting A's course names its chats
  await page.goto("/calendar/week/2026-12-07");
  await page.getByRole("navigation", { name: "Courses" }).getByRole("button", { name: `Actions for ${a.course}` }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("6 chats");
  await confirm.getByRole("button", { name: "Cancel" }).click();

  // the session's own delete dialog lists the chat titles
  await page.goto(`/sessions/${encodeURIComponent(b.key)}/delete`);
  const sessionConfirm = page.getByRole("alertdialog");
  await expect(sessionConfirm).toContainText("1 chat");
  await expect(sessionConfirm).toContainText("Chats: Only in B.");
  await sessionConfirm.getByRole("button", { name: "Cancel" }).click();
});
