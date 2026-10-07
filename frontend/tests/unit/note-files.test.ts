import { describe, expect, it } from "vitest";
import { MAX_NOTE_BYTES, noteNameFor, readNoteFile } from "@/features/imports/noteFiles";

const file = (name: string, bytes: BlobPart[] = ["hello"]) => new File(bytes, name);

describe("readNoteFile", () => {
  it("accepts .md, .MD and .txt, keeping the text exactly (CRLF too)", async () => {
    expect(await readNoteFile(file("Lecture 3.md", ["# Trees\r\nline\r\n"]))).toEqual({
      ok: true, fileName: "Lecture 3.md", name: "Lecture 3", content: "# Trees\r\nline\r\n",
    });
    expect((await readNoteFile(file("NOTES.MD"))).ok).toBe(true);
    expect(await readNoteFile(file("questions.txt", ["ünïcödé ✓"]))).toMatchObject({ ok: true, name: "questions", content: "ünïcödé ✓" });
  });

  it("refuses other file types", async () => {
    for (const name of ["essay.docx", "slides.pdf", "README"]) {
      expect(await readNoteFile(file(name))).toEqual({ ok: false, fileName: name, reason: `${name} isn't a .md or .txt file.` });
    }
  });

  it("refuses files over 5 MB", async () => {
    const big = file("big.md");
    Object.defineProperty(big, "size", { value: MAX_NOTE_BYTES + 1 });
    expect(await readNoteFile(big)).toMatchObject({ ok: false, reason: "big.md is larger than 5 MB." });
  });

  it("refuses text that isn't UTF-8, and binary data", async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00]);
    const reason = "notes.txt isn't readable text (save it as UTF-8 and try again).";
    expect(await readNoteFile(file("notes.txt", [utf16]))).toMatchObject({ ok: false, reason });
    expect(await readNoteFile(file("notes.txt", ["a\u0000b"]))).toMatchObject({ ok: false, reason });
    expect(await readNoteFile(file("notes.txt", [new Uint8Array([0xc3, 0x28])]))).toMatchObject({ ok: false, reason });
  });

  it("drops a UTF-8 byte-order mark and accepts empty files", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]);
    expect(await readNoteFile(file("a.md", [bom]))).toMatchObject({ ok: true, content: "hi" });
    expect(await readNoteFile(file("empty.txt", []))).toMatchObject({ ok: true, content: "" });
  });
});

describe("noteNameFor", () => {
  it("removes only the last extension and tidies whitespace", () => {
    expect(noteNameFor("Lecture 3.md")).toBe("Lecture 3");
    expect(noteNameFor("week.1.notes.txt")).toBe("week.1.notes");
    expect(noteNameFor("  spaced   out .md")).toBe("spaced out");
  });

  it("gives no name when nothing is left (the importer numbers 'Imported note')", () => {
    expect(noteNameFor(".md")).toBeNull();
    expect(noteNameFor("   .txt")).toBeNull();
  });

  it("shortens long names to 120 characters", () => {
    expect(noteNameFor(`${"x".repeat(200)}.md`)).toBe("x".repeat(120));
    expect([...(noteNameFor(`${"✓".repeat(130)}.md`) ?? "")]).toHaveLength(120);
  });
});
