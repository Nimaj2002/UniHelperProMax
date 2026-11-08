import { describe, expect, it } from "vitest";
import type { Schemas } from "@/lib/api";
import { createSeed } from "@/demo/seed";
import { api, FIXED_NOW, TZ, startDemoServer } from "./setup";

startDemoServer();

const sessions = (from: string, to: string) => api<Schemas["SessionOut"][]>("/sessions", { query: { from, to } });

describe("demo seed dates (FR-004, FR-005)", () => {
  it.each([FIXED_NOW, new Date("2027-03-15T12:00:00Z")])("surrounds the open date (%s)", (now) => {
    const seed = createSeed(now, TZ);
    const sem = seed.semesters[0];
    const today = now.toISOString().slice(0, 10);
    expect(sem.startDate! <= today && today <= sem.endDate!).toBe(true);
    expect(seed.courses.length).toBeGreaterThanOrEqual(3);
    expect(seed.series.some((s) => s.kind === "event")).toBe(true);
  });

  it("has classes before and after today", async () => {
    const all = await sessions("2000-01-01", "2100-01-01");
    expect(all.some((s) => s.status === "past")).toBe(true);
    expect(all.some((s) => s.status === "upcoming")).toBe(true);
    expect(all[0].start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/);
  });
});

describe("demo calendar writes", () => {
  it("creates a class with a new course and lists its weekly sessions", async () => {
    const created = await api<Schemas["ClassCreated"]>("/classes", {
      method: "POST",
      body: {
        course: { new: { name: "Physics", semester: { id: "sem-1" } } },
        color: "green",
        startDate: "2026-11-02",
        startTime: "08:40",
        endTime: "10:30",
        recurrence: { freq: "weekly", intervalWeeks: 1, byWeekday: ["MO", "TH"], end: { kind: "count", count: 4 } },
      },
    });
    expect(created.created.courseId).toBeTruthy();
    const list = (await sessions("2026-11-01", "2026-12-31")).filter((s) => s.lineageId === created.lineageId);
    expect(list.map((s) => s.date)).toEqual(["2026-11-02", "2026-11-05", "2026-11-09", "2026-11-12"]);
    expect(list[0].courseName).toBe("Physics");
  });

  it("rejects an empty course name and an end time before the start", async () => {
    await expect(api("/courses", { method: "POST", body: { semesterId: "sem-1", name: "  " } })).rejects.toMatchObject({ status: 422 });
    const err = await api("/events", {
      method: "POST",
      body: { title: "X", semester: { id: "sem-1" }, startDate: "2026-11-10", startTime: "10:00", endTime: "09:00" },
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422 });
    expect((err as { errors: { field: string }[] }).errors[0].field).toBe("/endTime");
  });

  it("answers a stale If-Match with 412 version_conflict", async () => {
    await expect(api("/courses/course-algo", { method: "PATCH", body: { name: "Algo" }, version: 99 })).rejects.toMatchObject({
      status: 412,
      code: "version_conflict",
    });
    const ok = await api<Schemas["Course"]>("/courses/course-algo", { method: "PATCH", body: { name: "Algo" }, version: 1 });
    expect(ok.version).toBe(2);
  });

  it("moves a deleted series to the trash and restores it", async () => {
    const key = (await sessions("2000-01-01", "2100-01-01")).find((s) => s.lineageId === "lin-writing")!.key;
    const res = await api<Schemas["ScopeResult"]>(`/sessions/${encodeURIComponent(key)}`, { method: "DELETE", query: { scope: "all" } });
    expect(res.trashEntryId).toBeTruthy();
    expect((await sessions("2000-01-01", "2100-01-01")).some((s) => s.lineageId === "lin-writing")).toBe(false);
    const trash = await api<Schemas["TrashEntryOut"][]>("/trash");
    expect(trash).toHaveLength(1);
    await api(`/trash/${trash[0].id}/restore`, { method: "POST" });
    expect((await sessions("2000-01-01", "2100-01-01")).some((s) => s.lineageId === "lin-writing")).toBe(true);
  });

  it("deletes one occurrence only with scope this", async () => {
    const before = (await sessions("2000-01-01", "2100-01-01")).filter((s) => s.lineageId === "lin-algo");
    await api(`/sessions/${encodeURIComponent(before[0].key)}`, { method: "DELETE", query: { scope: "this" } });
    const after = (await sessions("2000-01-01", "2100-01-01")).filter((s) => s.lineageId === "lin-algo");
    expect(after).toHaveLength(before.length - 1);
  });
});
