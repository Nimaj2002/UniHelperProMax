import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { TourOverlay, type TourOverlayProps } from "@/features/tour/TourOverlay";
import { STEPS } from "@/features/tour/steps";

function props(over: Partial<TourOverlayProps> = {}): TourOverlayProps {
  return {
    step: STEPS[0],
    index: 0,
    total: STEPS.length,
    phase: "run",
    context: {},
    firstRun: true,
    resumeChapter: "welcome",
    passive: false,
    avoid: null,
    target: null,
    searching: false,
    missing: false,
    onNext: vi.fn(),
    onBack: undefined,
    onSkip: undefined,
    onEnd: vi.fn(),
    onConfirmEnd: vi.fn(),
    onCancelEnd: vi.fn(),
    onFinish: vi.fn(),
    onResume: vi.fn(),
    onLater: vi.fn(),
    ...over,
  };
}

describe("TourOverlay (023)", () => {
  it("greets on first run with start / later, focus in the bubble, no axe violations", async () => {
    const p = props();
    render(<TourOverlay {...p} />);
    const bubble = screen.getByRole("dialog", { name: "Hi there, I'm Yuii!" });
    expect(bubble).toHaveTextContent(/Step 1 of/);
    expect(screen.getByRole("button", { name: "Start the tour" })).toHaveFocus();
    expect(screen.getByText("Yuii, greeting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Maybe later" }));
    expect(p.onLater).toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it("moves with the keyboard on show steps", () => {
    const p = props({ step: STEPS[1], index: 1, onBack: vi.fn() });
    render(<TourOverlay {...p} />);
    const bubble = screen.getByRole("dialog");
    fireEvent.keyDown(bubble, { key: "ArrowRight" });
    expect(p.onNext).toHaveBeenCalled();
    fireEvent.keyDown(bubble, { key: "ArrowLeft" });
    expect(p.onBack).toHaveBeenCalled();
    fireEvent.keyDown(bubble, { key: "Escape" });
    expect(p.onEnd).toHaveBeenCalled();
  });

  it("offers Skip on optional do steps and Finish on the last step", () => {
    const doStep = STEPS.find((s) => s.kind === "do" && s.optional)!;
    const skip = vi.fn();
    const { unmount } = render(<TourOverlay {...props({ step: doStep, index: 5, onNext: undefined, onSkip: skip })} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip this step" }));
    expect(skip).toHaveBeenCalled();
    unmount();
    const finish = vi.fn();
    render(<TourOverlay {...props({ step: STEPS.at(-1)!, index: STEPS.length - 1, onFinish: finish })} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(finish).toHaveBeenCalled();
  });

  it("is passive while an app dialog is open: no controls, text announced", () => {
    const dialogStep = STEPS.find((s) => s.dialog)!;
    render(<TourOverlay {...props({ step: dialogStep, index: 6, passive: true })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    const live = document.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toContain(dialogStep.title);
    expect(document.querySelector("[data-tour-layer]")!.className).toContain("pointer-events-none");
  });

  it("asks before ending and shows the resume offer", () => {
    const p = props({ step: STEPS[3], index: 3, phase: "confirm-end" });
    const { unmount } = render(<TourOverlay {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Yes, end the tour" }));
    expect(p.onConfirmEnd).toHaveBeenCalled();
    unmount();
    const r = props({ phase: "resume", resumeChapter: "first_note" });
    render(<TourOverlay {...r} />);
    expect(screen.getByRole("dialog", { name: "Welcome back!" })).toHaveTextContent("Your first note");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(r.onResume).toHaveBeenCalled();
  });

  it("does not steal focus from text the user is typing", () => {
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    render(<TourOverlay {...props({ step: STEPS[3], index: 3 })} />);
    expect(input).toHaveFocus();
    input.remove();
  });

  it("steps aside when a dialog covers the target: no ring, no pointing, dialog text", () => {
    const step = STEPS.find((s) => s.id === "first_note.new-note")!;
    render(<TourOverlay {...props({ step, index: 5, passive: true, target: { left: 20, top: 300, width: 100, height: 30 }, avoid: { left: 300, top: 200, width: 500, height: 300 } })} />);
    expect(document.querySelector("[data-tour-layer] .ring-2")).toBeNull();
    expect(document.querySelector('[aria-live="polite"]')!.textContent).toContain("Create note");
    expect(screen.getByText("Yuii, excited")).toBeInTheDocument();
  });
});
