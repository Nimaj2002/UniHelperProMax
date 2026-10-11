import { describe, expect, it } from "vitest";
import {
  announcement, clickDraft, draftRange, edgeSpeed, isClick, MONTH_DRAFT, rangeLabel, snap15, timeValue, yToMinutes,
} from "@/features/calendar/draft";
import { canReplace, draftReducer, initialDraftState, type DraftState } from "@/features/calendar/useDraft";

const HOUR_PX = 48;

describe("draft time math (009 US5, research R11)", () => {
  it("converts a pointer offset plus the scroll offset to minutes", () => {
    expect(yToMinutes(0, 0, HOUR_PX)).toBe(0);
    expect(yToMinutes(24, 0, HOUR_PX)).toBe(30);
    expect(yToMinutes(10, 13 * HOUR_PX - 10, HOUR_PX)).toBe(13 * 60);
    expect(yToMinutes(-50, 0, HOUR_PX)).toBe(0); // clamped to the day
    expect(yToMinutes(5000, 0, HOUR_PX)).toBe(1440);
  });

  it("snaps to the start of the 15-minute slot", () => {
    expect(snap15(0)).toBe(0);
    expect(snap15(14.9)).toBe(0);
    expect(snap15(15)).toBe(15);
    expect(snap15(10 * 60 + 20)).toBe(10 * 60 + 15);
    expect(snap15(1440)).toBe(1425); // the last slot of the day
  });

  it("spans the pressed slot to the pointer's slot, downwards and upwards", () => {
    expect(draftRange(13 * 60, 14 * 60 + 40)).toEqual({ startMin: 13 * 60, endMin: 14 * 60 + 45 });
    // upward: starts at the pointer, ends with the pressed slot
    expect(draftRange(13 * 60 + 5, 11 * 60 + 50)).toEqual({ startMin: 11 * 60 + 45, endMin: 13 * 60 + 15 });
  });

  it("is never shorter than 15 minutes and stays inside the day", () => {
    expect(draftRange(600, 600)).toEqual({ startMin: 600, endMin: 615 });
    expect(draftRange(1430, 2000)).toEqual({ startMin: 1425, endMin: 1440 });
    expect(draftRange(30, -100)).toEqual({ startMin: 0, endMin: 45 });
  });

  it("tells a click from a drag at 4 px", () => {
    expect(isClick(0, 0)).toBe(true);
    expect(isClick(2, 3)).toBe(true);
    expect(isClick(0, 4)).toBe(false);
    expect(isClick(3, 3)).toBe(false);
  });

  it("makes a one-hour click draft from the clicked slot, capped at midnight", () => {
    expect(clickDraft(10 * 60 + 20)).toEqual({ startMin: 10 * 60 + 15, endMin: 11 * 60 + 15 });
    expect(clickDraft(23 * 60 + 40)).toEqual({ startMin: 23 * 60 + 30, endMin: 1440 });
  });

  it("uses 09:00–10:00 for month view", () => {
    expect(MONTH_DRAFT).toEqual({ startMin: 540, endMin: 600 });
  });

  it("labels and announces the range", () => {
    expect(rangeLabel({ startMin: 780, endMin: 885 })).toBe("13:00 – 14:45");
    expect(rangeLabel({ startMin: 1380, endMin: 1440 })).toBe("23:00 – 24:00");
    expect(announcement({ startMin: 600, endMin: 675 })).toBe("New entry, from 10:00 to 11:15");
    expect(timeValue(1440)).toBe("23:59"); // time inputs and the API have no 24:00
  });

  it("auto-scrolls within 32 px of the edges, faster closer to them", () => {
    expect(edgeSpeed(300, 100, 600)).toBe(0);
    expect(edgeSpeed(100, 100, 600)).toBe(-16);
    expect(edgeSpeed(131, 100, 600)).toBe(-4);
    expect(edgeSpeed(600, 100, 600)).toBe(16);
    expect(edgeSpeed(580, 100, 600)).toBeGreaterThan(4);
  });
});

describe("one draft at a time (FR-039, FR-040)", () => {
  const start = (s: DraftState, date = "2026-10-06") =>
    draftReducer(s, { type: "start", date, range: { startMin: 600, endMin: 660 }, origin: "click", phase: "open" });

  it("replaces a draft nothing was entered in", () => {
    const a = start(initialDraftState);
    const b = start(a, "2026-10-07");
    expect(b.draft).toMatchObject({ id: 2, date: "2026-10-07" });
  });

  it("keeps an open draft with something entered", () => {
    const a = draftReducer(start(initialDraftState), { type: "dirty", id: 1, dirty: true });
    expect(canReplace(a)).toBe(false);
    expect(start(a, "2026-10-07")).toBe(a);
  });

  it("ignores updates and discards for an older draft", () => {
    const b = start(start(initialDraftState));
    expect(draftReducer(b, { type: "discard", id: 1 })).toBe(b);
    expect(draftReducer(b, { type: "update", id: 1, range: { startMin: 0, endMin: 15 } })).toBe(b);
    expect(draftReducer(b, { type: "discard" }).draft).toBeNull();
  });

  it("drags, then opens with the release range", () => {
    let s = draftReducer(initialDraftState, { type: "start", date: "2026-10-06", range: { startMin: 780, endMin: 795 }, origin: "drag", phase: "drag" });
    s = draftReducer(s, { type: "update", id: 1, range: { startMin: 780, endMin: 885 } });
    s = draftReducer(s, { type: "open", id: 1 });
    expect(s.phase).toBe("open");
    expect(s.draft).toMatchObject({ startMin: 780, endMin: 885, date: "2026-10-06" });
  });
});
