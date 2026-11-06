import { createContext, useCallback, useContext, type ReactNode } from "react";
import { useNavigate, type NavigateOptions } from "react-router";

/**
 * While the quick form holds something the user entered, a click on an entry or a day heading is
 * a click outside the form: it must not open the entry and so throw the draft away (009 FR-039).
 * `blocked()` answers that and, when it blocks, puts focus back into the form.
 */
const EntryGuard = createContext<() => boolean>(() => false);

export function EntryGuardProvider({ blocked, children }: { blocked: () => boolean; children: ReactNode }) {
  return <EntryGuard.Provider value={blocked}>{children}</EntryGuard.Provider>;
}

/** Navigate to `to` unless a filled quick form is open. */
export function useGuardedNavigate(): (to: string, options?: NavigateOptions) => void {
  const blocked = useContext(EntryGuard);
  const navigate = useNavigate();
  return useCallback(
    (to: string, options?: NavigateOptions) => {
      if (!blocked()) void navigate(to, options);
    },
    [blocked, navigate],
  );
}

/** Focus the quick form's error, or its first field, after a blocked click. */
export function focusQuickForm() {
  const form = document.querySelector<HTMLElement>("form[aria-label='New entry']");
  const target =
    form?.querySelector<HTMLElement>("[role='alert']") ??
    form?.querySelector<HTMLElement>("input:not([type='hidden']):not([disabled])") ??
    form?.querySelector<HTMLElement>("button:not([disabled])");
  target?.focus();
}
