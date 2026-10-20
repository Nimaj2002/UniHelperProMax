/**
 * Workspace tabs (002 FR-013/FR-017, 007 FR-011–FR-014a): one tab bar of typed tabs (notes and
 * documents), the active tab, and an optional split view showing two tabs side by side. Pure
 * functions, so every rule is unit-tested; the page only renders the state.
 */

export type TabKind = "note" | "document" | "chat";
export interface TabRef {
  kind: TabKind;
  id: string;
}
export type Side = "left" | "right";

export interface SplitState {
  enabled: boolean;
  left: TabRef | null;
  right: TabRef | null;
  focused: Side;
  ratio: number;
}

export interface WorkspaceTabs {
  tabs: TabRef[];
  active: TabRef | null;
  split: SplitState | null;
}

export const EMPTY: WorkspaceTabs = { tabs: [], active: null, split: null };
export const MAX_TABS = 50;

export const same = (a: TabRef | null | undefined, b: TabRef | null | undefined) =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;

const has = (tabs: TabRef[], t: TabRef | null) => !!t && tabs.some((x) => same(x, t));
const other = (side: Side): Side => (side === "left" ? "right" : "left");
export const tabKey = (t: TabRef) => `${t.kind}:${t.id}`;

/** Which pane shows a tab while split view is on (null: not shown). */
export function paneOf(state: WorkspaceTabs, tab: TabRef): Side | null {
  const s = state.split;
  if (!s?.enabled) return null;
  if (same(s.left, tab)) return "left";
  if (same(s.right, tab)) return "right";
  return null;
}

/** What each pane shows; without split view the single pane shows the active tab. */
export function panes(state: WorkspaceTabs, splitAvailable = true): { left: TabRef | null; right: TabRef | null; split: boolean } {
  const s = state.split;
  if (s?.enabled && splitAvailable) return { left: s.left, right: s.right, split: true };
  return { left: state.active, right: null, split: false };
}

export type TabAction =
  | { type: "load"; state: WorkspaceTabs }
  | { type: "open"; tab: TabRef }
  | { type: "close"; tab: TabRef }
  | { type: "cycle"; dir: 1 | -1 }
  | { type: "toggleSplit" }
  | { type: "focusPane"; side: Side }
  | { type: "moveToOtherPane"; tab: TabRef }
  | { type: "setRatio"; ratio: number }
  /** 014: a chat tab's id changes (its first send, or another chat shown in it); keeps its place. */
  | { type: "replace"; from: TabRef; to: TabRef }
  | { type: "retain"; valid: (t: TabRef) => boolean };

function show(state: WorkspaceTabs, tab: TabRef): WorkspaceTabs {
  const s = state.split;
  if (!s?.enabled) return { ...state, active: tab };
  if (same(s.left, tab)) return { ...state, active: tab, split: { ...s, focused: "left" } };
  if (same(s.right, tab)) return { ...state, active: tab, split: { ...s, focused: "right" } };
  return { ...state, active: tab, split: { ...s, [s.focused]: tab } };
}

