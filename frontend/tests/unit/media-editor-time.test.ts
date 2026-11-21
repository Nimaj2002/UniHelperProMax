import { describe, expect, it } from "vitest";
import { formatTime, parseTime, rangeProblem } from "@/features/media-editor/tools/trim/time";

describe("media editor time fields (025)", () => {
  it("formats milliseconds", () => {
    expect(formatTime(0)).toBe("0:00.000");
    expect(formatTime(65_500)).toBe("1:05.500");
    expect(formatTime(3_723_250)).toBe("1:02:03.250");
  });
  it("parses what it formats and shorthand", () => {
    for (const ms of [0, 999, 65_500, 3_723_250]) expect(parseTime(formatTime(ms))).toBe(ms);
    expect(parseTime("3.5")).toBe(3500);
    expect(parseTime("2:03")).toBe(123_000);
  });
  it("rejects text that is not a time", () => {
    for (const bad of ["", "abc", "1:2:3:4", "-1", "1.2345", "1::2"]) expect(parseTime(bad)).toBeNull();
  });
  it("applies the server's range rules", () => {
    expect(rangeProblem(1000, 5000, 10_000)).toBeNull();
    expect(rangeProblem(5000, 5000, 10_000)).not.toBeNull();
    expect(rangeProblem(0, 10_001, 10_000)).not.toBeNull();
    expect(rangeProblem(1000, 1050, 10_000)).toMatch(/0\.1/);
    expect(rangeProblem(0, 10_000, 10_000)).toMatch(/Nothing to trim/);
  });
});
