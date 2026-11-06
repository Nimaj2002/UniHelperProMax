/**
 * Seeds a fictional demo semester and writes the website/README screenshots to
 * website/assets/screenshots and docs/screenshots. Not part of the e2e suite.
 * Run: corepack pnpm exec playwright test -c playwright.screenshots.config.ts
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { csrf, seedEndpoint } from "../e2e/chat-helpers";
import { signIn } from "../e2e/helpers";
import { mainCard, sessionPanel } from "../e2e/layout-helpers";

const OUT = fileURLToPath(new URL("../../../website/assets/screenshots/", import.meta.url));
const DOCS = fileURLToPath(new URL("../../../docs/screenshots/", import.meta.url));
const LLM = `http://localhost:${process.env.E2E_LLM_PORT ?? 8021}`;
const TRANSCRIBER = `http://localhost:${process.env.E2E_TRANSCRIBER_PORT ?? 8020}`;
// the demo week is the current one, so client and server dates agree (week 4 of the semester)
const MON = new Date();
MON.setHours(12, 0, 0, 0);
MON.setDate(MON.getDate() - ((MON.getDay() + 6) % 7));
const d = (n: number) => {
  const x = new Date(MON);
  x.setDate(x.getDate() + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const DAY = d(0);
const MODEL = "Qwen 2.5 14B";

/** The fields the seeding reads back from API responses. */
type Row = { id: string; version: number; position: number; courseId: string; lineageId: string };