export function reduceTabs(state: WorkspaceTabs, action: TabAction): WorkspaceTabs {
  switch (action.type) {
    case "load":
      return action.state;
    case "open": {
      const tabs = has(state.tabs, action.tab) ? state.tabs : [...state.tabs, action.tab].slice(-MAX_TABS);
      return show({ ...state, tabs }, action.tab);
    }
    case "close": {
      const i = state.tabs.findIndex((t) => same(t, action.tab));
      if (i < 0) return state;
      const tabs = state.tabs.filter((_, j) => j !== i);
      let split = state.split;
      let active = same(state.active, action.tab) ? (tabs[i] ?? tabs[i - 1] ?? null) : state.active;
      if (split?.enabled && (same(split.left, action.tab) || same(split.right, action.tab))) {
        // closing a pane's tab turns split view off; the other pane's tab takes the area
        const remaining = same(split.left, action.tab) ? split.right : split.left;
        split = { ...split, enabled: false, left: null, right: null };
        active = remaining ?? active;
      }
      return { tabs, active: has(tabs, active) ? active : (tabs[0] ?? null), split };
    }
    case "cycle": {
      if (!state.tabs.length) return state;
      const i = state.tabs.findIndex((t) => same(t, state.active));
      const next = state.tabs[(i + action.dir + state.tabs.length) % state.tabs.length];
      return show(state, next);
    }
    case "toggleSplit": {
      const s = state.split;
      if (s?.enabled) {
        const focusedTab = s[s.focused];
        return { ...state, active: focusedTab ?? state.active, split: { ...s, enabled: false } };
      }
      const left = state.active ?? state.tabs[0] ?? null;
      const prev = s && has(state.tabs, s.right) && !same(s.right, left) ? s.right : null;
      const right = prev ?? state.tabs.find((t) => !same(t, left)) ?? null;
      return {
        ...state,
        active: left,
        split: { enabled: true, left, right, focused: "left", ratio: s?.ratio ?? 0.5 },
      };
    }
    case "focusPane": {
      const s = state.split;
      if (!s?.enabled) return state;
      return { ...state, active: s[action.side] ?? state.active, split: { ...s, focused: action.side } };
    }
    case "moveToOtherPane": {
      const s = state.split;
      if (!s?.enabled) {
        const opened = reduceTabs(state, { type: "toggleSplit" });
        return reduceTabs({ ...opened, split: { ...opened.split!, focused: "right" } }, { type: "open", tab: action.tab });
      }
      const from = paneOf(state, action.tab) ?? s.focused;
      const to = other(from);
      const swapped = { ...s, [to]: action.tab, [from]: same(s[from], action.tab) ? s[to] : s[from], focused: to };
      return { ...state, active: action.tab, split: swapped };
    }
    case "setRatio":
      return state.split ? { ...state, split: { ...state.split, ratio: Math.min(0.8, Math.max(0.2, action.ratio)) } } : state;
    case "replace": {
      if (!has(state.tabs, action.from)) return reduceTabs(state, { type: "open", tab: action.to });
      // the other chat is open already: close this tab and show that one
      if (has(state.tabs, action.to)) return reduceTabs(reduceTabs(state, { type: "close", tab: action.from }), { type: "open", tab: action.to });
      const swap = (t: TabRef | null) => (same(t, action.from) ? action.to : t);
      const split = state.split ? { ...state.split, left: swap(state.split.left), right: swap(state.split.right) } : null;
      return { tabs: state.tabs.map((t) => swap(t)!), active: swap(state.active), split };
    }
    case "retain": {
      const tabs = state.tabs.filter(action.valid);
      if (tabs.length === state.tabs.length) return state;
      let next: WorkspaceTabs = { ...state, tabs };
      for (const t of state.tabs) if (!action.valid(t)) next = reduceTabs({ ...next, tabs: [...next.tabs, t] }, { type: "close", tab: t });
      return next;
    }
  }
}

/** Server shape (007 WorkspaceStateV2) → state; tolerant of older states without `tabs`. */
export function fromServer(s: {
  openNoteIds?: string[];
  activeNoteId?: string | null;
  tabs?: TabRef[] | null;
  active?: TabRef | null;
  split?: (Omit<SplitState, "left" | "right"> & { left?: TabRef | null; right?: TabRef | null }) | null;
}): WorkspaceTabs {
  const tabs = s.tabs ?? (s.openNoteIds ?? []).map((id) => ({ kind: "note" as const, id }));
  const active = s.active ?? (s.activeNoteId ? { kind: "note" as const, id: s.activeNoteId } : null);
  const split = s.split ? { ...s.split, left: s.split.left ?? null, right: s.split.right ?? null } : null;
  return { tabs, active: has(tabs, active) ? active : (tabs[0] ?? null), split };
}

export function toServer(state: WorkspaceTabs) {
  const noteIds = state.tabs.filter((t) => t.kind === "note").map((t) => t.id);
  return {
    openNoteIds: noteIds,
    activeNoteId: state.active?.kind === "note" ? state.active.id : null,
    tabs: state.tabs,
    active: state.active,
    split: state.split,
  };
}
