import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoteSaver, readDraft, type SaveFn } from "@/features/sessions/autosave";
import { ApiError } from "@/lib/api";

function saverWith(save: SaveFn) {
  return new NoteSaver("n1", { content: "", version: 1, hash: "h1" }, save);
}

const ok = (): SaveFn => {
  let v = 1;
  return vi.fn(async () => ({ version: ++v, hash: `h${v}` }));
};

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("NoteSaver", () => {
  it("saves 800 ms after the last keystroke", async () => {
    const save = ok();
    const s = saverWith(save);
    s.update("a");
    expect(s.status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(700);
    s.update("ab");
    await vi.advanceTimersByTimeAsync(700);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledWith("n1", "ab", 1, "h1");
    expect(s.status).toBe("saved");
    expect(s.version).toBe(2);
    expect(s.hash).toBe("h2");
  });

  it("saves at least every 2 s while typing continuously", async () => {
    const save = ok();
    const s = saverWith(save);
    for (let i = 0; i < 6; i++) {
      s.update("x".repeat(i + 1));
      await vi.advanceTimersByTimeAsync(400);
    }
    expect(save).toHaveBeenCalledTimes(1); // fired at the 2 s mark despite continuous typing
  });

  it("keeps one request in flight and saves newer text right after", async () => {
    type R = { version: number; hash: string };
    let resolve!: (v: R) => void;
    const calls: string[] = [];
    const save: SaveFn = vi.fn((_id, content) => {
      calls.push(content);
      return calls.length === 1
        ? new Promise<R>((r) => (resolve = r))
        : Promise.resolve<R>({ version: 3, hash: "h3" });
    });
    const s = saverWith(save);
    s.update("one");
    await vi.advanceTimersByTimeAsync(800);
    s.update("one two");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toEqual(["one"]); // second waits for the first
    resolve({ version: 2, hash: "h2" });
    await vi.runAllTimersAsync();
    expect(calls).toEqual(["one", "one two"]);
    expect((save as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual(["n1", "one two", 2, "h2"]);
    expect(s.status).toBe("saved");
  });

  it("keeps a local draft until the server confirms", async () => {
    let fail = true;
    const save: SaveFn = vi.fn(async () => {
      if (fail) throw new ApiError(0, "network_error", "offline");
      return { version: 2, hash: "h2" };
    });
    const s = saverWith(save);
    s.update("important");
    expect(readDraft("n1")).toMatchObject({ baseVersion: 1, content: "important" });
    await vi.advanceTimersByTimeAsync(800);
    expect(s.status).toBe("error");
    expect(readDraft("n1")?.content).toBe("important");
    fail = false;
    await vi.advanceTimersByTimeAsync(1000); // first retry after 1 s
    expect(s.status).toBe("saved");
    expect(readDraft("n1")).toBeNull();
  });

  it("backs off exponentially while failing", async () => {
    const save: SaveFn = vi.fn(async () => {
      throw new ApiError(503, "unavailable", "down");
    });
    const s = saverWith(save);
    s.update("x");
    await vi.advanceTimersByTimeAsync(800); // 1st attempt
    await vi.advanceTimersByTimeAsync(1000); // 2nd
    await vi.advanceTimersByTimeAsync(2000); // 3rd
    await vi.advanceTimersByTimeAsync(3999);
    expect(save).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1); // 4th after 4 s
    expect(save).toHaveBeenCalledTimes(4);
  });

  it("flush() resolves once idle", async () => {
    const save = ok();
    const s = saverWith(save);
    s.update("now");
    await s.flush();
    expect(save).toHaveBeenCalledOnce();
    expect(s.status).toBe("saved");
  });

  it.each([
    [412, "version_conflict", "version"],
    [409, "file_changed_on_disk", "changed"],
    [409, "file_missing", "missing"],
  ])("stops on %s %s and exposes the current state", async (status, code, kind) => {
    const current = { version: 7, hash: "h7", content: code === "file_missing" ? null : "theirs" };
    const save: SaveFn = vi.fn(async () => {
      throw new ApiError(status, code, code, undefined, [], { current });
    });
    const s = saverWith(save);
    s.update("mine");
    await vi.advanceTimersByTimeAsync(800);
    expect(s.status).toBe("conflict");
    expect(s.conflict).toEqual({ kind, current });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledOnce(); // no automatic retry on conflicts
    expect(readDraft("n1")?.content).toBe("mine");
  });

  it("useMine retries with the other version; useTheirs adopts it", async () => {
    let n = 0;
    const save: SaveFn = vi.fn(async (_id, _c, version) => {
      if (n++ === 0) throw new ApiError(412, "version_conflict", "x", undefined, [], { current: { version: 5, hash: "h5", content: "theirs" } });
      return { version: version + 1, hash: "after" };
    });
    const s = saverWith(save);
    s.update("mine");
    await vi.advanceTimersByTimeAsync(800);
    await s.useMine();
    expect((save as ReturnType<typeof vi.fn>).mock.calls[1]).toEqual(["n1", "mine", 5, "h5"]);
    expect(s.status).toBe("saved");

    const s2 = saverWith(vi.fn(async () => {
      throw new ApiError(409, "file_changed_on_disk", "x", undefined, [], { current: { version: 9, hash: "h9", content: "disk" } });
    }));
    s2.update("local");
    await vi.advanceTimersByTimeAsync(800);
    expect(s2.useTheirs()).toBe("disk");
    expect(s2.status).toBe("saved");
    expect(s2.version).toBe(9);
  });

  it("returning to the saved text cancels the pending save", async () => {
    const save = ok();
    const s = saverWith(save);
    s.update("typo");
    s.update("");
    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
    expect(s.status).toBe("saved");
  });
});
