import { readFileSync } from "node:fs";
import path from "node:path";

const TOKENS = path.resolve(import.meta.dirname, "../../src/styles/tokens.css");

/** Parse `--name: #hex;` declarations per theme block of tokens.css. */
export function readThemes(): Record<"light" | "dark", Record<string, string>> {
  const css = readFileSync(TOKENS, "utf8");
  const block = (selector: RegExp) => {
    const start = css.search(selector);
    if (start < 0) throw new Error(`missing block ${selector}`);
    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    const vars: Record<string, string> = {};
    for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
      vars[m[1]] = m[2];
    }
    return vars;
  };
  return {
    light: block(/\[data-theme="light"\]\s*\{/),
    dark: block(/\[data-theme="dark"\]\s*\{/),
  };
}

export const EVENT_KEYS = [
  "slate", "red", "orange", "amber", "lime", "green",
  "teal", "cyan", "blue", "indigo", "violet", "pink",
] as const;
