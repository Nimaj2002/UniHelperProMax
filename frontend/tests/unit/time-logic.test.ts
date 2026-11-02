// 020 T009, T057, T065: time computed from stored times, local days (with DST), report maths.
import { describe, expect, it } from "vitest";
import type { Entry } from "@/features/time/api";
import { elapsedMs, formatClock, formatCountdown, remainingMs, serverOffset } from "@/features/time/clock";
import { clippedSeconds, dayBounds, fromLocalInput, splitByDay, toLocalInput } from "@/features/time/days";
import { buildReport, chartSlices } from "@/features/time/reports/report";

const T = (iso: string) => Date.parse(iso);

describe("clock", () => {
  const timer = { startedAt: "2026-11-02T09:00:00.000Z", pausedMs: 60_000, plannedEndAt: "2026-11-02T09:26:00.000Z", pausedAt: null };

  it("computes elapsed and remaining from stored times and the server offset", () => {
    const now = T("2026-11-02T09:10:00Z");
    expect(elapsedMs(timer, now)).toBe(9 * 60_000); // 10 min less 1 min paused
    expect(remainingMs(timer, now)).toBe(16 * 60_000);
    // the device clock is 2 minutes slow: the offset corrects it
    expect(elapsedMs(timer, now - 120_000, 120_000)).toBe(9 * 60_000);
  });

  it("freezes while paused", () => {
    const paused = { ...timer, pausedAt: "2026-11-02T09:05:00.000Z" };
    expect(elapsedMs(paused, T("2026-11-02T11:00:00Z"))).toBe(4 * 60_000);
    expect(remainingMs(paused, T("2026-11-02T11:00:00Z"))).toBe(21 * 60_000);
  });

  it("takes the request's midpoint for the offset", () => {
    expect(serverOffset("2026-11-02T09:00:10.000Z", T("2026-11-02T09:00:00Z"), T("2026-11-02T09:00:02Z"))).toBe(9_000);
  });

  it("formats past a day and as a countdown", () => {
    expect(formatClock((26 * 3600 + 14 * 60 + 3) * 1000)).toBe("26:14:03");
    expect(formatCountdown(24 * 60_000 + 59_001)).toBe("25:00");
    expect(formatCountdown(90 * 60_000)).toBe("1:30:00");
  });
});

describe("local days", () => {
  it("splits an entry at local midnight", () => {
    const parts = splitByDay(T("2026-11-02T20:00:00Z"), T("2026-11-02T22:00:00Z"), "Europe/Istanbul"); // 23:00–01:00
    expect(parts.map((p) => [p.day, (p.end - p.start) / 3_600_000])).toEqual([
      ["2026-11-02", 1],
      ["2026-11-03", 1],
    ]);
  });

  it("knows a daylight-saving day is 23 hours long", () => {
    const { start, end } = dayBounds("2026-03-29", "Europe/Berlin");
    expect((end - start) / 3_600_000).toBe(23);
  });

  it("round-trips datetime-local values in the user's zone", () => {
    const ms = T("2026-11-02T06:30:00Z");
    expect(toLocalInput(ms, "Europe/Istanbul")).toBe("2026-11-02T09:30");
    expect(fromLocalInput("2026-11-02T09:30", "Europe/Istanbul")).toBe(ms);
  });

  it("clips an entry to a period, less its paused time in proportion", () => {
    const e = { startedAt: "2026-11-02T09:00:00Z", endedAt: "2026-11-02T11:00:00Z", pausedSeconds: 1200 };
    expect(clippedSeconds(e, T("2026-11-02T10:00:00Z"), T("2026-11-03T00:00:00Z"))).toBe(3000);
  });
});

const entry = (id: string, start: string, end: string, extra: Partial<Entry> = {}): Entry => ({
  id, startedAt: start, endedAt: end, pausedSeconds: 0, durationSeconds: (T(end) - T(start)) / 1000, description: id,
  tagId: null, source: "manual", courseId: null, taskId: null, sessionKey: null, linkTitle: null, version: 1, ...extra,
});

describe("reports", () => {
  const names = {
    tag: (id: string) => ({ hw: { name: "Homework", color: "tag-1" }, rd: { name: "Reading", color: "tag-2" } })[id],
    course: (id: string) => (id === "c1" ? "Linear algebra" : undefined),
    day: (iso: string) => iso,
  };
  const from = T("2026-11-02T00:00:00Z");
  const to = T("2026-11-04T00:00:00Z");
  const list = [
    entry("a", "2026-11-02T09:00:00Z", "2026-11-02T11:00:00Z", { tagId: "hw", courseId: "c1" }),
    entry("b", "2026-11-02T23:00:00Z", "2026-11-03T01:00:00Z", { tagId: "rd" }),
    entry("c", "2026-11-03T08:00:00Z", "2026-11-03T08:02:00Z"),
    entry("d", "2026-11-01T23:00:00Z", "2026-11-02T00:30:00Z", { tagId: "hw" }), // half outside
  ];

  it("totals equal the sum of the rows, to the second, clipped to the period", () => {
    const r = buildReport(list, from, to, "tag", "UTC", names);
    expect(r.total).toBe(2 * 3600 + 2 * 3600 + 120 + 1800);
    expect(r.rows.map((x) => [x.name, x.seconds, x.count])).toEqual([
      ["Homework", 9000, 2],
      ["Reading", 7200, 1],
      ["No tag", 120, 1],
    ]);
    expect(r.rows.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  it("groups by course with 'No course', and by day splitting at midnight", () => {
    expect(buildReport(list, from, to, "course", "UTC", names).rows.map((x) => x.name)).toEqual(["No course", "Linear algebra"]);
    const days = buildReport(list, from, to, "day", "UTC", names).rows;
    expect(days.map((x) => [x.key, x.seconds])).toEqual([
      ["2026-11-02", 7200 + 3600 + 1800],
      ["2026-11-03", 3600 + 120],
    ]);
  });

  it("merges slices under 3% into Other for the chart only", () => {
    const many = [
      entry("big", "2026-11-02T00:00:00Z", "2026-11-02T10:00:00Z", { tagId: "hw" }),
      entry("s1", "2026-11-02T10:00:00Z", "2026-11-02T10:05:00Z", { tagId: "rd" }),
      entry("s2", "2026-11-02T10:05:00Z", "2026-11-02T10:10:00Z"),
    ];
    const r = buildReport(many, from, to, "tag", "UTC", names);
    expect(r.rows).toHaveLength(3);
    expect(chartSlices(r.rows).map((x) => x.name)).toEqual(["Homework", "Other"]);
  });
});
