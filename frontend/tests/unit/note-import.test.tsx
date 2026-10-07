import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { Note, NoteMeta } from "@/features/sessions/api";
import { firstFreeName, runNoteImport, type ConflictPrompt, type NoteImportApi, type NoteImportUi } from "@/features/imports/noteImport";
import { nameKey } from "@/features/imports/noteFiles";

const meta = (id: string, name: string, version = 1) => ({ id, name, version }) as NoteMeta;
const file = (name: string, text = `text of ${name}`) => new File([text], name);

function fakeServer(existing: NoteMeta[] = []) {
  const notes = new Map(existing.map((n) => [nameKey(n.name), { ...n, content: "old" } as Note]));
  let seq = 0;
  const api: NoteImportApi = {
    create: vi.fn(async (name: string, content: string) => {
      if (notes.has(nameKey(name))) throw new ApiError(409, "name_taken", "taken");
      const note = { id: `n${++seq}`, name, version: 1, content, hash: "h" } as Note;
      notes.set(nameKey(name), note);
      return note;
    }),
    replace: vi.fn(async (id: string, version: number, content: string) => {
      const note = [...notes.values()].find((n) => n.id === id)!;
      if (note.version !== version) throw new ApiError(412, "version_conflict", "stale");
      Object.assign(note, { content, version: version + 1 });
      return { ...note };
    }),
  };
  return { api, notes };
}

function scriptedUi(answers: Array<{ choice: ConflictChoiceLike; applyToAll?: boolean }>, confirms: boolean[] = []) {
  const prompts: ConflictPrompt[] = [];
  const confirmed: string[][] = [];
  const ui: NoteImportUi = {
    resolveConflict: vi.fn(async (p) => {
      prompts.push(p);
      const next = answers.shift();
      if (!next) throw new Error("unexpected prompt");
      return { choice: next.choice, applyToAll: next.applyToAll ?? false } as Awaited<ReturnType<NoteImportUi["resolveConflict"]>>;
    }),
    confirmReplace: vi.fn(async (names) => {
      confirmed.push(names);
      return confirms.shift() ?? true;
    }),
  };
  return { ui, prompts, confirmed };
}
type ConflictChoiceLike = { action: "rename"; name: string } | { action: "replace" } | { action: "skip" };

