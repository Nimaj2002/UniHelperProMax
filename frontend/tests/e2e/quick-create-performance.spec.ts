import { expect, test } from "@playwright/test";
import { newHierarchy, seedClass, signIn, tag } from "./helpers";

// 009 SC-003: the draft follows the pointer without visible lag in a week with 50 entries, and the
// week's entries load quickly (plan: GET /sessions for a week ≤ 300 ms).
test("SC-003: drag a draft in a week with 50 entries", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const t = tag(testInfo.project.name);
  await signIn(page);
  // light and dark share one backend: each project gets its own week, away from other specs
  const mon = t === "L" ? "2027-08-02" : "2027-08-09";
  const cls = await seedClass(page, {
    course: newHierarchy(`DRAGPERF${t} 1`, `Perf drag ${t}`, `Perf drag year ${t}`, "2027-12-31"), startDate: mon, startTime: "08:00",
    endTime: "09:00", color: "blue", recurrence: { freq: "none" },
  });
  const csrf = (await page.context().cookies()).find((c) => c.name === "uh_csrf")?.value ?? "";
  const semesterId = (await (await page.request.get(`/api/v1/courses/${cls.courseId}`)).json()).semesterId as string;
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${mon}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  for (let i = 0; i < 49; i++) {
    const h = 8 + (i % 7) + Math.floor(i / 7) % 2;
    const r = await page.request.post("/api/v1/events", {
      data: { title: `Perf ${t} ${i}`, semester: { id: semesterId }, startDate: days[Math.floor(i / 7)], startTime: `${String(h).padStart(2, "0")}:00`, endTime: `${String(h + 1).padStart(2, "0")}:30` },
      headers: { "X-CSRF-Token": csrf },
    });
    expect(r.status(), await r.text()).toBe(201);
  }

  // the week's entries
  const t0 = Date.now();
  const r = await page.request.get(`/api/v1/sessions?from=${days[0]}&to=${days[6]}`);
  const ms = Date.now() - t0;
  expect(r.ok()).toBe(true);
  expect((await r.json()).length).toBeGreaterThanOrEqual(50);
  expect(ms, `GET /sessions for a week took ${ms} ms`).toBeLessThan(300);

  await page.goto(`/calendar/week/${mon}`);
  await expect(page.locator("[data-session-key]")).toHaveCount(50);
  const scroller = page.locator("[data-calendar-grid] .overflow-y-auto");
  await scroller.evaluate((el) => (el.scrollTop = 5 * 48));
  const col = (await page.locator(`[data-day="${days[2]}"]`).boundingBox())!;
  const x = col.x + col.width / 2;
  const yOf = (min: number) => col.y + (min / 60) * 48 + 6;

  // long tasks (≥ 50 ms, the browser's threshold) and the longest gap between frames while dragging
  await page.evaluate(() => {
    const w = window as unknown as { __long: number; __frames: number[]; __stop: boolean };
    w.__long = 0;
    w.__frames = [];
    w.__stop = false;
    new PerformanceObserver((list) => {
      if (!w.__stop) w.__long += list.getEntries().length;
    }).observe({ type: "longtask" });
    const tick = (now: number) => {
      w.__frames.push(now);
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // an empty spot: Wednesday 07:15 (entries start at 08:00)
  await page.mouse.move(x, yOf(7 * 60 + 15));
  await page.mouse.down();
  const draft = page.locator("[data-draft]");
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(x, yOf(7 * 60 + 15 + i * 7));
    if (i % 10 === 0) {
      const end = 7 * 60 + 15 + i * 7 + 7.5; // yOf aims 6 px (7.5 min) into the slot
      const snapped = Math.min(Math.floor(end / 15) * 15 + 15, 24 * 60);
      const label = `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
      await expect(draft).toContainText(`07:15 – ${label}`, { timeout: 500 });
    }
  }
  const { long, maxGap } = await page.evaluate(() => {
    const w = window as unknown as { __long: number; __frames: number[]; __stop: boolean };
    w.__stop = true;
    const gaps = w.__frames.slice(1).map((f, i) => f - w.__frames[i]);
    return { long: w.__long, maxGap: Math.max(...gaps) };
  });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "New entry" })).toBeVisible();
  expect(long, "long tasks while dragging").toBe(0);
  expect(maxGap, `longest frame gap ${maxGap.toFixed(1)} ms`).toBeLessThan(100);
  await page.keyboard.press("Escape");
});
