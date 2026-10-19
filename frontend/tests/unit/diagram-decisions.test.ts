import { afterEach, describe, expect, it, vi } from "vitest";
import {
  diagramHash,
  getDecision,
  MAX_NOTES,
  MAX_PER_NOTE,
  resetDecision,
  setDecision,
} from "@/features/sessions/editor/diagram-math/decisions";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("diagram decisions (FR-032a)", () => {
  it("keeps an answer per diagram source in this browser, never in the note", () => {
    const h = diagramHash("flowchart LR\n A-->B", "mermaid");
    setDecision("note-1", h, { unsafe: "allow" });
    setDecision("note-1", h, { theme: "own" });
    expect(getDecision("note-1", h)).toMatchObject({ unsafe: "allow", theme: "own" });
    expect(JSON.parse(window.localStorage.getItem("uh.diagramDecisions.note-1")!)[h].unsafe).toBe("allow");
    expect(getDecision("note-2", h)).toBeUndefined();
  });

  it("stops applying once the source changes", () => {
    setDecision("n", diagramHash("graph TD\n a-->b"), { unsafe: "allow" });
    expect(getDecision("n", diagramHash("graph TD\n a-->c"))).toBeUndefined();
  });

  it("can be reset", () => {
    const h = diagramHash("x");
    setDecision("n", h, { unsafe: "allow" });
    resetDecision("n", h);
    expect(getDecision("n", h)).toBeUndefined();
  });

  it("keeps at most 100 per note and 200 notes, dropping the oldest", () => {
    vi.useFakeTimers();
    for (let i = 0; i <= MAX_PER_NOTE; i++) {
      vi.setSystemTime(new Date(2026, 9, 19, 10, 0, i));
      setDecision("busy", diagramHash(`d${i}`), { theme: "app" });
    }
    expect(getDecision("busy", diagramHash("d0"))).toBeUndefined();
    expect(getDecision("busy", diagramHash(`d${MAX_PER_NOTE}`))).toBeDefined();
    for (let n = 0; n <= MAX_NOTES; n++) {
      vi.setSystemTime(new Date(2026, 9, 20, 0, 0, n));
      setDecision(`note-${n}`, "h", { theme: "app" });
    }
    expect(window.localStorage.getItem("uh.diagramDecisions.note-0")).toBeNull();
    expect(window.localStorage.getItem(`uh.diagramDecisions.note-${MAX_NOTES}`)).not.toBeNull();
    vi.useRealTimers();
  });

  it("works when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setDecision("blocked-note", "h", { unsafe: "safe" })).not.toThrow();
    expect(getDecision("blocked-note", "h")).toMatchObject({ unsafe: "safe" });
  });
});
