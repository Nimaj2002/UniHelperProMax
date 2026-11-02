/**
 * 018 (quickstart.md): the home page's General notes — a scratchpad the Tasks panel switches to, whose
 * notes open in a pop-up, autosave, are named from their first line, and can be renamed and
 * deleted; keyboard only, in both colour schemes (one project each).
 */
import { expect, test, type Page } from "@playwright/test";
import { signIn, tag } from "./helpers";
import { VIEWPORT } from "./layout-helpers";

test.use({ viewport: VIEWPORT });

const section = (page: Page) => page.locator("#home-general-notes-body");
const newButton = (page: Page) =>
  page.getByRole("button", { name: "New general note" });
const notesSwitch = (page: Page) => page.locator("#home-switch-notes");
const tasksSwitch = (page: Page) => page.locator("#home-switch-tasks");
const popup = (page: Page) => page.getByRole("dialog");

test("write, rename and delete a general note with the keyboard", async ({
  page,
}, info) => {
  const t = tag(info.project.name);
  await signIn(page);
  await page.goto("/");
  await notesSwitch(page).click();
  await expect(section(page)).toContainText(
    "Lecture notes go in a class session",
  );

  // new note: the pop-up is a labelled box over the home page, the editor takes the typing
  await newButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(popup(page)).toBeVisible();
  await expect(popup(page)).toContainText("not linked to any class");
  await expect(
    popup(page).getByRole("button", { name: "Rename" }),
  ).toBeEnabled();
  await popup(page).locator("[contenteditable='true']").first().click();
  await page.keyboard.type(`Ask advisor ${t}`);
  await expect(page.getByTestId("general-note-save-state")).toContainText(
    "Saved",
    { timeout: 10_000 },
  );
  await page.keyboard.press("Escape");
  await expect(popup(page)).toBeHidden();

  // named from its first line; focus is back on the opener
  const item = section(page).getByRole("button", {
    name: new RegExp(`Ask advisor ${t}`),
  });
  await expect(item).toBeVisible();
  await expect(newButton(page)).toBeFocused();

  // rename through the pop-up's Rename dialog
  await item.focus();
  await page.keyboard.press("Enter");
  await popup(page).getByRole("button", { name: "Rename" }).click();
  const renameBox = page.getByRole("dialog", { name: "Rename general note" });
  await renameBox.getByLabel("Note name").fill(`Internship questions ${t}`);
  await page.keyboard.press("Enter");
  await expect(renameBox).toBeHidden();
  await expect(popup(page)).toContainText(`Internship questions ${t}`);

  // delete asks first
  await popup(page).getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("General Notes folder");
  await confirm.getByRole("button", { name: "Delete note" }).click();
  await expect(popup(page)).toBeHidden();
  await expect(
    section(page).getByRole("button", {
      name: new RegExp(`Internship questions ${t}`),
    }),
  ).toHaveCount(0);
});

test("a new note closed blank leaves nothing; the chosen section stays after a reload", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/");
  await notesSwitch(page).click();
  await newButton(page).click();
  await expect(popup(page)).toBeVisible();
  await popup(page).getByRole("button", { name: "Done" }).click();
  await expect(popup(page)).toBeHidden();
  // the blank note was discarded, so no note keeps its automatic name
  await expect(
    section(page).getByRole("button", { name: /^General note \d{4}-/ }),
  ).toHaveCount(0);

  await page.reload();
  await expect(section(page)).toBeVisible();
  await tasksSwitch(page).click(); // leave Tasks shown for other runs
  await expect(section(page)).toHaveCount(0);
});

test("the header switch shows Tasks or General notes, and the closed panel's rail opens either", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/");
  const tasksBody = page.locator("#home-tasks-body");

  // one section at a time
  await tasksSwitch(page).click();
  await expect(tasksBody).toBeVisible();
  await expect(section(page)).toHaveCount(0);
  await notesSwitch(page).click();
  await expect(section(page)).toBeVisible();
  await expect(tasksBody).toHaveCount(0);

  // the closed panel's rail has an item per section; each reopens the panel on it
  await page.locator("#close-tasks").click();
  const rail = page.locator("[data-rail=tasks]");
  await expect(rail.locator("[data-rail-item=tasks]")).toBeVisible();
  await rail.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(tasksBody).toBeVisible();
  await expect(tasksSwitch(page)).toBeFocused();

  await page.locator("#close-tasks").click();
  await rail.getByRole("button", { name: "General notes" }).click();
  await expect(section(page)).toBeVisible();
  await expect(notesSwitch(page)).toBeFocused();
  await tasksSwitch(page).click(); // leave Tasks shown for other runs
});
