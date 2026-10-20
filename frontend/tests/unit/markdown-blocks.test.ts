/** 014 T065: a growing answer split into top-level Markdown blocks (research R13). */
import { describe, expect, it } from "vitest";
import { splitBlocks } from "@/features/chat/markdownBlocks";

describe("splitBlocks", () => {
  it("splits at blank lines", () => {
    expect(splitBlocks("# Title\n\nFirst paragraph\nstill first\n\n\n- a\n- b")).toEqual(["# Title", "First paragraph\nstill first", "- a\n- b"]);
    expect(splitBlocks("")).toEqual([]);
  });

  it("never splits inside a fence, and keeps fence lines", () => {
    const text = "Intro\n\n```python\ndef f():\n\n    return 1\n```\n\nAfter";
    expect(splitBlocks(text)).toEqual(["Intro", "```python\ndef f():\n\n    return 1\n```", "After"]);
    expect(splitBlocks("~~~\na\n\nb\n~~~")).toEqual(["~~~\na\n\nb\n~~~"]);
    // a shorter or different fence doesn't close it
    expect(splitBlocks("````\n```\n\nx\n````")).toEqual(["````\n```\n\nx\n````"]);
  });

  it("closes an unclosed fence for display only", () => {
    expect(splitBlocks("Look:\n\n```ts\nconst a = 1;\n\nconst b")).toEqual(["Look:", "```ts\nconst a = 1;\n\nconst b\n```"]);
    expect(splitBlocks("~~~~\nx")).toEqual(["~~~~\nx\n~~~~"]);
  });

  it("only the last block changes as text is appended", () => {
    const full = "# Answer\n\nSome text here.\n\n```js\nlet x = 1;\nx++;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nDone.";
    let prev: string[] = [];
    for (let i = 1; i <= full.length; i++) {
      const blocks = splitBlocks(full.slice(0, i));
      // every block before the last one of the previous step is unchanged
      for (let j = 0; j < prev.length - 1; j++) expect(blocks[j]).toBe(prev[j]);
      expect(blocks.length).toBeGreaterThanOrEqual(prev.length - 1);
      prev = blocks;
    }
    expect(prev).toEqual(["# Answer", "Some text here.", "```js\nlet x = 1;\nx++;\n```", "| a | b |\n|---|---|\n| 1 | 2 |", "Done."]);
  });
});
