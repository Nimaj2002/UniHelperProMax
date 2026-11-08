import { describe, expect, it, vi } from "vitest";
import { tourEvents } from "@/features/tour/events";

describe("tourEvents", () => {
  it("delivers payloads until unsubscribed", () => {
    const fn = vi.fn();
    const off = tourEvents.on("class.created", fn);
    tourEvents.emit("class.created", { courseId: "c1" });
    off();
    tourEvents.emit("class.created", { courseId: "c2" });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ courseId: "c1" });
  });

  it("is a no-op without listeners", () => {
    expect(() => tourEvents.emit("note.saved")).not.toThrow();
  });

  it("keeps going when a listener throws", () => {
    const good = vi.fn();
    const offBad = tourEvents.on("chat.sent", () => {
      throw new Error("boom");
    });
    const offGood = tourEvents.on("chat.sent", good);
    expect(() => tourEvents.emit("chat.sent")).not.toThrow();
    expect(good).toHaveBeenCalled();
    offBad();
    offGood();
  });
});