async function api<T = Row>(page: Page, method: string, path: string, data?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await page.request.fetch(`/api/v1${path}`, { method, data, headers: { "X-CSRF-Token": await csrf(page), ...headers } });
  expect(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return (r.status() === 204 ? undefined : await r.json()) as T;
}

async function upload(page: Page, path: string, buffer: Buffer, type: string) {
  const r = await page.request.post(`/api/v1${path}`, { data: buffer, headers: { "X-CSRF-Token": await csrf(page), "Content-Type": type } });
  expect(r.ok(), `${path}: ${r.status()} ${await r.text()}`).toBe(true);
  return r.json();
}

async function script(page: Page, replies: string[]) {
  expect((await page.request.post(`${LLM}/test/script`, { data: { reset: true, replies } })).ok()).toBe(true);
}

/** Split view with the slides on the right and the chat open in the session panel. */
async function splitReady(page: Page) {
  // the dev server sometimes stalls on the loading screen: reload until the workspace shows
  await expect(async () => {
    if (!(await page.getByText("Binary Search Trees").first().isVisible())) await page.reload();
    await expect(page.getByText("Binary Search Trees").first()).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 90_000 });
  await expect(page.getByText(/Initializing plugins/)).toHaveCount(0, { timeout: 30_000 });
  await sessionPanel(page).getByText("Make me 3 exam questions").first().click();
  await expect(sessionPanel(page).getByText("successor").first()).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(1500);
}

async function shot(page: Page, name: string, docs = true) {
  await page.waitForTimeout(800); // let animations and Mermaid settle
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}${name}.png` });
  if (docs && existsSync(`${DOCS}${name}.png`)) copyFileSync(`${OUT}${name}.png`, `${DOCS}${name}.png`); // only the README's images
}

const setTheme = (page: Page, theme: string) => api(page, "PATCH", "/preferences", { theme });
const block = (kind: string, payload: unknown) => `\`\`\`uh-${kind}\n${JSON.stringify(payload)}\n\`\`\`\n`;

// ---------- demo content ----------

const COURSES = [
  { name: "CS 201 · Data Structures", color: "indigo", days: ["MO", "WE"], start: "10:00", end: "11:30", room: "FENS G032" },
  { name: "MATH 203 · Linear Algebra", color: "teal", days: ["TU", "TH"], start: "08:40", end: "10:30", room: "FASS 1080" },
  { name: "ECON 201 · Microeconomics", color: "pink", days: ["TU", "TH"], start: "12:40", end: "14:30", room: "FMAN 1099" },
  { name: "PHYS 113 · Physics II", color: "orange", days: ["MO", "WE"], start: "13:40", end: "15:30", room: "FENS G077" },
  { name: "HIST 191 · Modern History", color: "amber", days: ["FR"], start: "10:40", end: "12:30", room: "FASS G022" },
] as const;

const NOTE = String.raw`# Lecture 9 — Binary Search Trees

> **TL;DR** A BST keeps keys ordered so search, insert and delete are all **O(h)**. Keep $h$ small and everything is fast.

## Key ideas

- Every node's left subtree holds **smaller** keys, the right subtree **larger** ones
- In-order traversal visits keys in **sorted order**
- Height decides everything: balanced → $h = \lfloor \log_2 n \rfloor$, degenerate → $h = n - 1$

## Search

` + "```python" + `
def search(node, key):
    while node and node.key != key:
        node = node.left if key < node.key else node.right
    return node
` + "```" + String.raw`

## Complexity

| Operation | Average | Worst |
| --- | --- | --- |
| Search | O(log n) | O(n) |
| Insert | O(log n) | O(n) |
| Delete | O(log n) | O(n) |

## Deleting a node

` + "```mermaid" + `
graph TD
  A[Delete x] --> B{Children?}
  B -->|0| C[Remove the leaf]
  B -->|1| D[Splice in the child]
  B -->|2| E[Swap with in-order successor]
  E --> D
` + "```" + String.raw`

## To do before Wednesday

- [x] Re-read chapter 12.1–12.3
- [ ] Problem set 4, questions 2–5
- [ ] Prove $\sum_{d=0}^{h} 2^d = 2^{h+1} - 1$
`;

const CHAT_REPLY = `Here are three exam-style questions on **BST deletion**, from easy to hard:

1. **Leaf vs. one child.** Draw the BST after inserting \`50, 30, 70, 20, 40, 85\`, then delete \`20\` and \`70\`. Which pointer changes in each case?
2. **Two children.** Delete \`30\` using its *in-order successor*. Why is the successor guaranteed to have **at most one child**?
3. **Complexity.** Show that deletion runs in **O(h)**. What is $h$ for a balanced tree, and which insertion order makes it degrade to **O(n)**?

\`\`\`python
def successor(node):
    node = node.right
    while node.left:
        node = node.left
    return node
\`\`\`

> Tip: question 2 is the one that usually costs points — practise it on paper.
`;

const SLIDES = `<!doctype html><html><head><style>
  @page { size: 10in 5.625in; margin: 0 }
  * { box-sizing: border-box; margin: 0 }
  body { font-family: Helvetica, Arial, sans-serif; color: #1e1b4b }
  section { width: 10in; height: 5.625in; padding: .6in .7in; position: relative; page-break-after: always; overflow: hidden }
  .title { background: linear-gradient(135deg, #4338ca, #7c3aed); color: white }
  .title p.k { letter-spacing: .2em; font-size: 11pt; opacity: .8 }
  .title h1 { font-size: 44pt; margin-top: 1in }
  .title p.s { font-size: 16pt; margin-top: .15in; opacity: .9 }
  h2 { color: #4338ca; font-size: 26pt; margin-bottom: .35in }
  li { font-size: 15pt; margin: .08in 0 }
  footer { position: absolute; bottom: .3in; left: .7in; right: .7in; font-size: 8pt; color: #888; display: flex; justify-content: space-between }
  .title footer { color: #ddd }
  pre { background: #f1f5f9; padding: .2in; border-radius: 8px; font-size: 13pt }
  .row { display: flex; gap: .4in; align-items: center }
</style></head><body>
<section class="title"><p class="k">LECTURE 9</p><h1>Binary Search Trees</h1><p class="s">Search, insert and delete in O(h)</p><footer><span>CS 201 · Data Structures</span><span>1</span></footer></section>
<section><h2>The BST property</h2><div class="row"><ul><li>Left subtree: keys <b>smaller</b> than the node</li><li>Right subtree: keys <b>larger</b></li><li>In-order traversal → <b>sorted</b> output</li></ul>
<svg width="260" height="190" viewBox="0 0 260 190"><g stroke="#4338ca" stroke-width="2"><line x1="130" y1="25" x2="70" y2="85"/><line x1="130" y1="25" x2="200" y2="85"/><line x1="70" y1="85" x2="35" y2="150"/><line x1="70" y1="85" x2="105" y2="150"/><line x1="200" y1="85" x2="230" y2="150"/></g>
<g fill="#4f46e5"><circle cx="130" cy="25" r="18"/><circle cx="70" cy="85" r="18"/><circle cx="200" cy="85" r="18"/><circle cx="35" cy="150" r="18"/><circle cx="105" cy="150" r="18"/><circle cx="230" cy="150" r="18"/></g>
<g fill="white" font-size="13" font-weight="bold" text-anchor="middle"><text x="130" y="30">50</text><text x="70" y="90">30</text><text x="200" y="90">70</text><text x="35" y="155">20</text><text x="105" y="155">40</text><text x="230" y="155">85</text></g></svg></div>
<footer><span>CS 201 · Data Structures</span><span>2</span></footer></section>
<section><h2>Search in O(h)</h2><pre>def search(node, key):
    while node and node.key != key:
        node = node.left if key &lt; node.key else node.right
    return node</pre><ul><li>Each step goes one level down</li><li>At most h + 1 comparisons</li></ul><footer><span>CS 201 · Data Structures</span><span>3</span></footer></section>
<section><h2>Deletion: three cases</h2><ul><li><b>Leaf</b>: remove it</li><li><b>One child</b>: splice the child in</li><li><b>Two children</b>: swap with the in-order successor, then delete that</li></ul><footer><span>CS 201 · Data Structures</span><span>4</span></footer></section>
</body></html>`;

/** 90 s of mono 8 kHz audio with a speech-like envelope, so the player shows a waveform. */
function wav(seconds = 90, rate = 8000): Buffer {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write("data", 36); b.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.max(0, Math.sin(t * 2.3) * Math.sin(t * 0.7 + 1)) * 0.8;
    b[44 + i] = 128 + Math.round(100 * env * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.random()));
  }
  return b;
}

