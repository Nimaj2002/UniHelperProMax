/** 012 R12 / FR-076, FR-083, FR-084: home panel state. */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PANELS_KEY, TASKS_WIDTH_KEY, usePanels } from "@/features/home/usePanels";

function windowIs(wide: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query === "(min-width: 1100px)" ? wide : false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("usePanels", () => {
  it("first use on a wide window: both open, default width", () => {
    windowIs(true);
    const { result } = renderHook(() => usePanels());
    expect(result.current.panels).toEqual({ calendar: true, tasks: true });
    expect(result.current.lastOpen).toBeNull();
    expect(result.current.tasksWidth).toBe(420);
  });

  it("first use on a narrow window: Calendar open, Tasks a rail", () => {
    windowIs(false);
    const { result } = renderHook(() => usePanels());
    expect(result.current.panels).toEqual({ calendar: true, tasks: false });
  });

  it("close on the last open panel returns last-open and keeps it open", () => {
    windowIs(true);
    const { result } = renderHook(() => usePanels());
    let r: string = "";
    act(() => {
      r = result.current.close("tasks");
    });
    expect(r).toBe("closed");
    expect(result.current.lastOpen).toBe("calendar");
    act(() => {
      r = result.current.close("calendar");
    });
    expect(r).toBe("last-open");
    expect(result.current.panels).toEqual({ calendar: true, tasks: false });
    act(() => {
      r = result.current.toggle("calendar");
    });
    expect(r).toBe("last-open");
    expect(result.current.panels.calendar).toBe(true);
  });

  it("remembers panels and width in uh.home.panels / uh.home.tasksWidth", () => {
    windowIs(true);
    const first = renderHook(() => usePanels());
    act(() => {
      first.result.current.close("calendar");
      first.result.current.setTasksWidth(512);
    });
    expect(JSON.parse(localStorage.getItem(PANELS_KEY)!)).toEqual({ calendar: false, tasks: true });
    expect(JSON.parse(localStorage.getItem(TASKS_WIDTH_KEY)!)).toBe(512);
    first.unmount();
    const again = renderHook(() => usePanels());
    expect(again.result.current.panels).toEqual({ calendar: false, tasks: true });
    expect(again.result.current.tasksWidth).toBe(512);
  });

  it("applies the width rules: no room closes Tasks silently on load, opening one closes the other", () => {
    windowIs(true);
    localStorage.setItem(PANELS_KEY, JSON.stringify({ calendar: true, tasks: true }));
    const onAutoClose = vi.fn();
    const { result, rerender } = renderHook(({ mainWidth }) => usePanels({ mainWidth, onAutoClose }), { initialProps: { mainWidth: 700 as number | null } });
    expect(result.current.panels).toEqual({ calendar: true, tasks: false });
    expect(onAutoClose).not.toHaveBeenCalled();
    act(() => {
      result.current.open("tasks");
    });
    expect(result.current.panels).toEqual({ calendar: false, tasks: true });
    expect(onAutoClose).toHaveBeenCalledWith("calendar");

    // room again: open both, then a shrink closes Tasks with a notice
    rerender({ mainWidth: 1200 });
    act(() => {
      result.current.open("calendar");
    });
    expect(result.current.panels).toEqual({ calendar: true, tasks: true });
    onAutoClose.mockClear();
    rerender({ mainWidth: 700 });
    expect(result.current.panels).toEqual({ calendar: true, tasks: false });
    expect(onAutoClose).toHaveBeenCalledWith("tasks");
  });

  it("ignores a malformed stored value", () => {
    windowIs(false);
    localStorage.setItem(PANELS_KEY, JSON.stringify({ calendar: "yes" }));
    localStorage.setItem(TASKS_WIDTH_KEY, JSON.stringify("wide"));
    const { result } = renderHook(() => usePanels());
    expect(result.current.panels).toEqual({ calendar: true, tasks: false });
    expect(result.current.tasksWidth).toBe(420);
  });
});
