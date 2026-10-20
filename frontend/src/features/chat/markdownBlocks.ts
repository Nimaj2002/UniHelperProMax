/**
 * 014 R13: a growing answer split into its top-level Markdown blocks at blank lines outside code
 * fences. Finished blocks keep their exact text while more text arrives, so each is rendered once
 * (memoised by its text) and only the last block re-renders while streaming. A fence still open
 * at the end is closed for display only.
 */

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  const push = () => {
    if (current.length) blocks.push(current.join("\n"));
    current = [];
  };
  for (const line of text.split("\n")) {
    const m = FENCE.exec(line);
    if (fence) {
      current.push(line);
      // a closing fence: the same character, at least as long, nothing after it
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      current.push(line);
      continue;
    }
    if (line.trim() === "") push();
    else current.push(line);
  }
  if (fence) {
    // close the open fence so the partial code renders as code, not as running text
    current.push(fence);
  }
  push();
  return blocks;
}
