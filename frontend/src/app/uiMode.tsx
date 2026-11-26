/** 026: the chosen interface, Ultimate (the original shell) or Simple, kept per account in the preferences. */
import { useCallback, useEffect } from "react";
import { usePreferences, useUpdatePreferences } from "@/features/sessions/api";
import { readLocal, writeLocal } from "@/lib/storage";

export type UiMode = "ultimate" | "simple";
const KEY = "uh.uiMode"; // last known mode, so a Simple user doesn't see Ultimate while preferences load

const cached = (): UiMode => (readLocal<unknown>(KEY, "ultimate") === "simple" ? "simple" : "ultimate");

export function useUiMode() {
  const prefs = usePreferences();
  const update = useUpdatePreferences();
  const known = prefs.isSuccess ? (prefs.data.uiMode === "simple" ? "simple" : "ultimate") : cached();
  useEffect(() => {
    if (prefs.isSuccess) writeLocal(KEY, known);
  }, [prefs.isSuccess, known]);
  const setMode = useCallback((uiMode: UiMode) => update.mutate({ uiMode }), [update]);
  return { mode: known as UiMode, ready: prefs.isSuccess, chosen: prefs.isSuccess ? !!prefs.data.uiMode : null, setMode };
}
