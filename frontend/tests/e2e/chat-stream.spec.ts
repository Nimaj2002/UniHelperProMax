/**
 * 014 US3: ask in a session's Chat section and watch the answer stream; Stop, Regenerate, switch
 * the model to another style, classified errors with Retry, the remote privacy notice, safe
 * Markdown, and the rail's indicators (contracts/ui-contract.md, chat-stream.md).
 */
import { expect, test } from "@playwright/test";
import { tag } from "./helpers";
import { openSession, sessionPanel, sessionRail, VIEWPORT } from "./layout-helpers";
import { answers, ask, axeClean, chatSection, conversation, messageBox, pickModel, seedEndpoint } from "./chat-helpers";

test.use({ viewport: VIEWPORT });

test("US3: streams, stops with Escape, regenerates and switches style mid-chat", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  await openSession(page, `CH${t} 101`);
  await seedEndpoint(page, { name: `Fake OpenAI ${t}1`, style: "openai", models: { echo: `Echo ${t}1`, slow: `Slow ${t}1` } });
  await seedEndpoint(page, { name: `Fake Claude ${t}1`, style: "anthropic", models: { echo: `Claude echo ${t}1` } });
  await page.reload();
  const chat = chatSection(page);
  const box = messageBox(chat);
  await expect(box).toBeEnabled();

  // ask → the answer appears with its endpoint and model
  await pickModel(page, chat, `Echo ${t}1`);
  await ask(chat, "What is a heap?");
  await expect(chat.getByRole("heading", { level: 3, name: "What is a heap?" })).toBeVisible();
  await expect(conversation(chat).getByRole("article", { name: "You" })).toHaveText("What is a heap?");
  await expect(answers(chat).last()).toContainText("You said: What is a heap?");
  await expect(answers(chat).last()).toContainText(`Fake OpenAI ${t}1 · Echo ${t}1`);
  await expect(answers(chat).last()).toContainText("Local");
  await axeClean(page);

  // a slow answer streams progressively; Escape in the box stops it, focus stays in the box
  await pickModel(page, chat, `Slow ${t}1`);
  await ask(chat, "Count for me");
  const slow = answers(chat).last();
  await expect(slow).toContainText("tok2");
  await expect(slow).not.toContainText("tok60");
  await expect(slow).toContainText("tok5");
  await expect(chat.getByRole("button", { name: "Stop" })).toBeVisible();
  await box.focus();
  await page.keyboard.press("Escape");
  await expect(slow).toContainText("Stopped");
  await expect(box).toBeFocused();
  await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeVisible();
  const stoppedText = await slow.textContent();
  await page.waitForTimeout(600);
  expect(await slow.textContent()).toBe(stoppedText);

  // Regenerate (with the chat's model, now Echo) keeps the stopped answer as version 1
  await pickModel(page, chat, `Echo ${t}1`);
  await slow.getByRole("button", { name: "Regenerate" }).click();
  await expect(answers(chat).last()).toContainText("You said: Count for me");
  await expect(answers(chat).last().getByRole("group", { name: "Answer version 2 of 2" })).toBeVisible();
  await expect(answers(chat).last()).toContainText("2/2");
  await answers(chat).last().getByRole("button", { name: "Previous answer version" }).click();
  await expect(answers(chat).last()).toContainText("Stopped");
  await expect(answers(chat).last().getByRole("group", { name: "Answer version 1 of 2" })).toBeVisible();

  // another style mid-chat: the next answer is labelled with it
  await pickModel(page, chat, `Claude echo ${t}1`);
  await ask(chat, "And in Anthropic style?");
  await expect(answers(chat).last()).toContainText("You said: And in Anthropic style?");
  await expect(answers(chat).last()).toContainText(`Fake Claude ${t}1 · Claude echo ${t}1`);
  await axeClean(page);
});

test("US3: a rejected key is explained with a Settings link, and Retry works after fixing it", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `CH${t} 102`);
  await seedEndpoint(page, { name: `Keys ${t}`, style: "openai", models: { "fail-401": `Bad key ${t}`, echo: `Good key ${t}` } });
  await page.reload();
  const chat = chatSection(page);
  await pickModel(page, chat, `Bad key ${t}`);
  await ask(chat, "Will this work?");
  const failed = answers(chat).last();
  await expect(failed).toContainText("The provider rejected the key.");
  await expect(failed.getByRole("link", { name: "Open AI settings" })).toHaveAttribute("href", "/settings/ai");
  await expect(chat.getByRole("status")).toHaveText("Answer failed: key rejected");
  await axeClean(page);
  // "fix" it by choosing a model that is accepted, then Retry the same message
  await pickModel(page, chat, `Good key ${t}`);
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(answers(chat).last()).toContainText("You said: Will this work?");
  await expect(chat.getByRole("status")).toHaveText("Answer complete");
});

