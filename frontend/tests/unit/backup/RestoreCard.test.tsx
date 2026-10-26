import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { RestoreCard } from "@/features/settings/backup/RestoreCard";
import { restoreState } from "@/features/settings/backup/restoreState";
import { json, mockFetch, on, renderWithProviders } from "../test-utils";

vi.mock("@/lib/api/upload", () => ({
  uploadFile: vi.fn(async (_path: string, _q: unknown, _file: Blob, onProgress: (l: number, t: number) => void) => {
    onProgress(5, 10);
    return { id: "r-1", kind: "restore", phase: "validating", bytesDone: 0, bytesTotal: null, expiresAt: null };
  }),
}));

const COUNTS = { semesters: 1, courses: 3, sessions: 20, events: 2, notes: 40, recordings: 9, documents: 5, chats: 2, tasks: 4, themes: 1, files: 60, bytes: 1000 };
const SUMMARY = {
  createdAt: "2026-09-01T10:12:00Z", appVersion: "1.0.1", source: "desktop", willUpgrade: false, counts: COUNTS,
  keysLeftOut: [{ kind: "ai_endpoint", id: "e1", name: "My Claude" }], excluded: [],
  current: { counts: { ...COUNTS, notes: 41, files: 62 } }, filesNotInBackup: 2, safetyBackup: { replaces: null },
};
const awaiting = { id: "r-1", kind: "restore", phase: "awaiting_confirmation", bytesDone: 0, bytesTotal: null, expiresAt: null, summary: SUMMARY };

async function chooseFile() {
  const user = userEvent.setup();
  const input = document.getElementById("restore-file") as HTMLInputElement;
  await user.upload(input, new File(["zip"], "backup.zip", { type: "application/zip" }));
  return user;
}

beforeEach(() => restoreState.resetForTests());
afterEach(() => vi.restoreAllMocks());

describe("Settings → Backup & restore: Restore from a backup", () => {
  it("shows the summary, asks for confirmation (Cancel focused) and starts the restore", async () => {
    const { calls } = mockFetch(
      on("GET", "/api/v1/backup/jobs/r-1", () => json(awaiting)),
      on("POST", "/api/v1/backup/restores/r-1/confirm", () => json({ ...awaiting, phase: "safety_backup" }, 202)),
    );
    const { container } = renderWithProviders(<RestoreCard />);
    expect(await axe(container)).toHaveNoViolations();
    const user = await chooseFile();

    const table = await screen.findByRole("table", { name: /What the backup holds/ });
    expect(within(table).getByRole("row", { name: /Notes 40 41/ })).toBeInTheDocument();
    expect(screen.getByText(/enter these again: My Claude/)).toBeInTheDocument();
    expect(screen.getByText(/2 files you have now aren't in the backup and will be removed/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Restore…" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Replace all your data?" });
    expect(dialog).toHaveTextContent("3 courses, 41 notes, 9 recordings, 5 documents");
    expect(dialog).toHaveTextContent("2 files that aren't in the backup will be removed");
    expect(dialog).toHaveTextContent("A safety backup of your current data is made first.");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Replace my data" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith("/confirm"))).toBe(true));
    expect(restoreState.get()).toMatchObject({ jobId: "r-1", local: true });
  });

  it("shows why the server refused to start, and disables Restore…", async () => {
    mockFetch(
      on("GET", "/api/v1/backup/jobs/r-1", () => json(awaiting)),
      on("POST", "/api/v1/backup/restores/r-1/confirm", () =>
        json({ status: 409, code: "restore_blocked", title: "Your data can't be restored right now.", reasons: ["recording_in_progress"], items: [] }, 409, "application/problem+json"),
      ),
    );
    renderWithProviders(<RestoreCard />);
    const user = await chooseFile();
    await user.click(await screen.findByRole("button", { name: "Restore…" }));
    await user.click(await screen.findByRole("button", { name: "Replace my data" }));
    expect(await screen.findByText("Stop the recording first.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore…" })).toBeDisabled();
  });

  it("says nothing was changed when the backup is refused", async () => {
    mockFetch(
      on("GET", "/api/v1/backup/jobs/r-1", () =>
        json({ id: "r-1", kind: "restore", phase: "failed", bytesDone: 0, bytesTotal: null, expiresAt: null,
          error: { code: "backup_too_new", title: "newer", detail: null, appVersion: "9.0.0" } }),
      ),
    );
    renderWithProviders(<RestoreCard />);
    await chooseFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This backup was made with a newer version (9.0.0). Update UniHelperProMax first. Nothing was changed.",
    );
  });
});
