/**
 * Copies pdf.js's runtime assets (character maps, standard fonts, image decoders, colour
 * profiles) to public/pdfjs/ so the reader never loads anything from a third party (007 R3).
 * Run by `predev` and `prebuild`; public/pdfjs/ is git-ignored.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const pkg = path.dirname(require.resolve("pdfjs-dist/package.json"));
const target = path.join(root, "public", "pdfjs");

rmSync(target, { recursive: true, force: true }); // no stale files from another version
mkdirSync(target, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  const from = path.join(pkg, dir);
  if (existsSync(from)) cpSync(from, path.join(target, dir), { recursive: true });
}
console.log(`pdf.js assets copied to ${path.relative(root, target)}`);
