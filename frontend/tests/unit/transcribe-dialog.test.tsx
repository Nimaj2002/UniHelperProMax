import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import type { Recording } from "@/features/recordings/api";
import type { TranscriptionJob } from "@/features/transcription/api";
import { TranscribeButton } from "@/features/transcription/TranscribeButton";
import { json, mockFetch, on, problem, renderWithProviders } from "./test-utils";

const KEY = "L1:2026-10-05";
const recording = {
  id: "r1", sessionKey: KEY, name: "Recording 10:02", fileName: "Recording 10-02.webm", mimeType: "audio/webm",
  status: "complete", startedAt: "2026-10-05T07:02:00Z", durationMs: 60_000, size: 1000, nextSeq: 12,
  active: false, missing: false, version: 2,
} as Recording;

const job = (over: Partial<TranscriptionJob> = {}) =>
  ({
    id: "j1", recordingId: "r1", recordingName: "Recording 10:02", sessionKey: KEY, courseId: "c1", noteId: "n1",
    noteName: "Lecture notes", language: "auto", providerId: "voice-studio", providerName: "Voice Studio",
    status: "queued", partIndex: 0, partCount: 1, progress: null, stageStartedAt: null, errorCategory: null,
    errorMessage: null, settingsRelated: false, cancelRequested: false, fallbackNoteCreated: false, attempts: 1,
    seen: false, appended: null, createdAt: "2026-10-05T08:00:00Z", startedAt: null, finishedAt: null, ...over,
  }) as TranscriptionJob;

function api(opts: { configured?: boolean; notes?: { id: string; name: string }[]; active?: TranscriptionJob | null; history?: TranscriptionJob[]; start?: () => Response } = {}) {
  return mockFetch(
    on("GET", "/api/v1/transcription/status", () =>
      json({ configured: opts.configured ?? true, providerId: "voice-studio", providerName: "Voice Studio", defaultLanguage: "tr" }),
    ),
    on("GET", `/api/v1/sessions/${encodeURIComponent(KEY)}/notes`, () =>
      json((opts.notes ?? []).map((n) => ({ ...n, sessionKey: KEY, fileName: `${n.name}.md`, version: 1, size: 0, createdAt: "", updatedAt: "" }))),
    ),
    on("GET", `/api/v1/sessions/${encodeURIComponent(KEY)}/transcriptions`, () => json(opts.history ?? [])),
    on("GET", "/api/v1/transcriptions/active", () => json(opts.active ?? null)),
    on("POST", "/api/v1/recordings/r1/transcriptions", () => (opts.start ? opts.start() : json(job(), 202))),
  );
}

describe("Transcribe dialog", () => {
  it("lists the session's notes, defaults the language and starts into the chosen note", async () => {
    const user = userEvent.setup();
    const { calls } = api({ notes: [{ id: "n1", name: "Lecture notes" }, { id: "n2", name: "Summary" }] });
    renderWithProviders(<TranscribeButton recording={recording} sessionKey={KEY} />);
    await user.click(await screen.findByRole("button", { name: "Transcribe Recording 10:02" }));
    const dialog = await screen.findByRole("dialog", { name: "Transcribe “Recording 10:02”" });
    expect(dialog).toHaveTextContent("Using Voice Studio");
    expect(await screen.findByRole("radio", { name: "Lecture notes" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "New note…" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Spoken language" })).toHaveTextContent("Turkish");
    expect(await axe(dialog)).toHaveNoViolations();
    await user.click(screen.getByRole("radio", { name: "Summary" }));
    await user.click(screen.getByRole("button", { name: "Transcribe" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const post = calls.find((c) => c.init.method === "POST")!;
    expect(JSON.parse(String(post.init.body))).toEqual({ noteId: "n2", language: "tr" });
  });

  it("asks for a new note name when the session has none, and shows server errors inline", async () => {
    const user = userEvent.setup();
    const { calls } = api({ start: () => problem(409, "name_taken", "A note with this name already exists in this session.") });
    renderWithProviders(<TranscribeButton recording={recording} sessionKey={KEY} />);
    await user.click(await screen.findByRole("button", { name: "Transcribe Recording 10:02" }));
    const name = await screen.findByRole("textbox", { name: "Note name" });
    expect(name).toHaveValue("Transcript");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Transcribe" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(JSON.parse(String(calls.find((c) => c.init.method === "POST")!.init.body))).toEqual({ newNoteName: "Transcript", language: "tr" });
  });

  it("without a provider, explains and links to Settings instead of starting", async () => {
    const user = userEvent.setup();
    api({ configured: false });
    renderWithProviders(<TranscribeButton recording={recording} sessionKey={KEY} />);
    await user.click(await screen.findByRole("button", { name: "Transcribe Recording 10:02" }));
    expect(await screen.findByText("Set up a transcription provider first.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings → Transcription" })).toHaveAttribute("href", "/settings/transcription");
    expect(screen.queryByRole("button", { name: "Transcribe" })).not.toBeInTheDocument();
  });

  it("warns when the recording was already transcribed into the chosen note", async () => {
    const user = userEvent.setup();
    api({ notes: [{ id: "n1", name: "Lecture notes" }], history: [job({ status: "completed", finishedAt: "2026-10-05T09:00:00Z" })] });
    renderWithProviders(<TranscribeButton recording={recording} sessionKey={KEY} />);
    await user.click(await screen.findByRole("button", { name: "Transcribe Recording 10:02" }));
    expect(await screen.findByText(/already transcribed into “Lecture notes” on 5 Oct/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Transcribe again" })).toBeInTheDocument();
  });

  it("is disabled with a reason while another transcription runs or the file is missing", async () => {
    api({ active: job({ recordingId: "other" }) });
    const { unmount } = renderWithProviders(<TranscribeButton recording={recording} sessionKey={KEY} />);
    const button = await screen.findByRole("button", { name: "Transcribe Recording 10:02" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAccessibleDescription("A transcription is already running.");
    unmount();
    api();
    renderWithProviders(<TranscribeButton recording={{ ...recording, missing: true }} sessionKey={KEY} />);
    const missing = await screen.findByRole("button", { name: "Transcribe Recording 10:02" });
    expect(missing).toBeDisabled();
    expect(missing).toHaveAccessibleDescription("The audio file is missing.");
  });
});
