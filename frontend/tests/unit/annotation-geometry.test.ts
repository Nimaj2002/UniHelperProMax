import { describe, expect, it } from "vitest";
import {
  invert, pageToViewport, rectToViewport, selectionToRects, viewportToPage, viewportTransform, type Matrix,
} from "@/features/documents/reader/annotations/geometry";

const LETTER = [0, 0, 612, 792] as const;
const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));

describe("page space ↔ viewport", () => {
  it.each([0.5, 1, 4])("round-trips points at zoom %s in every rotation", (scale) => {
    for (const rotation of [0, 90, 180, 270]) {
      const m = viewportTransform({ viewBox: LETTER, scale, rotation });
      const inv = invert(m);
      for (const p of [[0, 0], [612, 792], [72.5, 540.25], [300, 10]] as [number, number][]) {
        close(viewportToPage(inv, pageToViewport(m, p)), p);
      }
    }
  });

  it("matches pdf.js: origin bottom-left becomes top-left of the canvas, y flipped", () => {
    const m = viewportTransform({ viewBox: LETTER, scale: 1, rotation: 0 });
    close(pageToViewport(m, [0, 792]), [0, 0]); // top-left of the page
    close(pageToViewport(m, [0, 0]), [0, 792]);
    const twice = viewportTransform({ viewBox: LETTER, scale: 2, rotation: 0 });
    close(pageToViewport(twice, [100, 692]), [200, 200]);
  });

  it("rotation 90 turns the page clockwise", () => {
    const m = viewportTransform({ viewBox: LETTER, scale: 1, rotation: 90 });
    close(pageToViewport(m, [0, 792]), [792, 0]); // the page's top-left goes to the top-right
    close(pageToViewport(m, [0, 0]), [0, 0]);
    const r180 = viewportTransform({ viewBox: LETTER, scale: 1, rotation: 180 });
    close(pageToViewport(r180, [0, 0]), [612, 0]);
    const r270 = viewportTransform({ viewBox: LETTER, scale: 1, rotation: 270 });
    close(pageToViewport(r270, [0, 0]), [792, 612]);
  });

  it("a page-space rect becomes a normalised box at any zoom and rotation", () => {
    const m: Matrix = viewportTransform({ viewBox: LETTER, scale: 2, rotation: 0 });
    expect(rectToViewport(m, [72, 700, 172, 720])).toEqual({ left: 144, top: 144, width: 200, height: 40 });
    const r90 = viewportTransform({ viewBox: LETTER, scale: 1, rotation: 90 });
    const box = rectToViewport(r90, [72, 700, 172, 720]);
    expect(box.width).toBeCloseTo(20);
    expect(box.height).toBeCloseTo(100);
  });
});

describe("text selection → highlight rects", () => {
  const m = viewportTransform({ viewBox: LETTER, scale: 2, rotation: 0 });
  const inv = invert(m);
  const page = { left: 10, top: 20 }; // where the page sits on screen

  it("merges the selection's rects per line, in page space", () => {
    // two words on line 1 (with a gap of 4 px = 2 pt) and one word on line 2
    const rects = [
      { left: 10 + 144, top: 20 + 144, right: 10 + 244, bottom: 20 + 184 },
      { left: 10 + 248, top: 20 + 146, right: 10 + 300, bottom: 20 + 182 },
      { left: 10 + 144, top: 20 + 200, right: 10 + 200, bottom: 20 + 240 },
    ];
    expect(selectionToRects(rects, page, inv)).toEqual([
      [72, 700, 150, 720],
      [72, 672, 100, 692],
    ]);
  });

  it("drops empty rects (line ends in a selection)", () => {
    const rects = [{ left: 100, top: 100, right: 100, bottom: 120 }];
    expect(selectionToRects(rects, page, inv)).toEqual([]);
  });
});
