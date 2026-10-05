import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PanelResizeHandle } from "@/components/PanelResizeHandle";

beforeAll(() => {
  Element.prototype.setPointerCapture ??= () => {};
});

const nextFrame = () => act(() => new Promise<void>((r) => requestAnimationFrame(() => r())));

function setup(props: Partial<Parameters<typeof PanelResizeHandle>[0]> = {}) {
  const onResize = vi.fn();
  const onDrag = vi.fn();
  render(
    <PanelResizeHandle
      value={300}
      min={260}
      max={640}
      defaultValue={300}
      grow="left"
      label="Resize audio panel"
      controls="x"
      onResize={onResize}
      onDrag={onDrag}
      {...props}
    />,
  );
  return { onResize, onDrag, handle: screen.getByRole("separator", { name: "Resize audio panel" }) };
}

describe("PanelResizeHandle", () => {
  it("previews a drag once per frame without committing, then commits once on release", async () => {
    const { onResize, onDrag, handle } = setup();
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 480, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 440, pointerId: 1 });
    expect(onDrag).not.toHaveBeenCalled(); // coalesced into the next frame
    await nextFrame();
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenLastCalledWith(360); // dragging left widens a left-edge handle
    expect(handle).toHaveAttribute("aria-valuenow", "360");
    expect(onResize).not.toHaveBeenCalled(); // nothing re-renders mid-drag
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 100, pointerId: 1 });
    expect(onResize).toHaveBeenCalledTimes(1);
    expect(onResize).toHaveBeenCalledWith(640); // clamped to max
    expect(document.body.style.cursor).toBe("");
  });

  it("vertical handles follow the pointer's y and convert px to units", async () => {
    const { onResize, handle } = setup({ grow: "up", value: 50, min: 15, max: 85, defaultValue: 50, step: 5, unitsPerPx: () => 0.1, onDrag: undefined });
    expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    fireEvent.pointerDown(handle, { button: 0, clientY: 400, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 300, pointerId: 1 });
    expect(onResize).toHaveBeenLastCalledWith(60); // without onDrag every move commits
  });

  it("keyboard: arrows step, Home/End go to the bounds (respecting the live limit), Enter resets", () => {
    const { onResize, handle } = setup({ limit: () => 500 });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onResize).toHaveBeenLastCalledWith(316);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onResize).toHaveBeenLastCalledWith(284);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onResize).toHaveBeenLastCalledWith(500);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onResize).toHaveBeenLastCalledWith(260);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(onResize).toHaveBeenLastCalledWith(300);
  });
});
