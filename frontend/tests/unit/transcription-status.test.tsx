import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { Toaster } from "@/components/ui/sonner";
import type { Recording } from "@/features/recordings/api";
import { ensureSaver, resetSaversForTests } from "@/features/sessions/autosave";
import type { TranscriptionJob } from "@/features/transcription/api";
import { stageLabel } from "@/features/transcription/progress";
import { TranscriptionNotifier } from "@/features/transcription/TranscriptionNotifier";
import { TranscriptionStatus } from "@/features/transcription/TranscriptionStatus";
import { json, mockFetch, on, renderWithProviders } from "./test-utils";

const KEY = "L1:2026-10-05";
const recording = { id: "r1", sessionKey: KEY, name: "Recording 10:02", status: "complete", missing: false } as Recording;
const job = (over: Partial<TranscriptionJob> = {}) =>
  ({
    id: "j1", recordingId: "r1", recordingName: "Recording 10:02", sessionKey: KEY, courseId: "c1", noteId: "n1",
    noteName: "Lecture notes", language: "auto", providerId: "voice-studio", providerName: "Voice Studio",
    status: "queued", partIndex: 0, partCount: 1, progress: null, stageStartedAt: null, errorCategory: null,
    errorMessage: null, settingsRelated: false, cancelRequested: false, fallbackNoteCreated: false, attempts: 1,
    seen: false, appended: null, createdAt: "2026-10-05T08:00:00Z", startedAt: null, finishedAt: null, ...over,
  }) as TranscriptionJob;

afterEach(() => resetSaversForTests());

function api(active: TranscriptionJob | null, history: TranscriptionJob[] = [], extra: Parameters<typeof on>[] = []) {
  return mockFetch(
    on("GET", "/api/v1/transcriptions/active", () => json(active)),
    on("GET", `/api/v1/sessions/${encodeURIComponent(KEY)}/transcriptions`, () => json(history)),
    ...extra.map((args) => on(...args)),
  );
}

describe("stage labels", () => {
  it("names stages, parts and percentages", () => {
    expect(stageLabel(job())).toBe("Queued");
    expect(stageLabel(job({ status: "uploading", progress: 0.42 }))).toBe("Uploading 42 %");
    expect(stageLabel(job({ status: "transcribing", partIndex: 1, partCount: 3 }))).toBe("Transcribing part 2 of 3");
    expect(stageLabel(job({ status: "appending" }))).toBe("Adding to note");
  });
});

describe("TranscriptionStatus", () => {
  it("shows the running stage with progress and cancels", async () => {
    const user = userEvent.setup();
    const running = job({ status: "transcribing", progress: 0.5, stageStartedAt: new Date(Date.now() - 65_000).toISOString() });
    const { calls } = api(running, [], [["POST", "/api/v1/transcriptions/j1/cancel", () => json({ ...running, cancelRequested: true })]]);
    const { container } = renderWithProviders(<TranscriptionStatus recording={recording} sessionKey={KEY} />);
    expect(await screen.findByText("Transcribing")).toBeInTheDocument();
    expect(screen.getByText(/^1:0[5-9]$/)).toBeInTheDocument(); // elapsed in this stage
    const bar = screen.getByRole("progressbar", { name: "Transcription progress" });
    expect(bar).toHaveAttribute("aria-valuetext", "Transcribing");
    expect(screen.getByText("Transcription: Transcribing 50 %")).toBeInTheDocument(); // live region
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith("/cancel"))).toBe(true));
  });

  it("failed: message, Retry, and a Settings link only when settings-related", async () => {
    const user = userEvent.setup();
    const failed = job({ status: "failed", errorCategory: "invalid_credentials", errorMessage: "The provider rejected the credentials.", settingsRelated: true });
    const { calls } = api(null, [failed], [["POST", "/api/v1/transcriptions/j1/retry", () => json({ ...failed, status: "queued" }, 202)]]);
    const { unmount } = renderWithProviders(<TranscriptionStatus recording={recording} sessionKey={KEY} />);
    expect(await screen.findByText("Transcription failed: The provider rejected the credentials.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings → Transcription" })).toHaveAttribute("href", "/settings/transcription");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls.some((c) => c.url.pathname.endsWith("/retry"))).toBe(true));
    unmount();
    api(null, [job({ status: "failed", errorCategory: "unavailable", errorMessage: "Unavailable." })]);
    renderWithProviders(<TranscriptionStatus recording={recording} sessionKey={KEY} />);
    expect(await screen.findByText("Transcription failed: Unavailable.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Settings/ })).not.toBeInTheDocument();
  });

  it("completed: links to the note, with earlier transcriptions behind a disclosure", async () => {
    const user = userEvent.setup();
    api(null, [
      job({ id: "j2", status: "completed", noteName: "Summary", noteId: "n2", finishedAt: "2026-10-06T09:00:00Z" }),
      job({ status: "completed", finishedAt: "2026-10-05T09:00:00Z" }),
    ]);
    renderWithProviders(<TranscriptionStatus recording={recording} sessionKey={KEY} />);
    const link = await screen.findByRole("link", { name: "Summary" });
    expect(link).toHaveAttribute("href", `/courses/c1/sessions/${encodeURIComponent(KEY)}?note=n2`);
    await user.click(screen.getByRole("button", { name: "+1 earlier" }));
    expect(screen.getByRole("link", { name: "Lecture notes" })).toBeInTheDocument();
  });
});

