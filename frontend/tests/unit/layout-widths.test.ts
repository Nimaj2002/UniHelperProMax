import { describe, expect, it } from "vitest";
import { GAP, layoutWidths, MAIN_MIN, RAIL_W, type WidthInput } from "@/app/shell/widths";

const base: WidthInput = {
  viewport: 1366,
  mode: "docked",
  focus: false,
  leftClosed: false,
  leftWidth: 280,
  rightPresent: true,
  rightClosed: false,
  rightWidth: 300,
};
const main = (i: WidthInput) => {
  const w = layoutWidths(i);
  const cards = 1 + (w.leftEff ? 1 : 0) + (w.rightEff ? 1 : 0);
  return i.viewport - w.leftEff - w.rightEff - (cards + 1) * GAP;
};

describe("layoutWidths", () => {
  it("uses the stored widths when they fit", () => {
    expect(layoutWidths(base)).toMatchObject({ leftEff: 280, rightEff: 300, mainMin: MAIN_MIN });
  });

  it("clamps stored widths to the card limits", () => {
    expect(layoutWidths({ ...base, viewport: 1600, leftWidth: 100, rightWidth: 2000 })).toMatchObject({ leftEff: 240, rightEff: 640 });
    expect(layoutWidths({ ...base, leftWidth: Number.NaN }).leftEff).toBe(280);
  });

  it("shows the rail when the left card is closed and nothing when the right card is closed or absent", () => {
    expect(layoutWidths({ ...base, leftClosed: true }).leftEff).toBe(RAIL_W);
    expect(layoutWidths({ ...base, rightClosed: true }).rightEff).toBe(0);
    expect(layoutWidths({ ...base, rightPresent: false }).rightEff).toBe(0);
  });

  it("hides both side cards in focus mode and in overlay mode", () => {
    expect(layoutWidths({ ...base, focus: true })).toMatchObject({ leftEff: 0, rightEff: 0 });
    expect(layoutWidths({ ...base, mode: "overlay", viewport: 1000 })).toMatchObject({ leftEff: 0, rightEff: 0 });
  });

  it("keeps the main card at least 480 px, shrinking the audio card first, then the side panel", () => {
    const tight = { ...base, viewport: 1100, leftWidth: 480, rightWidth: 640 };
    const w = layoutWidths(tight);
    expect(main(tight)).toBeGreaterThanOrEqual(MAIN_MIN);
    expect(w.rightEff).toBe(260);
    expect(w.leftEff).toBe(1100 - 4 * GAP - MAIN_MIN - 260);
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
