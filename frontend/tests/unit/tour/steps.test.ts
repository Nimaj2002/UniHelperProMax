import { describe, expect, it } from "vitest";
import { afterSkipping, stepIndex, STEPS } from "@/features/tour/steps";

const idAt = (i: number) => STEPS[i]?.id;

describe("tour script (023)", () => {
  it("skipping New class skips the form steps that need it", () => {
    expect(idAt(afterSkipping(stepIndex("first_course.new-class")))).toBe("first_note.open-session");
  });

  it("skipping Record skips Stop and Transcribe", () => {
    expect(idAt(afterSkipping(stepIndex("pdf_recording.record")))).toBe("ai.chat");
  });

  it("skipping opening the AI teacher skips the lesson walkthrough", () => {
    expect(STEPS[afterSkipping(stepIndex("ai.teacher"))].chapter).toBe("settings");
  });

  it("skipping a step with no dependents goes to the next one", () => {
    expect(idAt(afterSkipping(stepIndex("pdf_recording.upload")))).toBe("pdf_recording.right-panel");
  });

  it("every dependency names an earlier step, every id is unique", () => {
    const ids = STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    STEPS.forEach((s, i) => {
      if (s.dependsOn) expect(stepIndex(s.dependsOn)).toBeLessThan(i);
      if (s.dialog) expect(stepIndex(s.dialog.restartAt)).toBeGreaterThanOrEqual(0);
    });
  });

  it("covers every home right-panel tab", () => {
    for (const tab of ["tasks", "notes", "time", "graph"]) expect(STEPS.some((s) => s.target === `home-switch-${tab}`)).toBe(true);
  });
});
