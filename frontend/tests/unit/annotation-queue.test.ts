import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { MemoryOpStore, OpQueue, type OpsResponse, type Sender } from "@/features/documents/reader/annotations/opQueue";
import type { AnnotationOp } from "@/features/documents/reader/annotations/types";

const op = (n: number): AnnotationOp => ({
  opId: `op-${String(n).padStart(6, "0")}`, kind: "upsert", baseRev: null,
  annotation: { id: `a${n}`, type: "comment", page: 1, color: "yellow", anchor: [1, 2], text: String(n) },
});
const ok = (ops: AnnotationOp[]): OpsResponse => ({
  notice: null,
  results: ops.map((o) => ({ opId: o.opId, status: "ok" as const, annotation: { ...o.annotation!, rev: 1 } })),
});

describe("annotation op queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stores ops before sending, sends after 500 ms of quiet, removes them after the result", async () => {
    const store = new MemoryOpStore();
    const send = vi.fn<Sender>(async (_id, ops) => ok(ops));
    const q = new OpQueue({ documentId: "d1", store, send });
    const states: string[] = [];
    q.subscribe(() => states.push(q.status));
    await q.enqueue(op(1));
    expect(await store.list("d1")).toHaveLength(1); // persisted before any request
    expect(q.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(499);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledOnce();
    expect(await store.list("d1")).toEqual([]);
    expect(q.status).toBe("saved");
    expect(states).toEqual(["pending", "saving", "saved"]);
  });

  it("flushes at most 2 s after the first change even while changes keep coming", async () => {
    const send = vi.fn<Sender>(async (_id, ops) => ok(ops));
    const q = new OpQueue({ documentId: "d1", store: new MemoryOpStore(), send });
    for (let i = 0; i < 9; i++) {
      await q.enqueue(op(i));
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(send).toHaveBeenCalledOnce(); // at 2 s
    expect(send.mock.calls[0][1]).toHaveLength(8);
  });

  it("on failure shows 'error' and retries with backoff up to 30 s; ops stay stored", async () => {
    const store = new MemoryOpStore();
    let fail = 6;
    const send = vi.fn<Sender>(async (_id, ops) => {
      if (fail-- > 0) throw new TypeError("Failed to fetch");
      return ok(ops);
    });
    const q = new OpQueue({ documentId: "d1", store, send });
    await q.enqueue(op(1));
    await vi.advanceTimersByTimeAsync(500);
    expect(q.status).toBe("error");
    expect(await store.list("d1")).toHaveLength(1);
    const delays: number[] = [];
    let last = Date.now();
    send.mockImplementation(async (_id, ops) => {
      delays.push(Date.now() - last);
      last = Date.now();
      if (fail-- > 0) throw new TypeError("Failed to fetch");
      return ok(ops);
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16000]);
    expect(q.status).toBe("saved");
    expect(await store.list("d1")).toEqual([]);
  });

  it("caps the retry delay at 30 s", async () => {
    const send = vi.fn<Sender>(async () => {
      throw new TypeError("offline");
    });
    const q = new OpQueue({ documentId: "d1", store: new MemoryOpStore(), send });
    await q.enqueue(op(1));
    await vi.advanceTimersByTimeAsync(500 + 1000 + 2000 + 4000 + 8000 + 16000);
    const calls = send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(send.mock.calls.length).toBe(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls.length).toBe(calls + 1);
    q.dispose();
  });

  it("ops of a crashed or reloaded page are sent by the next queue", async () => {
    const store = new MemoryOpStore();
    const first = new OpQueue({ documentId: "d1", store, send: async () => new Promise<OpsResponse>(() => {}) });
    await first.enqueue(op(1));
    await first.enqueue(op(2));
    first.dispose(); // the page went away
    const send = vi.fn<Sender>(async (_id, ops) => ok(ops));
    const results: string[] = [];
    const second = new OpQueue({ documentId: "d1", store, send, onResults: (r) => results.push(...r.map((x) => x.opId)) });
    expect(await second.restore()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledOnce();
    expect(results).toEqual(["op-000001", "op-000002"]);
    await second.enqueue(op(3)); // sequence numbers continue after the restored ones
    expect((await store.list("d1")).map((p) => p.seq)).toEqual([3]);
  });

  it("reports kept_both / kept_changed results and notices", async () => {
    const onResults = vi.fn();
    const onNotice = vi.fn();
    const send: Sender = async (_id, ops) => ({
      notice: "unreadable_file_moved",
      results: [{ opId: ops[0].opId, status: "kept_both", annotation: { ...ops[0].annotation!, rev: 3 }, copy: { ...ops[0].annotation!, id: "copy", rev: 1 } }],
    });
    const q = new OpQueue({ documentId: "d1", store: new MemoryOpStore(), send, onResults, onNotice });
    await q.enqueue(op(1));
    await vi.advanceTimersByTimeAsync(500);
    expect(onResults.mock.calls[0][0][0].status).toBe("kept_both");
    expect(onNotice).toHaveBeenCalledWith("unreadable_file_moved");
  });

  it("drops a batch the server refuses (4xx) instead of retrying forever", async () => {
    const store = new MemoryOpStore();
    const onNotice = vi.fn();
    const send = vi.fn<Sender>(async () => {
      throw new ApiError(413, "too_many_annotations", "Too many");
    });
    const q = new OpQueue({ documentId: "d1", store, send, onNotice });
    await q.enqueue(op(1));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledOnce();
    expect(await store.list("d1")).toEqual([]);
    expect(onNotice).toHaveBeenCalledWith("too_many_annotations");
    expect(q.status).toBe("saved");
  });

  it("flush() sends right away (tab closing); hasPending tells the leave guards", async () => {
    const send = vi.fn<Sender>(async (_id, ops) => ok(ops));
    const q = new OpQueue({ documentId: "d1", store: new MemoryOpStore(), send });
    await q.enqueue(op(1));
    expect(q.hasPending()).toBe(true);
    await q.flush();
    expect(send).toHaveBeenCalledOnce();
    expect(q.hasPending()).toBe(false);
  });

  it("without IndexedDB the queue works in memory and says so", () => {
    const q = new OpQueue({ documentId: "d1", store: new MemoryOpStore(), send: async (_id, ops) => ok(ops) });
    expect(q.persistent).toBe(false);
  });
});
