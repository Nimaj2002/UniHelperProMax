import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MediaClassGroup, MediaRecording, TrimResult } from "@/features/media-editor/api";
import { RecordingsBrowser } from "@/features/media-editor/RecordingsBrowser";
import { EditorProvider, useEditor } from "@/features/media-editor/session";
import { registerTool, useTools } from "@/features/media-editor/tools";
import { SaveDialog } from "@/features/media-editor/tools/trim/SaveDialog";
import { ApiError } from "@/lib/api";
import { json, mockFetch } from "./test-utils";

const rec = (over: Partial<MediaRecording> = {}): MediaRecording => ({
  id: "r1", name: "Week 3", durationMs: 90_000, version: 1, hasTranscript: false, missing: false, mimeType: "audio/webm", ...over,
});
const TREE: MediaClassGroup[] = [
  {
    id: "c1", name: "CS 201", context: "2026 · Fall",
    sessions: [{ sessionKey: "l1:2026-09-28", title: "Intro", date: "2026-09-28", recordings: [rec(), rec({ id: "r2", name: "Week 4" })] }],
  },
  { id: "c2", name: "MATH 101", context: "2026 · Fall", sessions: [{ sessionKey: "l2:2026-09-29", title: "Limits", date: "2026-09-29", recordings: [rec({ id: "r3", name: "Limits recap" })] }] },
];

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("SaveDialog (025 FR-007–FR-009)", () => {
  const ok = { mode: "new", recording: rec(), recordings: [rec()], transcriptStale: false } as TrimResult;
  it("saves as new with a name, original untouched by default", async () => {
    const onSave = vi.fn().mockResolvedValue(ok);
    render(<SaveDialog recording={rec()} windows={[{ startMs: 0, endMs: 30_000 }]} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByRole("radio", { name: /save as a new recording/i })).toBeChecked();
    expect(screen.getByLabelText("Name")).toHaveValue("Week 3 (trimmed)");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Intro only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save new recording" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: "new", name: "Intro only", combine: "merge" }));
  });
  it("requires a name", () => {
    const onSave = vi.fn();
    render(<SaveDialog recording={rec()} windows={[{ startMs: 0, endMs: 30_000 }]} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save new recording" }));
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
  it("shows the taken-name error from the server", async () => {
    const onSave = vi.fn().mockRejectedValue(new ApiError(409, "name_taken", "Name taken", undefined, [{ field: "/name", code: "name_taken", message: "A recording with this name already exists in this session." }], {}));
    render(<SaveDialog recording={rec()} windows={[{ startMs: 0, endMs: 30_000 }]} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save new recording" }));
    expect(await screen.findByText(/already exists in this session/)).toBeInTheDocument();
  });
  it("overwrite states the consequence and warns about a transcript", async () => {
    const onSave = vi.fn().mockResolvedValue({ ...ok, mode: "overwrite" });
    render(<SaveDialog recording={rec({ hasTranscript: true })} windows={[{ startMs: 0, endMs: 30_000 }]} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /overwrite the original/i }));
    expect(screen.getByText("The original audio will be replaced.")).toBeInTheDocument();
    expect(screen.getByText(/timing will no longer match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Overwrite original" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: "overwrite", name: undefined, combine: "merge" }));
  });
  const two = [{ startMs: 1000, endMs: 5000 }, { startMs: 9000, endMs: 12_000 }];
  it("with several windows asks merged or separate, and only merges can overwrite", async () => {
    const onSave = vi.fn().mockResolvedValue({ ...ok, recordings: [rec(), rec({ id: "r9" })] });
    render(<SaveDialog recording={rec()} windows={two} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByRole("radio", { name: /merge into one recording/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /overwrite the original/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: /each window as its own recording/i }));
    expect(screen.getByRole("radio", { name: /overwrite the original/i })).toBeDisabled();
    expect(screen.getByLabelText("Base name")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Base name"), { target: { value: "Part" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 2 recordings" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: "new", name: "Part", combine: "separate" }));
  });
  it("merged windows can overwrite the original", async () => {
    const onSave = vi.fn().mockResolvedValue({ ...ok, mode: "overwrite" });
    render(<SaveDialog recording={rec()} windows={two} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /overwrite the original/i }));
    fireEvent.click(screen.getByRole("button", { name: "Overwrite original" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ mode: "overwrite", name: undefined, combine: "merge" }));
  });
  it("has no axe violations", async () => {
    const { baseElement } = render(<SaveDialog recording={rec()} windows={[{ startMs: 0, endMs: 30_000 }]} onSave={vi.fn()} onClose={() => {}} />);
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});

describe("RecordingsBrowser (025 US2)", () => {
  const show = (currentId: string | null = null, onPick = vi.fn()) => {
    mockFetch((url) => (url.pathname === "/api/v1/media/recordings" ? json(TREE) : undefined));
    return { onPick, ...withClient(<RecordingsBrowser currentId={currentId} onPick={onPick} />) };
  };
  it("lists classes, then opens down to the audios", async () => {
    const { onPick } = show();
    expect(await screen.findByRole("button", { name: /CS 201/ })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: /CS 201/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Intro/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Week 4/ }));
    expect(onPick).toHaveBeenCalledWith("r2");
  });
  it("opens the current audio's class and session and marks it current", async () => {
    show("r2");
    const current = await screen.findByRole("button", { name: /Week 4/ });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /MATH 101/ })).toHaveAttribute("aria-expanded", "false");
  });
  it("filters by name and says when nothing matches", async () => {
    show();
    await screen.findByRole("button", { name: /CS 201/ });
    fireEvent.change(screen.getByLabelText("Filter recordings by name"), { target: { value: "limits" } });
    expect(await screen.findByRole("button", { name: /Limits recap/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /CS 201/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Filter recordings by name"), { target: { value: "zzz" } });
    expect(screen.getByText("No recordings match.")).toBeInTheDocument();
  });
  it("shows an empty state", async () => {
    mockFetch((url) => (url.pathname === "/api/v1/media/recordings" ? json([]) : undefined));
    withClient(<RecordingsBrowser currentId={null} onPick={() => {}} />);
    expect(await screen.findByText(/No recordings yet/)).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = show("r1");
    await screen.findByRole("button", { name: /Week 3/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("editor guard and tool registry (025 US3)", () => {
  function Probe() {
    const ed = useEditor();
    const tools = useTools();
    return (
      <div>
        <p data-testid="current">{ed.recordingId}</p>
        <p data-testid="tools">{tools.map((t) => t.id).join(",")}</p>
        <button onClick={() => ed.setDirty(true)}>dirty</button>
        <button onClick={() => ed.requestSwitch("r9")}>switch</button>
      </div>
    );
  }
  const mount = () => {
    const router = createMemoryRouter(
      [
        { path: "/media-editor", element: <EditorProvider><Probe /></EditorProvider> },
        { path: "/other", element: <p>other page</p> },
      ],
      { initialEntries: ["/media-editor?recording=r1"] },
    );
    render(<RouterProvider router={router} />);
    return router;
  };
  it("switches straight away when nothing is unsaved", () => {
    mount();
    fireEvent.click(screen.getByText("switch"));
    expect(screen.getByTestId("current")).toHaveTextContent("r9");
  });
  it("asks before switching with unsaved changes, and keeps editing on cancel", () => {
    mount();
    fireEvent.click(screen.getByText("dirty"));
    fireEvent.click(screen.getByText("switch"));
    expect(screen.getByText("Discard your changes?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByTestId("current")).toHaveTextContent("r1");
    fireEvent.click(screen.getByText("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByTestId("current")).toHaveTextContent("r9");
  });
  it("blocks leaving the page with unsaved changes", async () => {
    const router = mount();
    fireEvent.click(screen.getByText("dirty"));
    await act(async () => {
      await router.navigate("/other");
    });
    expect(screen.getByText("Discard your changes?")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/media-editor");
  });
  it("a second tool appears without changing the layout", () => {
    mount();
    expect(screen.getByTestId("tools")).not.toHaveTextContent("dummy");
    act(() => registerTool({ id: "dummy", title: "Dummy", icon: (() => null) as never, component: () => null, priority: 9 }));
    expect(screen.getByTestId("tools")).toHaveTextContent("dummy");
  });
});
