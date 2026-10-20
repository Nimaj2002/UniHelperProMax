/**
 * 014 FR-074 (T129): with the browser cut off from everything but this computer (every
 * non-localhost request is aborted), a chat with a Local endpoint works end to end, and a Remote
 * endpoint that can't be reached shows the network error with Retry.
 */
import { expect, test } from "@playwright/test";
import { tag } from "./helpers";
import { openSession, VIEWPORT } from "./layout-helpers";
import { answers, ask, axeClean, chatSection, messageBox, pickModel, seedEndpoint } from "./chat-helpers";

test.use({ viewport: VIEWPORT });

test("FR-074: a local endpoint works offline; an unreachable remote one says so with Retry", async ({ page, context }, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  const outside: string[] = [];
  await context.setOffline(false);
  await context.route(
    (url) => !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname),
    (route) => {
      outside.push(route.request().url());
      return route.abort("internetdisconnected");
    },
  );
  await openSession(page, `CO${t} 601`);
  await seedEndpoint(page, { name: `On this computer ${t}`, style: "openai", models: { echo: `Local echo ${t}` } });
  // `.invalid` never resolves (RFC 2606): the provider is unreachable from the server too
  await seedEndpoint(page, { name: `Far away ${t}`, style: "openai", baseUrl: "https://llm.unreachable.invalid/v1", models: { far: `Unreachable model ${t}` } });
  await page.reload();
  const chat = chatSection(page);

  await pickModel(page, chat, `Local echo ${t}`);
  await expect(chat.getByRole("button", { name: `Model: Local echo ${t}, Local` })).toBeVisible();
  await ask(chat, "Does this work offline?");
  await expect(answers(chat).last()).toContainText("You said: Does this work offline?");
  await expect(answers(chat).last()).toContainText("Local");
  await expect(chat.getByRole("status")).toHaveText("Answer complete");

  await pickModel(page, chat, `Unreachable model ${t}`);
  await messageBox(chat).fill("And the remote one?");
  await messageBox(chat).press("Enter");
  await page.getByRole("alertdialog").getByRole("button", { name: "Send" }).click();
  const failed = answers(chat).last();
  await expect(failed).toContainText("Couldn't reach llm.unreachable.invalid. Check your connection.", { timeout: 30_000 });
  await expect(failed.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(chat.getByRole("status")).toHaveText("Answer failed: network");
  await axeClean(page);
  // the local model is still there for the Retry
  await pickModel(page, chat, `Local echo ${t}`);
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(answers(chat).last()).toContainText("You said: And the remote one?");
  expect(outside).toEqual([]);
});
