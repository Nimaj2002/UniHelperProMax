import { expect, test, type Page } from "@playwright/test";

/**
 * 024: every demo test fails if the page talks to any origin but the demo's own (SC-003).
 * Call `guardOrigins()` once at the top of each spec file.
 */
export function guardOrigins() {
  const seen: string[] = [];
  test.beforeEach(async ({ context, baseURL }) => {
    seen.length = 0;
    const origin = new URL(baseURL!).origin;
    // context routes only see requests that reach the network: ones the demo's service worker
    // answers inside the browser never get here. Anything foreign is recorded and blocked.
    await context.route(
      (url) => url.origin !== origin,
      (route) => {
        seen.push(route.request().url());
        return route.abort();
      },
    );
  });
  test.afterEach(() => expect(seen, "requests to other origins").toEqual([]));
}

export { expect, test };

export async function openDemo(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("region", { name: "Demo notice" })).toBeVisible({ timeout: 20_000 });
}

export async function noServerError(page: Page) {
  await expect(page.getByText(/Can't reach the server/i)).toHaveCount(0);
}

/** Session keys of the sample workspace, read from the demo's own API. */
export async function sessions(page: Page) {
  return page.evaluate(async () => {
    const r = await fetch("/api/v1/sessions?from=2000-01-01&to=2100-01-01");
    return (await r.json()) as { key: string; lineageId: string; courseId: string | null; status: string; date: string }[];
  });
}

/** The most recent past Algorithms class (it holds the sample PDF, recording and chats). */
export async function lectureSession(page: Page) {
  const list = await sessions(page);
  const s = list.filter((x) => x.lineageId === "lin-algo" && x.status === "past").at(-1)!;
  return { ...s, url: `/courses/${s.courseId}/sessions/${encodeURIComponent(s.key)}` };
}
