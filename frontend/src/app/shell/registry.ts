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
/** Global activity bar (003: recording bar, 004: transcription progress). Empty in 001. */
export const registerActivity = activities.register;
export function useActivities(): ActivityRegistration[] {
  return useSyncExternalStore(activities.subscribe, activities.snapshot, activities.snapshot);
}

export interface PanelRegistration {
  id: string;
  component: ComponentType;
  priority?: number;
}
const panels = createRegistry<PanelRegistration>();
/** Left panel content (001: CoursePanel). The first registered panel is shown. */
export const registerCoursePanel = panels.register;
export function useCoursePanel(): PanelRegistration | undefined {
  return useSyncExternalStore(panels.subscribe, panels.snapshot, panels.snapshot)[0];
}

export interface TopBarActionRegistration {
  id: string;
  component: ComponentType;
  priority?: number;
}
const topBarActions = createRegistry<TopBarActionRegistration>();
/** Global actions on the right of the top bar (001: "New class"). */
export const registerTopBarAction = topBarActions.register;
export function useTopBarActions(): TopBarActionRegistration[] {
  return useSyncExternalStore(topBarActions.subscribe, topBarActions.snapshot, topBarActions.snapshot);
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
