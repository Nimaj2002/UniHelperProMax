import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import { mathSlices } from "./helpers/mathSlices";
import { mountNoteEditor, roundTrip } from "./helpers/noteEditor";

const dir = path.resolve(import.meta.dirname, "../fixtures/notes");
const fixtures = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
const results: Array<{ name: string; ok: boolean }> = [];

afterAll(() => {
  const ok = results.filter((r) => r.ok).length;
  console.log(`${ok}/${fixtures.length} notes unchanged, ${results.length - ok} formula/diagram diffs`);
});

describe("fidelity gate (SC-001/SC-002)", () => {
  it("has the 30-note corpus", () => {
    expect(fixtures).toHaveLength(30);
  });

  it.each(fixtures)("%s keeps every formula and diagram exactly", async (name) => {
    const original = readFileSync(path.join(dir, name), "utf8");
    const expected = mathSlices(original);
    const out = await roundTrip(original);
    const ok = JSON.stringify(mathSlices(out)) === JSON.stringify(expected);
    results.push({ name, ok });
    expect(mathSlices(out)).toEqual(expected);
    // opening the saved text again gives the same text
    expect(await roundTrip(out)).toBe(out);
  });

  it.each(fixtures)("%s keeps them after an edit elsewhere", async (name) => {
    const original = readFileSync(path.join(dir, name), "utf8");
    const { editor, unmount } = await mountNoteEditor(original);
    await act(async () => {
      editor.setMarkdown(editor.getMarkdown() + "\n\nA new paragraph with plain words.");
    });
    const out = editor.getMarkdown();
    unmount();
    expect(out).toContain("A new paragraph with plain words.");
    expect(mathSlices(out)).toEqual(mathSlices(original));
  });
});

describe("ordinary dollars (research R3)", () => {
  it.each([
    ["it costs $5 and $10", "it costs $5 and $10"],
    ["A literal \\$x\\$ here", "A literal \\$x\\$ here"],
    ["a lone $ sign", "a lone $ sign"],
    ["`$x$` in code", "`$x$` in code"],
  ])("%s", async (input, expected) => {
    expect((await roundTrip(input)).trim()).toBe(expected);
  });

  it("does not let escaped text become a formula next to a real one", async () => {
    const out = await roundTrip("\\$a $b$");
    expect(mathSlices(out)).toEqual(["$b$"]);
  });
});
