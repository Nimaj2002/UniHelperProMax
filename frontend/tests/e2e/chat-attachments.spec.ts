/**
 * 014 US6/US8/US9: attachments in the chat's message box — notes (the open note, this session's,
 * another course's), pictures (paste), PDFs (as documents, as text, a scan), audio (a WebM
 * recording for Gemini; disabled for a model without audio), the 10-attachment cap, and the
 * context list with its estimate, Remove and the over-limit alert (contracts/ui-contract.md).
 * The fake LLM echoes the text of the last user message, so the answer shows what was sent.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { newHierarchy, seedClass, tag } from "./helpers";
import { LAYOUT_DATE, openSession, VIEWPORT } from "./layout-helpers";
import {
  answers,
  ask,
  axeClean,
  chatSection,
  messageBox,
  pickModel,
  seedEndpoint,
  chatFirst,
} from "./chat-helpers";
import {
  PNG,
  seedDocument,
  seedNote,
  seedRecording,
  webm,
} from "./chat-fixtures";
import { imageOnlyPdf, textPdf } from "./pdf-fixtures";

test.use({ viewport: VIEWPORT });
test.beforeEach(({ page }) => chatFirst(page));

const CHAT = "#workspace-session-panel";

const chips = (chat: Locator) =>
  chat.getByRole("list", { name: "Attachments" }).last();

async function openAttach(page: Page, chat: Locator) {
  await chat.getByRole("button", { name: "Attach" }).click();
  return page.getByRole("menu");
}

async function setup(page: Page, course: string) {
  const s = await openSession(page, course);
  return { ...s, sessionKey: `${s.lineageId}:${LAYOUT_DATE}` };
}

test("US6: attach the open note and another course's note, remove a chip, send both texts", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  const { url, sessionKey } = await setup(page, `CA${t} 201`);
  await seedEndpoint(page, {
    name: `Notes AI ${t}`,
    style: "openai",
    models: { echo: `Notes echo ${t}` },
  });
  const heaps = await seedNote(
    page,
    sessionKey,
    `Heaps ${t}`,
    "A heap keeps the smallest key on top. HEAPWORD",
  );
  await seedNote(page, sessionKey, `Extra ${t}`, "Not needed. EXTRAWORD");
  // a note of another course's session
  const other = await seedClass(page, {
    course: newHierarchy(
      `CB${t} 202`,
      `Sem CB${t} 202`,
      `Year CB${t} 202`,
      "2027-01-10",
    ),
    title: "Lecture",
    startDate: LAYOUT_DATE,
    startTime: "14:00",
    endTime: "15:00",
    location: "Room 3",
    color: "pink",
    recurrence: { freq: "none" },
  });
  await seedNote(
    page,
    `${other.lineageId}:${LAYOUT_DATE}`,
    `Graphs ${t}`,
    "A graph has vertices and edges. GRAPHWORD",
  );
  await page.goto(`${url}?note=${heaps.id}`);
  await expect(
    page.getByRole("tab", { name: new RegExp(`^Heaps ${t}`) }),
  ).toHaveAttribute("aria-selected", "true");

  const chat = chatSection(page);
  await pickModel(page, chat, `Notes echo ${t}`);

  // the quick "attach the open note"
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "Notes…" })
    .click();
  const picker = page.getByRole("dialog", { name: "Attach notes" });
  await expect(
    picker.getByRole("group", { name: "This session" }),
  ).toBeVisible();
  await axeClean(page, '[role="dialog"]');
  await picker
    .getByRole("option", { name: `Attach the open note: Heaps ${t}` })
    .click();
  await expect(picker).toBeHidden();
  await expect(messageBox(chat)).toBeFocused();
  await expect(
    chips(chat).getByRole("button", { name: `Remove Heaps ${t}` }),
  ).toBeVisible();

  // browse to another course's note (labelled with its session), plus one of this session
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "Notes…" })
    .click();
  await picker.getByRole("combobox", { name: "Search notes" }).fill(`${t}`);
  const browse = picker.getByRole("group", { name: "Browse" });
  await expect(
    browse.getByRole("option", { name: new RegExp(`Graphs ${t}.*CB${t} 202`) }),
  ).toBeVisible();
  await browse.getByRole("option", { name: new RegExp(`Graphs ${t}`) }).click();
  await picker
    .getByRole("group", { name: "This session" })
    .getByRole("option", { name: new RegExp(`Extra ${t}`) })
    .click();
  await expect(picker.getByRole("status")).toHaveText("2 selected");
  await picker.getByRole("button", { name: "Attach 2 notes" }).click();
  await expect(chips(chat).getByRole("button")).toHaveCount(3);

  // remove a chip
  await chips(chat)
    .getByRole("button", { name: `Remove Extra ${t}` })
    .click();
  await expect(chips(chat).getByRole("button")).toHaveCount(2);

  await ask(chat, "What do my notes say?");
  const answer = answers(chat).last();
  await expect(answer).toContainText("What do my notes say?");
  await expect(answer).toContainText("HEAPWORD");
  await expect(answer).toContainText("GRAPHWORD");
  await expect(answer).not.toContainText("EXTRAWORD");
  // the message shows its attachments
  await expect(
    chat.getByRole("article", { name: "You" }).last().getByText(`Graphs ${t}`),
  ).toBeVisible();
  // the chat only: the note editor's own toolbar is checked by the editor's specs
  await axeClean(page, CHAT);
});

test("US8: pictures, PDFs as documents or text, a scan, audio for Gemini, and the 10-attachment cap", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const t = tag(testInfo.project.name);
  const { sessionKey } = await setup(page, `CM${t} 203`);
  await seedEndpoint(page, {
    name: `Claude ${t}`,
    style: "anthropic",
    models: { echo: { name: `Claude docs ${t}`, images: true, pdf: true } },
  });
  await seedEndpoint(page, {
    name: `Plain ${t}`,
    style: "openai",
    models: { echo: { name: `Plain text ${t}`, images: true } },
  });
  await seedEndpoint(page, {
    name: `Gemini ${t}`,
    style: "gemini",
    models: {
      echo: { name: `Gemini audio ${t}`, images: true, pdf: true, audio: true },
    },
  });
  await seedDocument(page, sessionKey, `Syllabus ${t}.pdf`, textPdf(2));
  await seedDocument(page, sessionKey, `Scan ${t}.pdf`, imageOnlyPdf(2));
  const rec = await seedRecording(
    page,
    sessionKey,
    `lecture-${t}.webm`,
    webm(2),
  );
  await page.reload();
  const chat = chatSection(page);
  const box = messageBox(chat);

  // paste a picture → a chip with a thumbnail
  await pickModel(page, chat, `Claude docs ${t}`);
  await box.focus();
  await box.evaluate((el, b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "screenshot.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, PNG.toString("base64"));
  const shot = chips(chat).getByRole("button", {
    name: "Remove screenshot.png",
  });
  await expect(shot).toBeVisible();
  await expect
    .poll(() =>
      shot
        .getByTestId("attachment-thumbnail")
        .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth),
    )
    .toBe(2);

  // a session PDF goes to the Anthropic model as a document (not as text)
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "PDFs" })
    .click();
  await page.getByRole("menuitem", { name: `Syllabus ${t}` }).click();
  await expect(
    chips(chat).getByRole("button", { name: `Remove Syllabus ${t}` }),
  ).toBeVisible();
  await ask(chat, "Summarise the syllabus");
  await expect(answers(chat).last()).toContainText(
    "You said: Summarise the syllabus",
  );
  await expect(answers(chat).last()).not.toContainText("red-black");
  await expect(chat.getByRole("status")).toHaveText("Answer complete");

  // a model without PDF support: the text instead
  await chat.getByRole("button", { name: "New chat" }).click();
  await pickModel(page, chat, `Plain text ${t}`);
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "PDFs" })
    .click();
  await page.getByRole("menuitem", { name: `Syllabus ${t}` }).click();
  const choice = page.getByRole("alertdialog");
  await expect(choice).toContainText(
    `Plain text ${t} can't read PDF documents`,
  );
  await axeClean(page);
  await choice
    .getByRole("button", { name: "Send the PDF's text instead" })
    .click();
  await expect(
    chips(chat).getByRole("button", { name: `Remove Syllabus ${t}` }),
  ).toContainText("text");

  // a scan has no text to send instead
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "PDFs" })
    .click();
  await page.getByRole("menuitem", { name: `Scan ${t}` }).click();
  await expect(choice).toContainText(
    "This PDF has no text (for example a scan)",
  );
  await choice.getByRole("button", { name: "Remove" }).click();
  await expect(
    chips(chat).getByRole("button", { name: `Remove Scan ${t}` }),
  ).toBeHidden();

  // Audio is disabled with its reason for this (OpenAI-style, no audio) model
  const menu = await openAttach(page, chat);
  const audio = menu.getByRole("menuitem", { name: "Audio" });
  await expect(audio).toHaveAttribute("aria-disabled", "true");
  await expect(audio).toHaveAccessibleDescription(
    "This model doesn't accept audio — use Transcribe on the recording",
  );
  await page.keyboard.press("Escape");
  await expect(box).toBeFocused();

  await ask(chat, "Read the syllabus text");
  await expect(answers(chat).last()).toContainText("red-black tree");

  // a WebM recording for the Gemini model (remuxed to Ogg on the server)
  await chat.getByRole("button", { name: "New chat" }).click();
  await pickModel(page, chat, `Gemini audio ${t}`);
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "Audio" })
    .click();
  await page.getByRole("menuitem", { name: rec.name }).click();
  await expect(
    chips(chat).getByRole("button", { name: `Remove ${rec.name}` }),
  ).toBeVisible();
  await ask(chat, "What was said in the lecture?");
  await expect(answers(chat).last()).toContainText(
    "You said: What was said in the lecture?",
  );
  await expect(chat.getByRole("status")).toHaveText("Answer complete");

  // an 11th attachment is refused
  await chat.getByRole("button", { name: "New chat" }).click();
  const files = Array.from({ length: 11 }, (_, i) => ({
    name: `pic-${i + 1}.png`,
    mimeType: "image/png",
    buffer: PNG,
  }));
  await page.getByTestId("chat-attach-pictures").setInputFiles(files);
  await expect(
    chat
      .getByRole("alert")
      .filter({ hasText: "At most 10 attachments per message." }),
  ).toBeVisible();
  await expect(
    chips(chat).getByRole("button", { name: /^Remove pic-/ }),
  ).toHaveCount(10);
  await expect(
    chips(chat).getByRole("button", { name: "Remove pic-11.png" }),
  ).toHaveCount(0);
  await axeClean(page);
});

test("US9: the context list's estimates, Remove, and the over-limit alert carrying the draft", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const t = tag(testInfo.project.name);
  const { sessionKey } = await setup(page, `CX${t} 204`);
  await seedEndpoint(page, {
    name: `Context ${t}`,
    style: "openai",
    models: {
      echo: { name: `Roomy ${t}`, pdf: true, contextLimit: 100_000 },
      tiny: { name: `Tiny ${t}`, pdf: true, contextLimit: 100 },
    },
  });
  await seedNote(page, sessionKey, `Alpha ${t}`, "alpha ".repeat(200));
  await seedNote(page, sessionKey, `Beta ${t}`, "beta ".repeat(100));
  await seedDocument(page, sessionKey, `Reader ${t}.pdf`, textPdf(2));
  await page.reload();
  const chat = chatSection(page);
  await pickModel(page, chat, `Roomy ${t}`);
  await ask(chat, "Hello");
  await expect(answers(chat).last()).toContainText("You said: Hello");

  // two notes and a PDF in the draft
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "Notes…" })
    .click();
  const picker = page.getByRole("dialog", { name: "Attach notes" });
  const session = picker.getByRole("group", { name: "This session" });
  await session.getByRole("option", { name: new RegExp(`Alpha ${t}`) }).click();
  await session.getByRole("option", { name: new RegExp(`Beta ${t}`) }).click();
  await picker.getByRole("button", { name: "Attach 2 notes" }).click();
  await (
    await openAttach(page, chat)
  )
    .getByRole("menuitem", { name: "PDFs" })
    .click();
  await page.getByRole("menuitem", { name: `Reader ${t}` }).click();
  await messageBox(chat).fill("Keep this draft");

  const contextBtn = chat.getByRole("button", { name: /^Context \(/ });
  await expect(contextBtn).toHaveAccessibleName(
    /^Context \(3 items, ~[\d,]+ tokens of 100,000\)$/,
  );
  const before = Number(
    (await contextBtn.getAttribute("aria-label"))!
      .match(/~([\d,]+)/)![1]
      .replace(/,/g, ""),
  );
  await contextBtn.click();
  const list = page.getByRole("dialog", { name: "Context" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(
    list.getByRole("listitem").filter({ hasText: `Alpha ${t}` }),
  ).toContainText(/~[\d,]+ tokens/);
  await expect(list.getByTestId("context-limits")).toContainText(
    "Per message:",
  );
  await axeClean(page);
  await list.getByRole("button", { name: `Remove Beta ${t}` }).click();
  await expect(contextBtn).toHaveAccessibleName(/^Context \(2 items, /);
  const after = Number(
    (await contextBtn.getAttribute("aria-label"))!
      .match(/~([\d,]+)/)![1]
      .replace(/,/g, ""),
  );
  expect(after).toBeLessThan(before);
  await page.keyboard.press("Escape");

  // a model with a 100-token limit: told, and offered a new chat that keeps the draft
  await pickModel(page, chat, `Tiny ${t}`);
  const alert = chat
    .getByRole("alert")
    .filter({ hasText: "This conversation is larger than the model can take" });
  await expect(alert).toBeVisible();
  await expect(
    alert.getByRole("button", { name: "Remove items" }),
  ).toBeVisible();
  await axeClean(page);
  await alert.getByRole("button", { name: "Start a new chat" }).click();
  await expect(chat.getByRole("list", { name: "Chats" })).toBeVisible();
  await expect(messageBox(chat)).toHaveValue("Keep this draft");
  await expect(
    chips(chat).getByRole("button", { name: `Remove Alpha ${t}` }),
  ).toBeVisible();
  await expect(
    chips(chat).getByRole("button", { name: `Remove Reader ${t}` }),
  ).toBeVisible();
});
