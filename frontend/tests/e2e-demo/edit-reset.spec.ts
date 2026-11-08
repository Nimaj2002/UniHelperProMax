import { expect, guardOrigins, lectureSession, openDemo, test } from "./fixtures";

/** 024 US2: visitors can edit; reload, Reset and a new tab bring the sample data back. */
guardOrigins();

const editor = (page: import("@playwright/test").Page) => page.getByRole("textbox", { name: "editable markdown" });

test("a new note is kept while browsing and gone after reload", async ({ page }) => {
  const lecture = await (async () => {
    await openDemo(page);
    return lectureSession(page);
  })();
  await openDemo(page, lecture.url);
  const notes = page.getByRole("region", { name: "Notes" });
  await notes.getByRole("button", { name: "New note" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New note" });
  await dialog.getByLabel("Note name").fill("Demo scratch");
  await dialog.getByLabel("Note name").press("Enter");
  await expect(page.getByRole("tab", { name: /^Demo scratch/ })).toBeVisible();
  await editor(page).click();
  await page.keyboard.type("DEMO-EDIT-123");
  await expect(page.getByRole("tab", { name: /^Demo scratch/ })).toContainText("Saved", { timeout: 10_000 });

  // in-app navigation only: a full page load is a fresh demo by design
  await page.getByRole("navigation", { name: "Courses" }).getByRole("link", { name: "Linear Algebra" }).click();
  await expect(page).toHaveURL(/course-linalg/);
  await page.goBack();
  await notes.getByText("Demo scratch", { exact: true }).click();
  await expect(editor(page)).toContainText("DEMO-EDIT-123");

  await page.reload();
  await expect(page.getByRole("region", { name: "Demo notice" })).toBeVisible();
  await expect(notes.getByText("Lecture notes", { exact: true })).toBeVisible();
  await expect(notes.getByText("Demo scratch", { exact: true })).toHaveCount(0);
});

test("Reset demo asks first, then restores the sample data; a new tab starts fresh", async ({ page, context }) => {
  await openDemo(page);
  const created = await page.evaluate(async () => {
    const r = await fetch("/api/v1/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ semesterId: "sem-1", name: "Demo Extra" }) });
    return r.status;
  });
  expect(created).toBe(201);
  await page.reload();
  await expect(page.getByRole("region", { name: "Demo notice" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Courses" });
  // reload already resets: the course made through the API is gone
  await expect(nav.getByRole("link", { name: "Algorithms" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Demo Extra" })).toHaveCount(0);

  await page.getByRole("button", { name: "Reset demo" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Reset the demo?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Reset demo" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reset" }).click();
  await expect(nav.getByRole("link", { name: "Algorithms" })).toBeVisible();

  const other = await context.newPage();
  await openDemo(other);
  await expect(other.getByRole("navigation", { name: "Courses" }).getByRole("link", { name: "Demo Extra" })).toHaveCount(0);
});