describe("runNoteImport", () => {
  it("imports each file as a new note named after it", async () => {
    const { api } = fakeServer();
    const { ui } = scriptedUi([]);
    const results = await runNoteImport({ files: [file("Lecture 3.md"), file("questions.txt")], notes: [], api, ui });
    expect(results.map((r) => [r.fileName, r.outcome, r.name])).toEqual([
      ["Lecture 3.md", "imported", "Lecture 3"],
      ["questions.txt", "imported", "questions"],
    ]);
  });

  it("rejected files don't stop the others", async () => {
    const { api } = fakeServer();
    const { ui } = scriptedUi([]);
    const results = await runNoteImport({ files: [file("a.docx"), file("b.md")], notes: [], api, ui });
    expect(results.map((r) => r.outcome)).toEqual(["rejected", "imported"]);
    expect(api.create).toHaveBeenCalledTimes(1);
  });

  it("Rename suggests the first free name; a second clash prompts again", async () => {
    const { api } = fakeServer([meta("a", "Lecture 3"), meta("b", "Lecture 3 (2)")]);
    const { ui, prompts } = scriptedUi([
      { choice: { action: "rename", name: "Lecture 3 (2)" } }, // taken too
      { choice: { action: "rename", name: "Week 3" } },
    ]);
    const results = await runNoteImport({ files: [file("Lecture 3.md")], notes: [meta("a", "Lecture 3"), meta("b", "Lecture 3 (2)")], api, ui });
    expect(prompts[0].suggestion).toBe("Lecture 3 (3)");
    expect(prompts).toHaveLength(2);
    expect(results).toMatchObject([{ outcome: "renamed", name: "Week 3" }]);
  });

  it("Skip (and closing the prompt) writes nothing", async () => {
    const { api, notes } = fakeServer([meta("a", "Lecture 3")]);
    const { ui } = scriptedUi([{ choice: { action: "skip" } }]);
    const results = await runNoteImport({ files: [file("Lecture 3.md")], notes: [meta("a", "Lecture 3")], api, ui });
    expect(results).toMatchObject([{ outcome: "skipped" }]);
    expect(api.replace).not.toHaveBeenCalled();
    expect(notes.get("lecture 3")?.content).toBe("old");
  });

  it("Replace needs a second confirmation; cancelling returns to the prompt", async () => {
    const { api, notes } = fakeServer([meta("a", "Lecture 3", 4)]);
    const { ui, prompts, confirmed } = scriptedUi(
      [{ choice: { action: "replace" } }, { choice: { action: "replace" } }],
      [false, true],
    );
    const replaced = vi.fn();
    const results = await runNoteImport({
      files: [file("Lecture 3.md", "imported")], notes: [meta("a", "Lecture 3", 4)], api, ui, onReplaced: replaced,
    });
    expect(prompts).toHaveLength(2);
    expect(confirmed).toEqual([["Lecture 3"], ["Lecture 3"]]);
    expect(api.replace).toHaveBeenCalledWith("a", 4, "imported");
    expect(notes.get("lecture 3")?.content).toBe("imported");
    expect(results).toMatchObject([{ outcome: "replaced" }]);
    expect(replaced).toHaveBeenCalledWith(expect.objectContaining({ id: "a", version: 5 }));
  });

  it("Replace is refused without a request while the note has unsaved changes", async () => {
    const { api } = fakeServer([meta("a", "Lecture 3")]);
    const { ui } = scriptedUi([{ choice: { action: "replace" } }]);
    const results = await runNoteImport({
      files: [file("Lecture 3.md")], notes: [meta("a", "Lecture 3")], api, ui,
      replaceBlocked: (_id, name) => `“${name}” has unsaved changes. Wait until it says Saved, then try again.`,
    });
    expect(api.replace).not.toHaveBeenCalled();
    expect(results).toMatchObject([{ outcome: "rejected", detail: "“Lecture 3” has unsaved changes. Wait until it says Saved, then try again." }]);
  });

  it("server refusals of Replace leave the note untouched and are explained", async () => {
    const { api } = fakeServer([meta("a", "Lecture 3")]);
    api.replace = vi.fn(async () => {
      throw new ApiError(409, "note_transcribing", "busy");
    });
    const { ui } = scriptedUi([{ choice: { action: "replace" } }]);
    const results = await runNoteImport({ files: [file("Lecture 3.md")], notes: [meta("a", "Lecture 3")], api, ui });
    expect(results[0]).toMatchObject({ outcome: "rejected", detail: "A transcription is being added to “Lecture 3”. Try again when it finishes." });
  });

  it("two files with the same name conflict with each other", async () => {
    const { api } = fakeServer();
    const { ui, prompts } = scriptedUi([{ choice: { action: "skip" } }]);
    const results = await runNoteImport({ files: [file("a.md"), file("A.txt")], notes: [], api, ui });
    expect(prompts[0]).toMatchObject({ fileName: "A.txt", name: "A", suggestion: "A (2)" });
    expect(results.map((r) => r.outcome)).toEqual(["imported", "skipped"]);
  });

  it("Apply to all: Rename uses suggestions without asking again", async () => {
    const existing = [meta("a", "one"), meta("b", "two"), meta("c", "three")];
    const { api } = fakeServer(existing);
    const { ui, prompts } = scriptedUi([{ choice: { action: "rename", name: "one (2)" }, applyToAll: true }]);
    const results = await runNoteImport({ files: [file("one.md"), file("two.md"), file("three.md")], notes: existing, api, ui });
    expect(prompts).toHaveLength(1);
    expect(prompts[0].remaining).toBe(2);
    expect(results.map((r) => r.name)).toEqual(["one (2)", "two (2)", "three (2)"]);
  });

  it("Apply to all: Replace asks once, listing every note", async () => {
    const existing = [meta("a", "one"), meta("b", "two"), meta("c", "three")];
    const { api } = fakeServer(existing);
    const { ui, confirmed } = scriptedUi([{ choice: { action: "replace" }, applyToAll: true }]);
    const results = await runNoteImport({ files: [file("one.md"), file("two.md"), file("three.md")], notes: existing, api, ui });
    expect(confirmed).toEqual([["one", "two", "three"]]);
    expect(results.map((r) => r.outcome)).toEqual(["replaced", "replaced", "replaced"]);
  });

  it("files with no name are numbered 'Imported note' without prompting", async () => {
    const { api } = fakeServer([meta("a", "Imported note")]);
    const { ui } = scriptedUi([]);
    const results = await runNoteImport({ files: [file(".md"), file(".txt")], notes: [meta("a", "Imported note")], api, ui });
    expect(results.map((r) => r.name)).toEqual(["Imported note (2)", "Imported note (3)"]);
    expect(ui.resolveConflict).not.toHaveBeenCalled();
  });
});

describe("firstFreeName", () => {
  it("stays within 120 characters", () => {
    const base = "x".repeat(120);
    expect(firstFreeName(base, new Set([nameKey(base)]))).toBe(`${"x".repeat(116)} (2)`);
  });
});
