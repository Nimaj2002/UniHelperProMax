/**
 * 014 US10: Add to note (an existing note open in the editor, merged without a conflict, and a
 * new note), edit and resend the last message ("‹ 2/2 ›" on the user message), custom
 * instructions, token usage on `big-usage`, and a search of the messages' text.
 */
import { expect, test } from "@playwright/test";
import { tag } from "./helpers";
import { LAYOUT_DATE, openSession, VIEWPORT } from "./layout-helpers";
import { waitSaved } from "./notes-helpers";
import {
  answers,
  ask,
  axeClean,
  chatSection,
  conversation,
  csrf,
  messageBox,
  noteEditor as editor,
  pickModel,
  seedEndpoint,
  chatFirst,
} from "./chat-helpers";
import { seedNote } from "./chat-fixtures";

test.use({ viewport: VIEWPORT });
test.beforeEach(({ page }) => chatFirst(page));

const CHAT = "#workspace-session-panel";

test("US10: add an answer to an open note and to a new note; edit and resend the last message", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  const { url, lineageId } = await openSession(page, `CE${t} 301`);
  const sessionKey = `${lineageId}:${LAYOUT_DATE}`;
  await seedEndpoint(page, {
    name: `Extras ${t}`,
    style: "openai",
    models: { echo: `Extras echo ${t}` },
  });
  const summary = await seedNote(
    page,
    sessionKey,
    `Summary ${t}`,
    "My summary so far.",
  );
  await page.goto(`${url}?note=${summary.id}`);
  await expect(editor(page)).toContainText("My summary so far.");
  const chat = chatSection(page);
  await pickModel(page, chat, `Extras echo ${t}`);
  await ask(chat, "Explain stacks");
  const answer = answers(chat).last();
  await expect(answer).toContainText("You said: Explain stacks");

  // into the open note: merged at the end, with no conflict
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Typed meanwhile.");
  await answer.getByRole("button", { name: "Add to note" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to note" });
  await dialog.getByRole("radio", { name: `Summary ${t}` }).check();
  await axeClean(page, '[role="dialog"]');
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Added to “Summary ${t}”`)).toBeVisible();
  await expect(editor(page)).toContainText("You said: Explain stacks", {
    timeout: 10_000,
  });
  await expect(editor(page)).toContainText(
    "My summary so far. Typed meanwhile.",
  );
  await expect(editor(page)).toContainText(
    /Chat — Explain stacks · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
  );
  await expect(
    page.getByRole("dialog", { name: /conflict|changed/i }),
  ).toHaveCount(0);
  await waitSaved(page, `Summary ${t}`);
  const saved = await (
    await page.request.get(`/api/v1/notes/${summary.id}`)
  ).json();
  expect(saved.content.startsWith("My summary so far. Typed meanwhile.")).toBe(
    true,
  );
  expect(saved.content).toContain("You said: Explain stacks");

  // into a new note, then "Open note"
  await answer.getByRole("button", { name: "Add to note" }).click();
  await dialog.getByRole("radio", { name: "New note…" }).check();
  await dialog
    .getByRole("textbox", { name: "New note name" })
    .fill(`From chat ${t}`);
  await dialog.getByRole("button", { name: "Add" }).click();
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: `Added to “From chat ${t}”` });
  await toast.getByRole("button", { name: "Open note" }).click();
  await expect(
    page.getByRole("tab", { name: new RegExp(`^From chat ${t}`) }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor(page)).toContainText("You said: Explain stacks");

  // edit and resend the last message: version 2 of 2, version 1 kept with its answer
  const mine = conversation(chat).getByRole("article", { name: "You" }).last();
  await mine.getByRole("button", { name: "Edit and resend" }).click();
  const edit = mine.getByRole("textbox", { name: "Edit message" });
  await expect(edit).toHaveValue("Explain stacks");
  await edit.fill("Explain queues");
  await mine.getByRole("button", { name: "Send", exact: true }).click();
  await expect(answers(chat).last()).toContainText("You said: Explain queues");
  const user = conversation(chat).getByRole("article", { name: "You" }).last();
  await expect(
    user.getByRole("group", { name: "Message version 2 of 2" }),
  ).toBeVisible();
  await expect(user).toContainText("2/2");
  await user.getByRole("button", { name: "Previous message version" }).click();
  await expect(user).toContainText("Explain stacks");
  await expect(answers(chat).last()).toContainText("You said: Explain stacks");
  await expect(
    user.getByRole("group", { name: "Message version 1 of 2" }),
  ).toBeVisible();
  // the chat only: the note editor's own toolbar is checked by the editor's specs
  await axeClean(page, CHAT);
});

test("US10: custom instructions, usage on big-usage, and search in the messages", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  const { url } = await openSession(page, `CS${t} 302`);
  await seedEndpoint(page, {
    name: `Usage ${t}`,
    style: "openai",
    models: { "big-usage": `Counter ${t}`, echo: `Searcher ${t}` },
  });

  // custom instructions are saved with the settings' version and come back
  await page.goto("/settings/ai");
  const instructions = page.getByRole("textbox", {
    name: "Custom instructions",
  });
  await expect(instructions).toBeEnabled();
  const text = `Answer briefly (${t}).`;
  await instructions.fill(text);
  await page.getByRole("button", { name: "Save instructions" }).click();
  await expect(page.getByText("Custom instructions saved.")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "Custom instructions" }),
  ).toHaveValue(text);
  await axeClean(page);
  expect(
    (await (await page.request.get("/api/v1/ai/settings")).json())
      .customInstructions,
  ).toBe(text);
  await page.goto(url);

  const chat = chatSection(page);
  await expect(messageBox(chat)).toBeEnabled();
  await pickModel(page, chat, `Counter ${t}`);
  await ask(chat, "Count the tokens");
  await expect(answers(chat).last()).toContainText(
    /Tokens: in [\d,]+ · out [\d,]+/,
  );

  // a word that only appears in the answers ("You said: …")
  await pickModel(page, chat, `Searcher ${t}`);
  await ask(chat, `Remember zebra${t}`);
  await expect(answers(chat).last()).toContainText(
    `You said: Remember zebra${t}`,
  );
  await chat.getByRole("button", { name: "Back to history" }).click();
  await chat.getByRole("button", { name: "Search chats" }).click();
  const search = chat.getByRole("searchbox", { name: "Search chats" });
  await search.fill("said");
  await expect(chat.getByText("No chat titles match.")).toBeVisible();
  await chat.getByRole("switch", { name: "Search in messages" }).click();
  const hit = chat.getByRole("list", { name: "Chats" }).getByRole("listitem");
  await expect(hit).toHaveCount(1);
  await expect(hit.getByTestId("chat-match")).toContainText("said");
  await search.fill(`zebra${t}`);
  await expect(hit.getByTestId("chat-match")).toContainText(`zebra${t}`);
  await axeClean(page);
  // reset for the other project run
  await page.request.put("/api/v1/ai/settings", {
    headers: {
      "X-CSRF-Token": await csrf(page),
      "If-Match": `"${(await (await page.request.get("/api/v1/ai/settings")).json()).version}"`,
    },
    data: { customInstructions: "" },
  });
});
