import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestoreHost } from "@/features/settings/backup/RestoreOverlay";
import { restoreState } from "@/features/settings/backup/restoreState";
import { apiFetch } from "@/lib/api";
import { noteDataEpoch, onDataReplaced, resetDataEpochForTests } from "@/lib/api/dataEpoch";
import { json, mockFetch, on } from "../test-utils";

beforeEach(() => {
  resetDataEpochForTests();
  restoreState.resetForTests();
});
afterEach(() => vi.restoreAllMocks());

const withEpoch = (value: string, body: unknown = {}, status = 200) => {
  const r = json(body, status, status >= 400 ? "application/problem+json" : "application/json");
  r.headers.set("X-Data-Epoch", value);
  return r;
};

describe("X-Data-Epoch", () => {
  it("reports a change of the same account's epoch once, not a new sign-in", () => {
    const replaced = vi.fn();
    onDataReplaced(replaced);
    noteDataEpoch("user-a.0");
    noteDataEpoch("user-a.0");
    expect(replaced).not.toHaveBeenCalled();
    noteDataEpoch("user-b.7"); // another account signed in
    expect(replaced).not.toHaveBeenCalled();
    noteDataEpoch("user-b.8");
    expect(replaced).toHaveBeenCalledTimes(1);
    noteDataEpoch("user-b.9");
    expect(replaced).toHaveBeenCalledTimes(1);
  });

  it("is read from every API response", async () => {
    const replaced = vi.fn();
    onDataReplaced(replaced);
    let epoch = 0;
    mockFetch(on("GET", "/api/v1/anything", () => withEpoch(`u.${epoch}`)));
    await apiFetch("/anything");
    epoch = 1;
    await apiFetch("/anything");
    expect(replaced).toHaveBeenCalledTimes(1);
  });

  it("shows the restore overlay on 423 restore_in_progress until the restore ends", async () => {
    let phase = "staging";
    mockFetch(
      on("GET", "/api/v1/settings/transcription", () =>
        withEpoch("u.0", { status: 423, code: "restore_in_progress", title: "Your data is being restored.", jobId: "r-9" }, 423),
      ),
      on("GET", "/api/v1/backup/jobs/r-9", () =>
        json({ id: "r-9", kind: "restore", phase, bytesDone: 1, bytesTotal: 2, expiresAt: null }),
      ),
    );
    render(<RestoreHost />);
    await act(async () => {
      await apiFetch("/settings/transcription").catch(() => undefined);
    });
    expect(await screen.findByRole("alertdialog", { name: /Restoring your data/ })).toBeInTheDocument();
    expect(await screen.findByText("Unpacking the backup…")).toBeInTheDocument();
    phase = "rolled_back";
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(), { timeout: 3000 });
  });
});
