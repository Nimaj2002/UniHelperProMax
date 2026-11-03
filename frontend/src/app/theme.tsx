/**
 * Theme handling (001 light/dark from the OS; 005 adds the per-account choice and custom
 * themes). The settings feature calls `setThemeChoice` from the user's preference; the choice
 * is cached in localStorage so `public/theme-boot.js` can apply it before the first paint.
 * Custom themes = `data-theme` of their base + their colours as inline CSS variables on <html>.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ensureContrast, HEX, mix } from "@/features/settings/themes/colors";

export type ResolvedTheme = "light" | "dark";
export type ThemeChoice =
  | { kind: "system" }
  | { kind: "light" }
  | { kind: "dark" }
  | { kind: "custom"; base: ResolvedTheme; vars: Record<string, string> };

export const THEME_CACHE_KEY = "uh.theme";
const query = "(prefers-color-scheme: dark)";

export function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia?.(query).matches ? "dark" : "light";
}

function readCache(): ThemeChoice {
  try {
    const raw = JSON.parse(window.localStorage.getItem(THEME_CACHE_KEY) ?? "null");
    if (raw?.kind === "light" || raw?.kind === "dark" || raw?.kind === "system") return { kind: raw.kind };
    if (raw?.kind === "custom" && (raw.base === "light" || raw.base === "dark") && raw.vars && typeof raw.vars === "object") {
      return { kind: "custom", base: raw.base, vars: raw.vars };
    }
  } catch {
    /* unreadable cache: fall back to the system theme */
  }
  return { kind: "system" };
}

let choice: ThemeChoice = typeof window === "undefined" ? { kind: "system" } : readCache();
const listeners = new Set<() => void>();

/** Apply a theme choice app-wide at once (and remember it for the next page load). */
export function setThemeChoice(next: ThemeChoice) {
  if (JSON.stringify(next) === JSON.stringify(choice)) return;
  choice = next;
  try {
    window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the theme still applies for this visit */
  }
  listeners.forEach((l) => l());
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => choice,
    () => choice,
  );
}

/**
 * 009 calendar tokens for a custom or preset theme, derived from its colours (they are not part
 * of the editable token set): the draft block is an accent tint with readable text, and the
 * Event marker a strong neutral — AA on the theme's background (text ≥ 4.5:1, marks ≥ 3:1).
 */
export function derivedCalendarVars(vars: Record<string, string>): Record<string, string> {
  const [bg, text, accent] = [vars["--surface"], vars["--text-primary"], vars["--accent"]];
  if (![bg, text, accent].every((c) => c !== undefined && HEX.test(c))) return {};
  const draftBg = mix(bg, accent, 0.18);
  return {
    "--draft-bg": draftBg,
    "--draft-border": ensureContrast(accent, [draftBg, bg], 3),
    "--draft-fg": ensureContrast(text, [draftBg], 4.5),
    "--event-marker": ensureContrast(mix(text, bg, 0.2), [bg], 3),
  };
}

let appliedVars: string[] = [];

export function applyTheme(theme: ResolvedTheme, vars: Record<string, string> = {}): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  window.uhDesktop?.setTitleBarTheme?.(theme);
  const all = { ...derivedCalendarVars(vars), ...vars };
  for (const name of appliedVars) if (!(name in all)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(all)) root.style.setProperty(name, value);
  appliedVars = Object.keys(all);
}

const ThemeContext = createContext<ResolvedTheme>("light");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const current = useThemeChoice();
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: ResolvedTheme = current.kind === "system" ? system : current.kind === "custom" ? current.base : current.kind;
  const vars = current.kind === "custom" ? current.vars : undefined;
  useEffect(() => {
    applyTheme(resolved, vars);
  }, [resolved, vars]);

  return <ThemeContext.Provider value={resolved}>{children}</ThemeContext.Provider>;
}

export function useResolvedTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}