describe("TranscriptionNotifier", () => {
  it("reports a retried job again when it finishes", async () => {
    let active: TranscriptionJob | null = job({ status: "transcribing" });
    let final = job({ status: "failed", errorMessage: "Unavailable." });
    mockFetch(
      on("GET", "/api/v1/transcriptions/active", () => json(active)),
      on("GET", "/api/v1/transcriptions", () => json([])),
      on("GET", "/api/v1/transcriptions/j1", () => json(final)),
      on("POST", "/api/v1/transcriptions/j1/seen", () => new Response(null, { status: 204 })),
      on("GET", `/api/v1/sessions/${encodeURIComponent(KEY)}/transcriptions`, () => json([])),
    );
    const { client } = renderWithProviders(
      <>
        <TranscriptionNotifier />
        <Toaster />
      </>,
    );
    await new Promise((r) => setTimeout(r, 50));
    active = null;
    expect(await screen.findByText("Transcription failed: Unavailable.", undefined, { timeout: 4000 })).toBeInTheDocument();
    final = job({ status: "completed", attempts: 2, finishedAt: "2026-10-05T09:00:00Z" });
    active = job({ status: "transcribing", attempts: 2 });
    client.setQueryData(["transcriptions", "active"], active); // Retry pressed
    await new Promise((r) => setTimeout(r, 50));
    active = null;
    expect(await screen.findByText("Transcript added to “Lecture notes”.", undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it("merges an unseen completed job into the open note, toasts once and acknowledges it", async () => {
    const appended = { text: "\n\n## Transcript — Recording 10:02\n\nHi\n", previousHash: "h1", hash: "h2", version: 2 };
    const saver = ensureSaver("n1", { content: "My notes", version: 1, hash: "h1" }, async () => ({ version: 3, hash: "h3" }));
    const done = job({ status: "completed", appended, finishedAt: "2026-10-05T09:00:00Z" });
    const { calls } = mockFetch(
      on("GET", "/api/v1/transcriptions/active", () => json(null)),
      on("GET", "/api/v1/transcriptions", () => json([done])),
      on("POST", "/api/v1/transcriptions/j1/seen", () => new Response(null, { status: 204 })),
    );
    renderWithProviders(
      <>
        <TranscriptionNotifier />
        <Toaster />
      </>,
    );
    expect(await screen.findByText("Transcript added to “Lecture notes”.")).toBeInTheDocument();
    expect(saver.content).toBe("My notes" + appended.text);
    await waitFor(() => expect(calls.filter((c) => c.url.pathname.endsWith("/seen"))).toHaveLength(1));
  });

  it("reports a job that finished while it was being watched", async () => {
    let active: TranscriptionJob | null = job({ status: "transcribing" });
    mockFetch(
      on("GET", "/api/v1/transcriptions/active", () => json(active)),
      on("GET", "/api/v1/transcriptions", () => json([])),
      on("GET", "/api/v1/transcriptions/j1", () => json(job({ status: "failed", errorMessage: "Quota exceeded." }))),
      on("POST", "/api/v1/transcriptions/j1/seen", () => new Response(null, { status: 204 })),
    );
    renderWithProviders(
      <>
        <TranscriptionNotifier />
        <Toaster />
      </>,
    );
    await new Promise((r) => setTimeout(r, 50));
    active = null;
    expect(await screen.findByText("Transcription failed: Quota exceeded.", undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});
