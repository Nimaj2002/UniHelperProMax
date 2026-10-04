/**
 * Theme handling. In 001 the theme follows the OS (light/dark) via `data-theme` on <html>;
 * feature 005 adds user-created themes by supplying the same token values.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ResolvedTheme = "light" | "dark";

const query = "(prefers-color-scheme: dark)";

export function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia?.(query).matches ? "dark" : "light";
}

export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

const ThemeContext = createContext<ResolvedTheme>("light");

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useResolvedTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}
