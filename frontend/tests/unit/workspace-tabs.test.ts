import { describe, expect, it } from "vitest";
import { EMPTY, fromServer, panes, paneOf, reduceTabs, toServer, type TabRef, type WorkspaceTabs } from "@/features/sessions/tabState";

const note = (id: string): TabRef => ({ kind: "note", id });
const doc = (id: string): TabRef => ({ kind: "document", id });
const run = (state: WorkspaceTabs, ...actions: Parameters<typeof reduceTabs>[1][]) => actions.reduce(reduceTabs, state);

describe("workspace tabs", () => {
  it("opens notes and documents as tabs of one bar; opening again focuses", () => {
    const s = run(EMPTY, { type: "open", tab: note("a") }, { type: "open", tab: doc("p") }, { type: "open", tab: note("a") });
    expect(s.tabs).toEqual([note("a"), doc("p")]);
    expect(s.active).toEqual(note("a"));
  });

  it("closing the active tab activates its neighbour", () => {
    const s = run(EMPTY, { type: "open", tab: note("a") }, { type: "open", tab: doc("p") }, { type: "open", tab: note("b") }, { type: "open", tab: doc("p") }, { type: "close", tab: doc("p") });
    expect(s.tabs).toEqual([note("a"), note("b")]);
    expect(s.active).toEqual(note("b"));
  });

  it("cycles through all tabs", () => {
    const s = run(EMPTY, { type: "open", tab: note("a") }, { type: "open", tab: doc("p") }, { type: "cycle", dir: 1 });
    expect(s.active).toEqual(note("a"));
    expect(run(s, { type: "cycle", dir: -1 }).active).toEqual(doc("p"));
  });
});

describe("split view", () => {
  const base = run(EMPTY, { type: "open", tab: doc("slides") }, { type: "open", tab: note("lecture") }, { type: "open", tab: doc("slides") });

  it("turning split on shows the active tab left and another tab right; all tabs stay open", () => {
    const s = run(base, { type: "toggleSplit" });
    expect(panes(s)).toEqual({ left: doc("slides"), right: note("lecture"), split: true });
    expect(s.tabs).toHaveLength(2);
    const off = run(s, { type: "toggleSplit" });
    expect(panes(off)).toEqual({ left: doc("slides"), right: null, split: false });
    expect(off.tabs).toHaveLength(2);
  });

  it("turning split on again restores the previous pairing", () => {
    const s = run(base, { type: "toggleSplit" }, { type: "toggleSplit" }, { type: "toggleSplit" });
    expect(panes(s)).toEqual({ left: doc("slides"), right: note("lecture"), split: true });
  });

  it("selecting a tab shows it in the focused pane; selecting a shown tab focuses its pane", () => {
    let s = run(base, { type: "open", tab: note("q") }, { type: "open", tab: doc("slides") }, { type: "toggleSplit" });
    s = run(s, { type: "focusPane", side: "right" }, { type: "open", tab: note("q") });
    expect(panes(s)).toMatchObject({ left: doc("slides"), right: note("q") });
    s = run(s, { type: "open", tab: doc("slides") });
    expect(s.split?.focused).toBe("left");
    expect(paneOf(s, doc("slides"))).toBe("left");
    expect(paneOf(s, note("lecture"))).toBeNull();
  });

  it("moves a tab to the other pane", () => {
    const s = run(base, { type: "toggleSplit" }, { type: "moveToOtherPane", tab: doc("slides") });
    expect(panes(s)).toMatchObject({ left: note("lecture"), right: doc("slides") });
  });

  it("closing a tab shown in a pane turns split off and keeps the other one", () => {
    const s = run(base, { type: "toggleSplit" }, { type: "close", tab: note("lecture") });
    expect(s.split?.enabled).toBe(false);
    expect(s.active).toEqual(doc("slides"));
  });

  it("keeps the divider ratio within 0.2–0.8", () => {
    const s = run(base, { type: "toggleSplit" }, { type: "setRatio", ratio: 0.95 });
    expect(s.split?.ratio).toBe(0.8);
  });

  it("on a narrow window a remembered split shows only the active tab", () => {
    const s = run(base, { type: "toggleSplit" });
    expect(panes(s, false)).toEqual({ left: doc("slides"), right: null, split: false });
  });

  it("drops tabs whose note or document no longer exists", () => {
    const s = run(base, { type: "toggleSplit" }, { type: "retain", valid: (t) => t.kind === "document" });
    expect(s.tabs).toEqual([doc("slides")]);
    expect(s.split?.enabled).toBe(false);
  });
});

describe("server state", () => {
  it("reads older states with note tabs only, and round-trips the new shape", () => {
    expect(fromServer({ openNoteIds: ["a", "b"], activeNoteId: "b" })).toEqual({ tabs: [note("a"), note("b")], active: note("b"), split: null });
    const s = run(EMPTY, { type: "open", tab: doc("p") }, { type: "open", tab: note("a") }, { type: "toggleSplit" });
    const wire = toServer(s);
    expect(wire.openNoteIds).toEqual(["a"]);
    expect(wire.activeNoteId).toBe("a");
    expect(fromServer(wire)).toEqual(s);
  });
});

describe("chat tabs (014 US5)", () => {
  const chat = (id: string): TabRef => ({ kind: "chat", id });

  it("round-trips the chat kind through toServer/fromServer", () => {
    const s = run(EMPTY, { type: "open", tab: note("a") }, { type: "open", tab: chat("new:0f8e5b0c-1111-4222-8333-444455556666") }, { type: "open", tab: chat("c1") });
    const wire = toServer(s);
    expect(wire.tabs).toEqual([note("a"), chat("new:0f8e5b0c-1111-4222-8333-444455556666"), chat("c1")]);
    expect(wire.openNoteIds).toEqual(["a"]);
    expect(wire.activeNoteId).toBeNull();
    expect(fromServer(wire)).toEqual(s);
  });

  it("replace keeps a chat tab's place (its first send), or shows the chat's existing tab", () => {
    let s = run(EMPTY, { type: "open", tab: note("a") }, { type: "open", tab: chat("new:x") }, { type: "open", tab: note("b") }, { type: "open", tab: chat("new:x") });
    s = reduceTabs(s, { type: "replace", from: chat("new:x"), to: chat("c1") });
    expect(s.tabs).toEqual([note("a"), chat("c1"), note("b")]);
    expect(s.active).toEqual(chat("c1"));
    s = run(s, { type: "open", tab: chat("new:y") }, { type: "replace", from: chat("new:y"), to: chat("c1") });
    expect(s.tabs).toEqual([note("a"), chat("c1"), note("b")]);
    expect(s.active).toEqual(chat("c1"));
  });

  it("a chat tab is split like a note", () => {
    const s = run(EMPTY, { type: "open", tab: note("a") }, { type: "open", tab: chat("c1") }, { type: "moveToOtherPane", tab: chat("c1") });
    const side = paneOf(s, chat("c1"));
    expect(side).not.toBeNull();
    expect(paneOf(s, note("a"))).not.toBe(side);
    const r = reduceTabs(s, { type: "replace", from: chat("c1"), to: chat("c2") });
    expect(paneOf(r, chat("c2"))).toBe(side);
    expect(panes(r).split).toBe(true);
  });
});
