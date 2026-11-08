import { describe, expect, it } from "vitest";
import { ApiError, type Schemas } from "@/lib/api";
import { api, raw, startDemoServer } from "./setup";

startDemoServer();

const range = { from: "2026-10-01T00:00:00Z", to: "2026-11-30T00:00:00Z" };

describe("demo tasks, time, themes, settings and exports", () => {
  it("serves the seeded board, tags and entries", async () => {
    const cols = await api<Schemas["TaskColumnOut"][]>("/task-columns");
    expect(cols.map((c) => c.name)).toEqual(["To do", "In progress", "Done"]);
    const tasks = await api<Schemas["TaskOut"][]>("/tasks");
    expect(tasks.length).toBeGreaterThanOrEqual(8);
    expect(tasks.some((t) => t.event?.title === "Career Fair")).toBe(true);
    const ps = tasks.find((t) => t.checklistTotal > 0)!;
    expect(ps.quickNoteCount).toBe(1);
    expect((await api<Schemas["TaskDetailOut"]>(`/tasks/${ps.id}`)).checklist).toHaveLength(3);
    expect(await api<Schemas["TagOut"][]>("/time/tags")).toHaveLength(3);
    const entries = await api<Schemas["EntryOut"][]>("/time/entries", { query: range });
    expect(entries.length).toBeGreaterThan(5);
    expect(entries.some((e) => e.sessionKey)).toBe(true);
    expect((await api<Schemas["TimerResponse"]>("/time/timer")).timer).toBeNull();
    expect(await api<Schemas["ProxySettingsOut"]>("/settings/proxy")).toEqual({ proxy: null, usedBy: [] });
    expect((await api<Schemas["SecretStoreStatus"]>("/secrets/status")).readable).toBe(true);
  });

  it("creates a task, moves it, rejects stale versions and empty titles", async () => {
    const [todo, doing, done] = await api<Schemas["TaskColumnOut"][]>("/task-columns");
    const t = await api<Schemas["TaskOut"]>("/tasks", { method: "POST", body: { title: "Buy a lab coat", columnId: todo.id } });
    const moved = await api<Schemas["TaskOut"]>(`/tasks/${t.id}/move`, { method: "POST", body: { columnId: done.id, index: 0 }, version: t.version });
    expect(moved).toMatchObject({ columnId: done.id, position: 0, previousColumnId: todo.id });
    expect(moved.completedAt).not.toBeNull();
    expect(doing.taskCount).toBe(2);

    const stale = await api(`/tasks/${t.id}`, { method: "PATCH", body: { description: "x" }, version: t.version }).catch((e: unknown) => e);
    expect(stale).toMatchObject({ status: 412, code: "version_conflict" });

    const empty = (await api("/tasks", { method: "POST", body: { title: "  " } }).catch((e: unknown) => e)) as ApiError;
    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty)).toContain("/title");
  });

  it("deletes and restores a task", async () => {
    const [first] = await api<Schemas["TaskOut"][]>("/tasks");
    await api(`/tasks/${first.id}`, { method: "DELETE", version: first.version });
    expect((await api<Schemas["TaskOut"][]>("/tasks")).some((t) => t.id === first.id)).toBe(false);
    const back = await api<Schemas["TaskOut"]>(`/tasks/${first.id}/restore`, { method: "POST" });
    expect(back.position).toBe(first.position);
  });

  it("start → pause → resume → stop saves an entry", async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString();
    let r = await api<Schemas["TimerResponse"]>("/time/timer/start", { method: "POST", body: { style: "focus", focusMinutes: 120, description: "Revise", at } });
    expect(r.timer).toMatchObject({ state: "running", focusMinutes: 120 });
    r = await api("/time/timer/pause", { method: "POST", version: r.timer!.version });
    expect(r.timer!.state).toBe("paused");
    r = await api("/time/timer/resume", { method: "POST", version: r.timer!.version });
    expect(r.timer!.state).toBe("running");
    r = await api("/time/timer/stop", { method: "POST", version: r.timer!.version });
    expect(r.timer).toBeNull();
    expect(r.saved).toMatchObject({ description: "Revise", source: "focus" });
    expect(r.saved!.durationSeconds).toBeGreaterThan(3500); // backdated an hour
    const entries = await api<Schemas["EntryOut"][]>("/time/entries", { query: { from: at, to: new Date(Date.now() + 60_000).toISOString() } });
    expect(entries.some((e) => e.id === r.saved!.id)).toBe(true);
  });

  it("generates each export locally", async () => {
    for (const [path, type] of [
      ["/tasks/export", "text/csv"],
      ["/calendar-export?semesterId=sem-1", "text/calendar"],
      [`/time/entries/export.csv?${new URLSearchParams({ ...range, tz: "Europe/Istanbul" })}`, "text/csv"],
    ]) {
      const res = await raw(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("Content-Type")).toContain(type);
      expect(res.headers.get("Content-Disposition")).toContain("attachment");
      expect((await res.text()).length).toBeGreaterThan(50);
    }
  });
});