test("US3: the privacy notice shows once before the first message to a remote endpoint", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `CH${t} 103`);
  const name = `Remote ${t}`;
  await seedEndpoint(page, { name, style: "openai", baseUrl: "https://llm.example.com/v1", models: { "remote-model": `Far model ${t}` } });
  await page.reload();
  const chat = chatSection(page);
  await pickModel(page, chat, `Far model ${t}`);
  await expect(chat.getByRole("button", { name: `Model: Far model ${t}, Remote` })).toBeVisible();
  const box = messageBox(chat);
  await box.fill("A private question");
  await box.press("Enter");
  const notice = page.getByRole("alertdialog");
  await expect(notice).toContainText(`Messages and attachments will be sent to llm.example.com, the address you set up for ${name}.`);
  await axeClean(page);
  await notice.getByRole("button", { name: "Cancel" }).click();
  await expect(notice).toBeHidden();
  await expect(box).toHaveValue("A private question"); // nothing typed is lost
  await box.press("Enter");
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Send", exact: true }).click();
  await expect(notice).toBeHidden();
  await expect(box).toHaveValue("");
  await expect(conversation(chat).getByRole("article", { name: "You" })).toHaveText("A private question");
  // acknowledged once: no notice next time (the unreachable host fails the answer, which is fine)
  await expect(chat.getByRole("button", { name: "Send", exact: true })).toBeVisible({ timeout: 30_000 });
  await ask(chat, "Second question");
  await expect(notice).toBeHidden();
  await expect(conversation(chat).getByRole("article", { name: "You" }).last()).toHaveText("Second question");
});

test("US3: links open outside, remote images are not loaded", async ({ page }, testInfo) => {
  const t = tag(testInfo.project.name);
  await openSession(page, `CH${t} 104`);
  await seedEndpoint(page, { name: `Md ${t}`, style: "gemini", models: { echo: `Gemini echo ${t}` } });
  await page.reload();
  let imageRequested = false;
  await page.route("https://img.example.com/**", (route) => {
    imageRequested = true;
    return route.abort();
  });
  const chat = chatSection(page);
  await pickModel(page, chat, `Gemini echo ${t}`);
  await ask(chat, "See [the docs](https://example.com/docs) and ![a chart](https://img.example.com/chart.png)\n\n```python\nprint(1)\n```");
  const answer = answers(chat).last();
  const link = answer.getByRole("link", { name: "the docs" });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(answer).toContainText("Remote image not loaded (a chart)");
  await expect(answer.getByRole("link", { name: "Open link" })).toHaveAttribute("href", "https://img.example.com/chart.png");
  await expect(answer.locator("img")).toHaveCount(0);
  await expect(answer).toContainText("python");
  await expect(answer.getByRole("button", { name: "Copy code" })).toBeVisible();
  await axeClean(page);
  expect(imageRequested).toBe(false);
});

test("US3: closing the panel during an answer shows the rail's spinner, then the new-answer dot", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  await openSession(page, `CH${t} 105`);
  await seedEndpoint(page, { name: `Rail ${t}`, style: "openai", models: { slow: `Rail slow ${t}` } });
  await page.reload();
  const chat = chatSection(page);
  await pickModel(page, chat, `Rail slow ${t}`);
  await ask(chat, "Take your time");
  await expect(answers(chat).last()).toContainText("tok1");
  await sessionPanel(page).getByRole("button", { name: "Close session panel" }).click();
  const railChat = sessionRail(page).getByRole("button", { name: /^Chat/ });
  await expect(railChat).toHaveAccessibleName(/answer being generated/);
  // focus mode hides the rail: the pill still says an answer is coming
  await expect(page.getByRole("region", { name: "Answering" })).toBeVisible();
  await expect(railChat).toHaveAccessibleName(/new answer/, { timeout: 40_000 });
  await expect(railChat).not.toHaveAccessibleName(/being generated/);
  await expect(page.getByRole("region", { name: "Answering" })).toBeHidden();
  // opening the chat again counts the answer as seen
  await railChat.click();
  await expect(answers(chat).last()).toContainText("tok199");
  await expect(railChat.or(sessionPanel(page)).first()).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/v1/chat-runs/active`)).json()).toEqual([]);
});
