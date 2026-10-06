import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteSaver, onAppendSuspected, onServerAppend, type SaveFn } from "@/features/sessions/autosave";
import { ApiError } from "@/lib/api";

const T = "\n\n## Transcript — Recording 10:02 · 2026-10-05 10:02 · 3s\n\nHello\n";
const append = { text: T, previousHash: "h1", hash: "h-app", version: 2 };

function conflict(status: 409 | 412, content: string, version = 2, hash = "h-app") {
  return new ApiError(status, status === 412 ? "version_conflict" : "file_changed_on_disk", "x", undefined, [], {
    current: { version, hash, content },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("NoteSaver.applyServerAppend (004 FR-009)", () => {
  it("adds the text when based on the saved state, adopting the new version and hash", async () => {
    const save = vi.fn<SaveFn>();
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, save);
    const seen: string[] = [];
    const off = onServerAppend((id, text) => seen.push(`${id}:${text}`));
    s.applyServerAppend(append);
    off();
    expect(s.content).toBe("My notes" + T);
    expect(s.version).toBe(2);
    expect(s.hash).toBe("h-app");
    expect(s.status).toBe("saved");
    expect(seen).toEqual([`n1:${T}`]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(save).not.toHaveBeenCalled(); // nothing to save: the server already has it
  });

  it("keeps unsaved typing and saves it on top of the transcript", async () => {
    const save = vi.fn<SaveFn>(async () => ({ version: 3, hash: "h3" }));
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, save);
    s.update("My notes + typed");
    s.applyServerAppend(append);
    expect(s.content).toBe("My notes + typed" + T);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledWith("n1", "My notes + typed" + T, 2, "h-app");
    expect(s.status).toBe("saved");
  });

  it("does nothing for an append based on a different state", () => {
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, vi.fn<SaveFn>());
    s.applyServerAppend({ ...append, previousHash: "other" });
    expect(s.content).toBe("My notes");
    expect(s.version).toBe(1);
  });

  it("a save racing the append is resolved without a conflict dialog", async () => {
    const calls: [string, number, string][] = [];
    let first = true;
    const save = vi.fn<SaveFn>(async (_id, text, version, hash) => {
      calls.push([text, version, hash]);
      if (first) {
        first = false;
        throw conflict(409, "My notes" + T); // the server appended while we were saving
      }
      return { version: 3, hash: "h3" };
    });
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, save);
    const suspected: string[] = [];
    const off = onAppendSuspected((id) => suspected.push(id) > 0);
    s.update("My notes!");
    await vi.advanceTimersByTimeAsync(800); // the save hits the appended file first…
    expect(s.status).toBe("saving"); // …and waits instead of opening the conflict dialog
    expect(suspected).toEqual(["n1"]); // transcription is asked to check its jobs now
    await vi.advanceTimersByTimeAsync(1500);
    s.applyServerAppend(append); // …then the job's completion arrives
    await vi.runAllTimersAsync();
    off();
    expect(s.status).toBe("saved");
    expect(s.conflict).toBeNull();
    expect(s.content).toBe("My notes!" + T);
    expect(calls.at(-1)).toEqual(["My notes!" + T, 2, "h-app"]);
  });

  it("an append that arrives before its base was confirmed applies once the save returns", async () => {
    let resolve!: (v: { version: number; hash: string }) => void;
    const save = vi.fn<SaveFn>(() => new Promise((r) => (resolve = r)));
    const s = new NoteSaver("n1", { content: "a", version: 1, hash: "h1" }, save);
    s.update("ab");
    await vi.advanceTimersByTimeAsync(800);
    s.applyServerAppend({ text: T, previousHash: "h2", hash: "h-app", version: 3 }); // based on "ab"
    expect(s.content).toBe("ab");
    resolve({ version: 2, hash: "h2" });
    await vi.runAllTimersAsync();
    expect(s.content).toBe("ab" + T);
    expect(s.version).toBe(3);
    expect(s.status).toBe("saved");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("without a pending transcription for the note, conflicts surface immediately (002)", async () => {
    const save = vi.fn<SaveFn>(async () => {
      throw conflict(409, "My notes and an outside edit", 2, "hx");
    });
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, save);
    const off = onAppendSuspected(() => false);
    s.update("My notes!");
    await vi.advanceTimersByTimeAsync(800);
    off();
    expect(s.status).toBe("conflict");
  });

  it("a conflict already shown is resolved when the explaining append arrives", async () => {
    let n = 0;
    const save = vi.fn<SaveFn>(async () => {
      if (n++ === 0) throw conflict(409, "My notes" + T);
      return { version: 3, hash: "h3" };
    });
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, save);
    s.update("My notes!");
    await vi.advanceTimersByTimeAsync(800 + 4000); // nobody explained it in time
    expect(s.status).toBe("conflict");
    s.applyServerAppend(append);
    await vi.runAllTimersAsync();
    expect(s.status).toBe("saved");
    expect(s.content).toBe("My notes!" + T);
  });

  it("an external append nobody explains still asks the user (after the wait)", async () => {
    const save = vi.fn<SaveFn>(async () => {
      throw conflict(409, "My notes and an outside edit", 2, "hx");
    });
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, save);
    const off = onAppendSuspected(() => true);
    s.update("My notes!");
    await vi.advanceTimersByTimeAsync(800);
    expect(s.status).toBe("saving");
    await vi.advanceTimersByTimeAsync(4000);
    off();
    expect(s.status).toBe("conflict");
  });

  it("any other conflict still asks the user", async () => {
    const save = vi.fn<SaveFn>(async () => {
      throw conflict(409, "someone else's text", 2, "hx");
    });
    const s = new NoteSaver("n1", { content: "My notes", version: 1, hash: "h1" }, save);
    s.update("My notes!");
    await vi.advanceTimersByTimeAsync(800);
    expect(s.status).toBe("conflict");
  });
});
