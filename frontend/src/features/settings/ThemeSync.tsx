/** Keeps the app's theme in line with the account's choice (005 FR-015): runs for signed-in
 * users; a deleted/unknown custom theme falls back to light/dark. */
import { useEffect } from "react";
import { setThemeChoice } from "@/app/theme";
import { usePreferences } from "@/features/sessions/api";
import { useThemes } from "./api";
import { cssVars, type ColorSet } from "./themes/colors";
import { PRESET_PREFIX, presetById } from "./themes/presets";

export function ThemeSync() {
  const prefs = usePreferences();
  const choice = prefs.data?.theme ?? null;
  const custom = choice !== null && !["system", "light", "dark"].includes(choice) && !choice.startsWith(PRESET_PREFIX);
  const themes = useThemes(custom);
  useEffect(() => {
    if (choice === null) return;
    if (choice === "system" || choice === "light" || choice === "dark") return setThemeChoice({ kind: choice });
    if (choice.startsWith(PRESET_PREFIX)) {
      const preset = presetById(choice); // built in: no request needed
      return setThemeChoice(preset ? { kind: "custom", base: preset.base, vars: cssVars(preset.colors) } : { kind: "system" });
    }
    if (!themes.data) return;
    const theme = themes.data.find((t) => t.id === choice);
    if (theme) setThemeChoice({ kind: "custom", base: theme.base, vars: cssVars(theme.colors as ColorSet) });
    else setThemeChoice({ kind: "system" });
  }, [choice, themes.data]);
  return null;
}
