/**
 * 022 T073: a lesson end to end against the fake LLM's scripted `teacher` model — AI Teacher in
 * the session panel, a new lesson tab, a question card answered and graded, a dispute, the plan,
 * closing the tab feeds the knowledge graph, and the graph on the home page links back to the
 * lesson. Runs in the light and dark projects; axe on the teacher tab and the graph.
 */
import { expect, test, type Page } from "@playwright/test";
import { axeClean, pickModel, seedEndpoint } from "./chat-helpers";
import { tag } from "./helpers";
import { mainCard, openSession, sessionPanel } from "./layout-helpers";

const LLM = `http://localhost:${process.env.E2E_LLM_PORT ?? 8021}`;

const block = (kind: string, payload: unknown) => `\`\`\`uh-${kind}\n${JSON.stringify(payload)}\n\`\`\`\n`;

async function script(page: Page, replies: string[]) {
  const r = await page.request.post(`${LLM}/test/script`, { data: { reset: true, replies } });
  expect(r.ok()).toBe(true);
}

test.use({ viewport: { width: 1440, height: 900 } });
test.beforeEach(({ page }) =>
  page.addInitScript(() => {
    if (!localStorage.getItem("uh.sessionPanel"))
      localStorage.setItem("uh.sessionPanel", JSON.stringify({ open: true, width: 340, section: "teacher" }));
  }),
);

test("a lesson: question card, grade, dispute, plan, knowledge graph and back", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const t = tag(testInfo.project.name);
  const idea = `Singular matrix ${t}`;
  await script(page, [
    "Let us find where to start.\n" +
      block("plan", { mermaid: "graph TD\n  a[Determinant] --> b[Singular]", current: "a" }) +
      block("question", {
        kind: "choice",
        title: "Zero determinant",
        prompt: "If det(A) = 0, what follows?",
        options: ["A is invertible", "A is singular"],
        answer: 1,
        explanation: "Dependent columns.",
      }),
    "Not quite: a zero determinant means the columns are dependent.\n",
    "You are right to ask; the app's grade stands.\n" + block("grade", { question: "q1", grade: "incorrect", feedback: "Still incorrect." }),
    JSON.stringify({
      ideas: [
        { key: "i1", name: `Determinant ${t}`, statement: "det(A) scales volume." },
        { key: "i2", name: idea, statement: "A matrix with det(A)=0 has no inverse." },
      ],
      links: [{ premises: ["i1"], conclusion: "i2" }],
    }),
  ]);
  await openSession(page, `AT${t} 101`);
  await seedEndpoint(page, { name: `Teacher LLM ${t}`, style: "openai", models: { teacher: `Teacher ${t}` } });
  await page.reload();

  // the session panel's AI Teacher section → New lesson opens a three-column tab
  const panel = sessionPanel(page);
  await panel.getByRole("radio", { name: "AI Teacher" }).click();
  await panel.getByRole("button", { name: "New teacher chat" }).click();
  await page.getByRole("menuitem", { name: "New lesson" }).click();
  const main = mainCard(page);
  const teacher = main.getByRole("region", { name: "Teacher" });
  const current = main.getByRole("region", { name: "Current question" });
  const questions = main.getByRole("listbox", { name: "Questions" });
  await expect(teacher).toBeVisible();

  // other specs share this backend and its "last used" model: choose the scripted one
  await pickModel(page, teacher, `Teacher ${t}`);
  const box = teacher.getByRole("textbox", { name: "Message" });
  await box.fill("I want to understand why det(A)=0 means A is not invertible");
  await box.press("Enter");

  // the question arrives as a chip in the conversation and a card on the right (FR-019)
  await expect(teacher.getByRole("button", { name: /Question 1 · Zero determinant/ })).toBeVisible();
  await expect(teacher).not.toContainText("non-trivial");
  await expect(questions.getByRole("option", { name: /Q1 Zero determinant/ })).toContainText("Unanswered");
  await axeClean(page);

  // answer it wrongly with low confidence and thinking → graded at once (FR-020–FR-022)
  await current.getByRole("radio", { name: /A is invertible/ }).click();
  await current.getByRole("slider", { name: "How sure are you?" }).focus();
  await page.keyboard.press("Home"); // 0 %
  await current.getByLabel("Your thinking (optional)").fill("I guessed");
  await current.getByRole("button", { name: "Submit answer" }).click();
  await expect(questions.getByRole("option", { name: /Q1/ })).toContainText("Incorrect");
  await expect(teacher).toContainText("columns are dependent");

  // dispute it → the teacher re-grades and both grades are kept (FR-024a)
  await questions.getByRole("option", { name: /Q1/ }).click();
  await current.getByRole("button", { name: "Dispute grade" }).click();
  await current.getByLabel(/Why do you think/).fill("Invertible was meant");
  await current.getByRole("button", { name: "Send to the teacher" }).click();
  await expect(current.getByRole("list", { name: "Grades" }).getByRole("listitem")).toHaveCount(2);

  // the plan (FR-026)
  await main.getByRole("button", { name: "Plan" }).click();
  await expect(page.getByRole("dialog", { name: "Lesson plan" })).toBeVisible();
  await page.keyboard.press("Escape");

  // closing the lesson's tab adds what it taught to the knowledge graph (FR-029)
  const tab = main.getByRole("tab", { name: /I want to understand/ });
  await tab.focus();
  await page.keyboard.press("Delete");
  await expect(tab).toHaveCount(0);

  // the home page's right panel: Knowledge graph → the idea → back to the lesson (FR-032, FR-033)
  await page.goto("/");
  await page.getByRole("radio", { name: "Knowledge graph" }).click();
  await page.getByRole("radio", { name: "List" }).click();
  const list = page.getByRole("list", { name: "Ideas" });
  await expect(async () => {
    await page.reload();
    await page.getByRole("radio", { name: "List" }).click();
    await expect(list.getByRole("button", { name: new RegExp(idea) })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await list.getByRole("button", { name: new RegExp(idea) }).click();
  const detail = page.getByRole("region", { name: "Idea" });
  await expect(detail.getByText("Follows from")).toBeVisible();
  await axeClean(page);
  await detail.getByRole("button", { name: /I want to understand/ }).click();
  await expect(mainCard(page).getByRole("region", { name: "Teacher" })).toBeVisible();
  await expect(mainCard(page).getByRole("region", { name: "Teacher" })).toContainText("columns are dependent");
});
