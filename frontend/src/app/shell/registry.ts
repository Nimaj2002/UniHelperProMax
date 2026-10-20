/**
 * Shell extension points (contracts/ui-shell.md). Features register components here at
 * module load; the shell renders whatever is registered.
 */
import { useSyncExternalStore, type ComponentType } from "react";

export interface ActivityRegistration {
  id: string;
  component: ComponentType;
  priority?: number;
}

function createRegistry<T extends { id: string; priority?: number }>() {
  let items: T[] = [];
  const listeners = new Set<() => void>();
  return {
    register(item: T) {
      items = [...items.filter((i) => i.id !== item.id), item].sort(
        (a, b) => (a.priority ?? 0) - (b.priority ?? 0),
      );
      listeners.forEach((l) => l());
      return () => {
        items = items.filter((i) => i !== item);
        listeners.forEach((l) => l());
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => items,
  };
}

const activities = createRegistry<ActivityRegistration>();
/** Activity pills floating over the main card (003: recording, 004: transcription progress). */
export const registerActivity = activities.register;
export function useActivities(): ActivityRegistration[] {
  return useSyncExternalStore(activities.subscribe, activities.snapshot, activities.snapshot);
}

export interface PanelRegistration {
  id: string;
  component: ComponentType;
  /** Search box shown above the panel's heading (001: course search). */
  search?: ComponentType;
  priority?: number;
}
const panels = createRegistry<PanelRegistration>();
/** Left panel content (001: CoursePanel). The first registered panel is shown. */
export const registerCoursePanel = panels.register;
export function useCoursePanel(): PanelRegistration | undefined {
  return useSyncExternalStore(panels.subscribe, panels.snapshot, panels.snapshot)[0];
}

/** How a side panel action draws itself: with its label, or as an icon (the closed rail). */
export interface PanelActionProps {
  variant?: "full" | "icon";
}
export interface PanelActionRegistration {
  id: string;
  /** "courses-heading": beside the course list heading; "footer": the panel's pinned footer. */
  slot: "courses-heading" | "footer";
  component: ComponentType<PanelActionProps>;
  priority?: number;
}
const panelActions = createRegistry<PanelActionRegistration>();
/** Actions in the side panel (001 "New class" beside Courses, 005 Settings in the footer). */
export const registerPanelAction = panelActions.register;
export function usePanelActions(slot: PanelActionRegistration["slot"]): PanelActionRegistration[] {
  const all = useSyncExternalStore(panelActions.subscribe, panelActions.snapshot, panelActions.snapshot);
  return all.filter((a) => a.slot === slot);
}

export interface ActivitySignal {
  id: string;
  /** Hook: true while the activity runs (e.g. a recording in progress). */
  useActive: () => boolean;
  /** Appended to the session panel rail item's name, e.g. "recording in progress". */
  description: string;
  /**
   * "recording" / "transcription" mark the rail's Recordings item; "answer" (being generated) and
   * "unseen" (a new answer) mark its Chat item (014 FR-006).
   */
  kind: "recording" | "transcription" | "answer" | "unseen";
  priority?: number;
}
const activitySignals = createRegistry<ActivitySignal>();
/**
 * Long-running work signalled on the closed session panel's rail (008 FR-022, 014 FR-006), so
 * closing the panel never hides a recording.
 */
export const registerActivitySignal = activitySignals.register;
export function useActivitySignals(): ActivitySignal[] {
  return useSyncExternalStore(activitySignals.subscribe, activitySignals.snapshot, activitySignals.snapshot);
}

export interface AccountMenuItem {
  id: string;
  label: string;
  ownerOnly?: boolean;
  priority?: number;
  onSelect: (navigate: (to: string) => void) => void;
}
const accountMenu = createRegistry<AccountMenuItem>();
/** Items in the account menu (US5: change password, time zone, admin). */
export const registerAccountMenuItem = accountMenu.register;
export function useAccountMenuItems(): AccountMenuItem[] {
  return useSyncExternalStore(accountMenu.subscribe, accountMenu.snapshot, accountMenu.snapshot);
}

const hosts = createRegistry<{ id: string; component: ComponentType; priority?: number }>();
/** Invisible app-wide hosts (e.g. dialogs opened from the account menu). */
export const registerGlobalHost = hosts.register;
export function useGlobalHosts() {
  return useSyncExternalStore(hosts.subscribe, hosts.snapshot, hosts.snapshot);
}

/** Return false to block sign-out (e.g. while recording); the guard explains why to the user. */
export type SignOutGuard = (proceed: () => void) => boolean;
const signOutGuards = new Set<SignOutGuard>();
export function registerSignOutGuard(guard: SignOutGuard) {
  signOutGuards.add(guard);
  return () => signOutGuards.delete(guard);
}
export function signOutAllowed(proceed: () => void): boolean {
  for (const g of signOutGuards) if (!g(proceed)) return false;
  return true;
}