// ---------- the run ----------

test("website screenshots", async ({ page, browser }) => {
  await signIn(page);

  // courses, recurring classes, events
  const cls: Record<string, { courseId: string; lineageId: string }> = {};
  let semesterId = "";
  for (const c of COURSES) {
    const semester = semesterId
      ? { id: semesterId }
      : { new: { name: "Fall 2026", startDate: d(-21), endDate: d(70), year: { new: { name: "2026–2027" } } } };
    const r = await api(page, "POST", "/classes", {
      course: { new: { name: c.name, semester } },
      title: "Lecture", startDate: d(-21), startTime: c.start, endTime: c.end, location: c.room, color: c.color,
      recurrence: { freq: "weekly", byWeekday: c.days, end: { kind: "semester_end" } },
    });
    cls[c.name] = r;
    semesterId ||= (await api<Row[]>(page, "GET", `/semesters?yearId=${(await api<Row[]>(page, "GET", "/years"))[0].id}`))[0].id;
  }
  for (const e of [
    { title: "Office hours · Prof. Aydın", startDate: d(1), startTime: "15:30", endTime: "16:30", location: "FENS 2045", color: "blue" },
    { title: "Career Fair", startDate: d(2), startTime: "16:00", endTime: "18:00", location: "University Center", color: "violet" },
    { title: "Linear Algebra Midterm", startDate: d(3), startTime: "17:40", endTime: "19:30", location: "FASS G062", color: "red" },
  ]) await api(page, "POST", "/events", { ...e, semester: { id: semesterId }, recurrence: { freq: "none" } });

  // tasks on the default board
  const cols = (await api<Row[]>(page, "GET", "/task-columns")).sort((a, b) => a.position - b.position);
  const cid = (n: string) => cls[n].courseId;
  const tasks: [string, number, string | null, string | null, [string, boolean][]][] = [
    ["Homework 4 — BST problems 2–5", 0, cid("CS 201 · Data Structures"), d(4), [["Q2", true], ["Q3", false], ["Q4", false], ["Q5", false]]],
    ["Lab report 3 — RC circuits", 0, cid("PHYS 113 · Physics II"), d(7), []],
    ["Essay outline: the Industrial Revolution", 0, cid("HIST 191 · Modern History"), d(11), []],
    ["Read chapter 7 — Elasticity", 0, cid("ECON 201 · Microeconomics"), d(3), []],
    ["Study for Linear Algebra midterm", 1, cid("MATH 203 · Linear Algebra"), d(3), [["Eigenvalues", true], ["Determinants", true], ["Subspaces", false], ["Past paper 2025", false], ["Past paper 2024", false]]],
    ["Problem set 5 — eigenvalues", 1, cid("MATH 203 · Linear Algebra"), d(2), [["Part A", true], ["Part B", false]]],
    ["Team project proposal", 1, cid("CS 201 · Data Structures"), d(9), []],
    ["Problem set 4", 2, cid("MATH 203 · Linear Algebra"), d(-5), []],
    ["Quiz 2 review", 2, cid("ECON 201 · Microeconomics"), d(-4), []],
    ["Register for the Career Fair", 2, null, d(-2), []],
  ];
  for (const [title, col, courseId, dueDate, checklist] of tasks) {
    const t = await api(page, "POST", "/tasks", { title, columnId: cols[col].id, courseId, dueDate });
    if (checklist.length)
      await api(page, "PUT", `/tasks/${t.id}/checklist`, { items: checklist.map(([text, done]) => ({ text, done })) }, { "If-Match": `"${t.version}"` });
  }

  // AI endpoint (the fake LLM's scripted model) and transcription
  const ep = await seedEndpoint(page, { name: "Local LLM", style: "openai", models: { teacher: { name: MODEL, pdf: true, images: true, contextLimit: 32768 } } });
  const model = { endpointId: ep.id, modelId: ep.models[0].id };
  await page.evaluate(() => localStorage.setItem("uh.panel.collapsed", "true"));

  // the CS 201 session of this Monday: note, slides, recording, chat
  const cs = cls["CS 201 · Data Structures"];
  const key = `${cs.lineageId}:${DAY}`;
  const url = `/courses/${cs.courseId}/sessions/${encodeURIComponent(key)}`;
  const note = await api(page, "POST", `/sessions/${encodeURIComponent(key)}/notes`, { name: "Lecture 9 — BSTs", content: NOTE });
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(SLIDES);
  const slides = await pdfPage.pdf({ preferCSSPageSize: true, printBackground: true });
  await pdfPage.close();
  const doc = await upload(page, `/sessions/${encodeURIComponent(key)}/documents/import?fileName=${encodeURIComponent("Lecture 9 — Binary Search Trees.pdf")}`, slides, "application/pdf");
  await upload(page, `/sessions/${encodeURIComponent(key)}/recordings/import?fileName=${encodeURIComponent("Lecture 9 — BSTs.wav")}&durationMs=90000`, wav(), "audio/wav");
  await script(page, [CHAT_REPLY]);
  const chat = await api<{ chat: { id: string } }>(page, "POST", `/sessions/${encodeURIComponent(key)}/chats`, {
    text: "Make me 3 exam questions about BST deletion", model,
  });
  await expect.poll(async () => JSON.stringify(await api(page, "GET", `/chats/${chat.chat.id}`)), { timeout: 20_000 }).toContain("successor");
  const chatId = chat.chat.id;

  const workspace = (data: unknown) => api(page, "PUT", `/workspace/${encodeURIComponent(key)}`, data);
  const panel = (section: string, open = true, width = 400) =>
    page.evaluate(([s, o, w]) => localStorage.setItem("uh.sessionPanel", JSON.stringify({ open: o, width: w, section: s })), [section, open, width] as const);
  const noteTab = { kind: "note", id: note.id };
  const docTab = { kind: "document", id: doc.id };
  const chatTab = { kind: "chat", id: chatId };

  // ---- Yuii: the hero, notes + slides + chat ----
  await setTheme(page, "preset:yuii");
  await workspace({ openNoteIds: [note.id], tabs: [noteTab, docTab], active: noteTab, split: { enabled: true, left: noteTab, right: docTab, focused: "left", ratio: 0.5 } });
  await panel("chat", true, 360);
  await page.setViewportSize({ width: 1600, height: 1000 }); // split view needs a 1100 px main card
  await page.goto(url);
  await splitReady(page);
  await shot(page, "workspace-split");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- notes ----
  await setTheme(page, "system");
  await workspace({ openNoteIds: [note.id], tabs: [noteTab], active: noteTab, split: null });
  await panel("recordings", false);
  await page.goto(url);
  await expect(page.locator(".cm-content, [aria-label='editable markdown']").first()).toBeVisible();
  await shot(page, "notes");

  // ---- AI chat as a tab beside the slides ----
  await workspace({ openNoteIds: [note.id], tabs: [noteTab, docTab, chatTab], active: chatTab, split: { enabled: true, left: docTab, right: chatTab, focused: "right", ratio: 0.5 } });
  await page.goto(url);
  await expect(page.getByText("successor").first()).toBeVisible();
  await shot(page, "ai-chat");

  // ---- transcribe dialog ----
  await setTheme(page, "system");
  await page.goto("/settings/transcription");
  await page.getByRole("radio", { name: /Voice Studio/ }).click();
  await page.getByRole("textbox", { name: "Server address" }).fill(TRANSCRIBER);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Transcription settings saved.").last()).toBeVisible();
  await workspace({ openNoteIds: [note.id], tabs: [noteTab, docTab], active: docTab, split: null });
  await panel("recordings");
  await page.goto(url);
  await sessionPanel(page).getByRole("button", { name: /^Transcribe/ }).first().click();
  await expect(page.getByRole("dialog", { name: /^Transcribe/ })).toBeVisible();
  await shot(page, "transcribe");
  await page.keyboard.press("Escape");

  // ---- AI Teacher: a lesson with a graded question and the next one ----
  await script(page, [
    "Before we start, let's see where you are. A search walks down the tree from the root, one level per step.\n\n" +
      block("plan", { mermaid: "graph TD\n  a[BST property] --> b[One comparison per level]\n  b --> c[Height h]\n  c --> d[Search is O h]\n  c --> e[Balanced: h = log n]", current: "b" }) +
      block("question", {
        kind: "choice", title: "Where does the search go?", prompt: "You search for **40** in a BST whose root is **50**. Which subtree do you visit next?",
        options: ["The right subtree", "The left subtree", "Both subtrees"], answer: 1,
        explanation: "40 < 50, so every key that could match is in the left subtree.",
      }),
    "Exactly: one comparison sends you one level down, and you never come back up. So the number of steps is bounded by the **height** $h$, not by $n$.\n\nNow the key step: what makes $h$ large?\n\n" +
      block("plan", { mermaid: "graph TD\n  a[BST property] --> b[One comparison per level]\n  b --> c[Height h]\n  c --> d[Search is O h]\n  c --> e[Balanced: h = log n]", current: "c" }) +
      block("question", {
        kind: "text", title: "The worst insertion order", prompt: "You insert the keys `1, 2, 3, …, n` in this order. What does the tree look like, and what is its height?",
        solution: "Every key goes to the right of the previous one: the tree is a linked list with height $n-1$, so search is $O(n)$.",
      }),
  ]);
  await workspace({ openNoteIds: [note.id], tabs: [noteTab], active: noteTab, split: null });
  await panel("teacher", true, 300);
  await page.goto(url);
  const sp = sessionPanel(page);
  await sp.getByRole("button", { name: "New teacher chat" }).click();
  await page.getByRole("menuitem", { name: "New lesson" }).click();
  const main = mainCard(page);
  const teacher = main.getByRole("region", { name: "Teacher" });
  const current = main.getByRole("region", { name: "Current question" });
  const box = teacher.getByRole("textbox", { name: "Message" });
  await box.fill("Why is searching a BST O(h) and not O(log n)?");
  await box.press("Enter");
  await current.getByRole("radio", { name: /The left subtree/ }).click();
  await current.getByRole("button", { name: "Submit answer" }).click();
  await expect(current).toContainText("worst insertion order", { timeout: 20_000 });
  await shot(page, "teacher");

  // ---- knowledge graph (closing the lesson feeds it) ----
  await script(page, [JSON.stringify({
    ideas: [
      { key: "i1", name: "BST property", statement: "Left subtree keys are smaller, right subtree keys larger." },
      { key: "i2", name: "Search follows one path", statement: "Each comparison moves one level down." },
      { key: "i3", name: "Search is O(h)", statement: "At most h + 1 comparisons." },
      { key: "i4", name: "Sorted insertion degenerates", statement: "Inserting 1..n gives height n − 1." },
      { key: "i5", name: "Balanced trees", statement: "Keeping h = O(log n) makes every operation logarithmic." },
    ],
    links: [
      { premises: ["i1"], conclusion: "i2" }, { premises: ["i2"], conclusion: "i3" },
      { premises: ["i1"], conclusion: "i4" }, { premises: ["i3", "i4"], conclusion: "i5" },
    ],
  })]);
  const tab = main.getByRole("tab", { name: /Why is searching/ });
  await tab.focus();
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await api<unknown[]>(page, "GET", "/knowledge-graph/ideas")).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
  await page.goto("/");
  await page.getByRole("radio", { name: "Knowledge graph" }).click();
  await page.getByRole("button", { name: "Fit graph" }).click();
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "knowledge-graph");

  // ---- home: calendar + tasks ----
  await page.getByRole("radio", { name: "Tasks", exact: true }).click();
  await page.goto("/");
  await expect(page.locator("#calendar-panel")).toBeVisible();
  await shot(page, "calendar-week");

  // ---- kanban: hide the calendar ----
  await page.keyboard.press("Shift+C");
  await page.mouse.move(1400, 880);
  await shot(page, "kanban");
  await page.keyboard.press("Shift+C");

  // ---- quick create: drag on an empty slot (Friday 16:00–18:00) ----
  const cal = page.locator("#calendar-panel");
  const fri = await cal.getByText("Fri", { exact: true }).first().boundingBox();
  const t16 = await cal.getByText("16:00", { exact: true }).first().boundingBox();
  const t18 = await cal.getByText("18:00", { exact: true }).first().boundingBox();
  const x = fri!.x + fri!.width / 2;
  await page.mouse.move(x, t16!.y + t16!.height / 2 + 4);
  await page.mouse.down();
  await page.mouse.move(x, t18!.y + t18!.height / 2, { steps: 8 });
  await page.mouse.up();
  await shot(page, "quick-create");
  await page.keyboard.press("Escape");

  // ---- appearance ----
  await page.goto("/settings/appearance");
  await shot(page, "appearance");

  // ---- themes strip: Yuii, Yuii Night and one more ----
  for (const [theme, name] of [["preset:yuii", "theme-yuii"], ["preset:yuii-night", "theme-yuii-night"], ["preset:tokyo-night", "theme-tokyo"]] as const) {
    await setTheme(page, theme);
    await workspace({ openNoteIds: [note.id], tabs: [noteTab, docTab], active: noteTab, split: { enabled: true, left: noteTab, right: docTab, focused: "left", ratio: 0.5 } });
    await panel("chat", true, 360);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(url);
    await splitReady(page);
    await shot(page, name, false);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // the themes strip: three shots side by side with their names
  const img = (n: string) => `data:image/png;base64,${readFileSync(`${OUT}${n}.png`).toString("base64")}`;
  const strip = await browser.newPage({ viewport: { width: 1600, height: 380 }, deviceScaleFactor: 2 });
  await strip.setContent(`<body style="margin:0;padding:16px;display:flex;gap:16px;background:#fff;font:600 22px Inter,system-ui,sans-serif;color:#7c3aed">
    ${[["theme-yuii", "Yuii"], ["theme-yuii-night", "Yuii Night"], ["theme-tokyo", "Tokyo Night"]]
      .map(([f, n]) => `<figure style="margin:0;flex:1;text-align:center"><img src="${img(f)}" style="width:100%;border-radius:10px;box-shadow:0 2px 10px #0003"><figcaption style="margin-top:10px">${n}</figcaption></figure>`).join("")}
  </body>`);
  await strip.screenshot({ path: `${OUT}themes.png`, fullPage: true });
  copyFileSync(`${OUT}themes.png`, `${DOCS}themes.png`);
  await strip.close();
  rmSync(`${OUT}theme-tokyo.png`);
  await setTheme(page, "system");
});
