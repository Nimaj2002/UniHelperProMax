import { describe, expect, it } from "vitest";
import { BUBBLE_H, PAD, pickPose, place, type Rect } from "@/features/tour/placement";

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const padded = (t: Rect): Rect => ({ left: t.left - PAD, top: t.top - PAD, width: t.width + 2 * PAD, height: t.height + 2 * PAD });

describe("place", () => {
  it("never covers the target and faces it (SC-002)", () => {
    for (const w of [1024, 1280, 1920]) {
      const vp = { w, h: 800 };
      for (let i = 0; i < 20; i++) {
        // targets of control/section size spread across the window
        const t = { left: ((i * 97) % (w - 260)) + 4, top: ((i * 53) % 700) + 4, width: 40 + ((i * 31) % 220), height: 32 + ((i * 17) % 60) };
        const p = place(t, vp);
        const yuii = { left: p.x, top: p.y, width: p.width, height: p.height };
        const bubble = { left: p.bubble.x, top: p.bubble.y, width: p.bubble.width, height: BUBBLE_H };
        expect(overlaps(yuii, padded(t)), `yuii ${w} #${i}`).toBe(false);
        expect(overlaps(bubble, padded(t)), `bubble ${w} #${i}`).toBe(false);
        if (p.mode !== "bubble") {
          // base poses point left: standing right of the target is unmirrored
          expect(p.mirrored).toBe(p.x < t.left);
          expect(p.side === "right").toBe(p.x >= t.left + t.width);
        }
      }
    }
  });

  it("is large when there is room, smaller when tight, bubble only when tighter", () => {
    const vp = { w: 1280, h: 900 };
    expect(place({ left: 20, top: 400, width: 40, height: 40 }, vp).mode).toBe("full");
    // ~364 px free on the right: a smaller Yuii still fits
    expect(place({ left: 20, top: 400, width: 860, height: 40 }, vp).mode).toBe("small");
    // ~234 px free: too narrow for Yuii, the bubble goes below the target
    const tight = place({ left: 20, top: 400, width: 990, height: 40 }, vp);
    expect(tight.mode).toBe("bubble");
    expect(tight.bubble.y).toBeGreaterThan(440);
  });

  it("centres Yuii with no target", () => {
    const p = place(null, { w: 1200, h: 800 });
    expect(p.mode).toBe("center");
    expect(p.x + p.width / 2).toBeCloseTo(600);
  });

  it("puts the bubble under a full-width panel", () => {
    const p = place({ left: 0, top: 50, width: 1280, height: 300 }, { w: 1280, h: 800 });
    expect(p.mode).toBe("bubble");
    expect(p.bubble.y).toBeGreaterThan(350);
  });
});

describe("pickPose", () => {
  it("points up, level or down by angle", () => {
    expect(pickPose(100, 200)).toBe("point-up-left-high");
    expect(pickPose(200, 60)).toBe("point-up-left");
    expect(pickPose(100, 0)).toBe("point-left");
    expect(pickPose(400, 0)).toBe("point-left-arm-extended");
    expect(pickPose(100, -80)).toBe("point-left-low");
  });
});
