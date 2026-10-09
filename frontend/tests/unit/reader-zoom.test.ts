import { describe, expect, it } from "vitest";
import { resolvePage, stepZoom, zoomLabel } from "@/features/documents/reader/zoom";

describe("reader zoom", () => {
  it("steps through the fixed zoom levels within 50–400 %", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.03, 1)).toBe(1.1); // fit width gives scales between steps
    expect(stepZoom(1.03, -1)).toBe(1);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(zoomLabel(1.25)).toBe("125 %");
  });

  it("page field jumps to the nearest page and explains why", () => {
    expect(resolvePage("12", 42)).toEqual({ page: 12 });
    expect(resolvePage("999", 42)).toEqual({ page: 42, message: "There are 42 pages — showing page 42." });
    expect(resolvePage("0", 42)?.page).toBe(1);
    expect(resolvePage("abc", 42)).toBeNull();
  });
});
