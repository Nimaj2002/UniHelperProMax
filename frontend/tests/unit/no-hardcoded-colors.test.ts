/**
 * Constitution V: colours come only from theme tokens. Fails on colour literals anywhere
 * under src/ except src/styles/tokens.css.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../../src");
const ALLOWED = new Set([
  path.join(SRC, "styles", "tokens.css"),
  // 024: sample PDF highlights stored as data (EmbedPDF's saved colour), never used for UI styling
  path.join(SRC, "demo", "handlers", "documents.ts"),
]);

const TW_COLORS =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const TW_PREFIX =
  "bg|text|border|border-[trblxy]|ring|ring-offset|fill|stroke|from|to|via|outline|decoration|shadow|accent|caret|divide|placeholder";
const NAMED =
  "black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|maroon|navy|teal|olive|lime|aqua|fuchsia";

const RULES: [string, RegExp][] = [
  ["hex colour", /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/],
  ["colour function", /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/],
  ["Tailwind palette class", new RegExp(`(?<![\\w-])(?:${TW_PREFIX})-(?:${TW_COLORS})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`)],
  ["named CSS colour", new RegExp(`(?:color|background|border|fill|stroke|outline)[\\w-]*\\s*:\\s*(?:${NAMED})\\b`, "i")],
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx|css)$/.test(name) && !name.endsWith(".d.ts") ? [p] : [];
  });
}

describe("no hard-coded colours outside tokens.css", () => {
  const all = files(SRC).filter((f) => !ALLOWED.has(f));

  it("scans some files", () => expect(all.length).toBeGreaterThan(0));

  it.each(all.map((f) => [path.relative(SRC, f), f]))("%s", (_rel, file) => {
    const problems: string[] = [];
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
        for (const [label, re] of RULES) {
          const m = line.match(re);
          if (m) problems.push(`line ${i + 1}: ${label} "${m[0]}"`);
        }
      });
    expect(problems).toEqual([]);
  });
});
