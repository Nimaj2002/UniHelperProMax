/** 014 T096: a chat is in one place at a time — panel or tab (research R13, FR-042–FR-045). */
import { describe, expect, it } from "vitest";
import { HISTORY, reducePlacement, type Placement } from "@/features/chat/chatPlacement";

const panelWith = (chatId: string, tabs: string[] = []): Placement => ({ panel: { chatId, view: "conversation" }, tabs });
const neverBoth = (p: Placement) => expect(p.panel.chatId === null || !p.tabs.includes(p.panel.chatId)).toBe(true);

describe("chat placement", () => {
  it("Expand moves the panel's chat into a tab and closes the panel", () => {
    const { state, effects } = reducePlacement(panelWith("c1", ["c0"]), { type: "expand" });
    expect(state).toEqual({ panel: HISTORY, tabs: ["c0", "c1"] });
    expect(effects).toEqual({ openTab: "c1", closePanel: true, focus: { place: "tab", id: "c1" } });
    neverBoth(state);
  });

  it("expanding a new empty chat opens an empty chat tab", () => {
    const { state, effects } = reducePlacement({ panel: HISTORY, tabs: [] }, { type: "expand", newId: "new:abc-1234" });
    expect(state.tabs).toEqual(["new:abc-1234"]);
    expect(state.panel).toEqual(HISTORY);
    expect(effects.openTab).toBe("new:abc-1234");
    expect(effects.closePanel).toBe(true);
    // without an id a fresh one is made
    expect(reducePlacement({ panel: HISTORY, tabs: [] }, { type: "expand" }).effects.openTab).toMatch(/^new:[0-9a-f-]{8,64}$/);
  });

  it("choosing an \"Open in tab\" history entry focuses that tab", () => {
    const start: Placement = { panel: HISTORY, tabs: ["c1"] };
    const { state, effects } = reducePlacement(start, { type: "openFromHistory", chatId: "c1" });
    expect(state).toEqual(start);
    expect(effects.focusTab).toBe("c1");
    // a chat not in a tab opens in the panel
    expect(reducePlacement(start, { type: "openFromHistory", chatId: "c2" }).state.panel).toEqual({ chatId: "c2", view: "conversation" });
  });

  it("Dock closes the tab, shows the chat in the panel and reopens the panel", () => {
    const { state, effects } = reducePlacement({ panel: HISTORY, tabs: ["c1", "c2"] }, { type: "dock", tabId: "c1" });
    expect(state).toEqual({ panel: { chatId: "c1", view: "conversation" }, tabs: ["c2"] });
    expect(effects).toEqual({ closeTabs: ["c1"], openPanel: true, focus: { place: "panel" } });
    // docking a new empty chat shows the new-chat box
    expect(reducePlacement({ panel: panelWith("c9").panel, tabs: ["new:x"] }, { type: "dock", tabId: "new:x" }).state.panel).toEqual(HISTORY);
  });

  it("closing a chat tab returns the chat to the history list", () => {
    const { state, effects } = reducePlacement({ panel: HISTORY, tabs: ["c1"] }, { type: "closeTab", tabId: "c1" });
    expect(state).toEqual({ panel: HISTORY, tabs: [] });
    expect(effects).toEqual({ closeTabs: ["c1"] });
  });

  it("a chat is never in both places", () => {
    // the panel's chat became a tab elsewhere (another window): the panel shows History
    const { state } = reducePlacement(panelWith("c1", ["c1"]), { type: "closeTab", tabId: "zz" });
    expect(state.panel).toEqual(HISTORY);
    // a tab shows a chat that was in the panel
    const sent = reducePlacement(panelWith("c2", ["new:x"]), { type: "sent", from: "new:x", to: "c2" });
    expect(sent.state.tabs).toEqual(["c2"]);
    neverBoth(sent.state);
    expect(sent.effects.replaceTab).toEqual({ from: "new:x", to: "c2" });
    for (const action of [{ type: "expand" }, { type: "dock", tabId: "c1" }, { type: "openFromHistory", chatId: "c1" }] as const)
      neverBoth(reducePlacement(panelWith("c1", ["c1", "c3"]), action).state);
  });

  it("retain drops tabs (and the panel's chat) whose chat was deleted", () => {
    const { state, effects } = reducePlacement(panelWith("c2", ["c1", "new:x", "c3"]), { type: "retain", valid: (id) => id === "c3" });
    expect(state).toEqual({ panel: HISTORY, tabs: ["new:x", "c3"] });
    expect(effects.closeTabs).toEqual(["c1"]);
    const same = panelWith("c3", ["c3x"]);
    expect(reducePlacement(same, { type: "retain", valid: () => true }).state).toBe(same);
  });
});
