import { describe, expect, it } from "vitest";
import {
  GAP, layoutWidths, MAIN_MIN, RAIL_W, RIGHT_DEFAULT, RIGHT_MAX, RIGHT_MIN, RIGHT_RAIL_W, type WidthInput,
} from "@/app/shell/widths";

const base: WidthInput = {
  viewport: 1366,
  mode: "docked",
  focus: false,
  leftClosed: false,
  leftWidth: 280,
  rightPresent: true,
  rightClosed: false,
  rightWidth: 360,
  rightHasRail: true,
};
const main = (i: WidthInput) => {
  const w = layoutWidths(i);
  const cards = 1 + (w.leftEff ? 1 : 0) + (w.rightEff ? 1 : 0);
  return i.viewport - w.leftEff - w.rightEff - (cards + 1) * GAP;
};

describe("layoutWidths", () => {
  it("uses the stored widths when they fit", () => {
    expect(layoutWidths(base)).toMatchObject({ leftEff: 280, rightEff: 360, rightRail: false, rightFits: true, mainMin: MAIN_MIN });
  });

  it("clamps stored widths to the card limits", () => {
    expect(layoutWidths({ ...base, viewport: 1600, leftWidth: 100, rightWidth: 2000 })).toMatchObject({ leftEff: 240, rightEff: 640 });
    expect(layoutWidths({ ...base, leftWidth: Number.NaN }).leftEff).toBe(280);
  });

  it("has the session panel limits 300 / 360 / 640 (014 FR-008)", () => {
    expect([RIGHT_MIN, RIGHT_DEFAULT, RIGHT_MAX, RIGHT_RAIL_W]).toEqual([300, 360, 640, 44]);
  });

  it("never makes the session panel wider than half the window", () => {
    const w = layoutWidths({ ...base, viewport: 1200, leftClosed: true, rightWidth: 640 });
    expect(w.rightEff).toBe(600);
    expect(w.rightLimit).toBeLessThanOrEqual(600);
    expect(layoutWidths({ ...base, viewport: 2560, rightWidth: 640 }).rightLimit).toBe(640);
  });

  it("shows the rails when the cards are closed and nothing when the right card is absent", () => {
    expect(layoutWidths({ ...base, leftClosed: true }).leftEff).toBe(RAIL_W);
    expect(layoutWidths({ ...base, rightClosed: true })).toMatchObject({ rightEff: RIGHT_RAIL_W, rightRail: true });
    expect(layoutWidths({ ...base, rightClosed: true, rightHasRail: false })).toMatchObject({ rightEff: 0, rightRail: false });
    expect(layoutWidths({ ...base, rightPresent: false })).toMatchObject({ rightEff: 0, rightRail: false });
  });

  it("hides both side cards and the rail in focus mode; overlay mode keeps the right rail", () => {
    expect(layoutWidths({ ...base, focus: true })).toMatchObject({ leftEff: 0, rightEff: 0, rightRail: false });
    expect(layoutWidths({ ...base, mode: "overlay", viewport: 1000 })).toMatchObject({ leftEff: 0, rightEff: RIGHT_RAIL_W, rightRail: true, rightFits: false });
  });

  it("closes the session panel to its rail when 300 px don't fit next to a 480 px main card", () => {
    const narrow = { ...base, viewport: 1000 };
    const w = layoutWidths(narrow);
    expect(w).toMatchObject({ rightEff: RIGHT_RAIL_W, rightRail: true, rightFits: false });
    expect(main(narrow)).toBeGreaterThanOrEqual(MAIN_MIN);
    // with the side panel closed to its rail there is room again
    expect(layoutWidths({ ...narrow, leftClosed: true })).toMatchObject({ rightEff: 360, rightFits: true });
  });

  it("keeps the main card at least 480 px, shrinking the session panel first, then the side panel", () => {
    const tight = { ...base, viewport: 1100, leftWidth: 480, rightWidth: 640 };
    const w = layoutWidths(tight);
    expect(main(tight)).toBeGreaterThanOrEqual(MAIN_MIN);
    expect(w.rightEff).toBe(RIGHT_MIN);
    expect(w.leftEff).toBe(1100 - 4 * GAP - MAIN_MIN - RIGHT_MIN);
    const fits = { ...base, viewport: 1300, leftWidth: 300, rightWidth: 640 };
    expect(layoutWidths(fits).leftEff).toBe(300);
    expect(main(fits)).toBeGreaterThanOrEqual(MAIN_MIN);
  });

  it("limits resizing so the main card keeps 480 px", () => {
    const w = layoutWidths({ ...base, viewport: 1100 });
    expect(1100 - 4 * GAP - w.leftLimit - w.rightEff).toBeGreaterThanOrEqual(MAIN_MIN);
    expect(1100 - 4 * GAP - w.leftEff - w.rightLimit).toBeGreaterThanOrEqual(MAIN_MIN);
    expect(layoutWidths({ ...base, viewport: 2560 }).leftLimit).toBe(480);
  });

  it("never changes its input", () => {
    const input = { ...base, viewport: 1100, leftWidth: 480, rightWidth: 640 };
    const copy = { ...input };
    layoutWidths(input);
    expect(input).toEqual(copy);
  });
});
