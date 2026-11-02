import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { nameFromText } from "@/features/home/generalNotesApi";
import { GeneralNotesSection } from "@/features/home/GeneralNotesSection";
import { PanelRail } from "@/features/home/PanelRail";
import { resetSaversForTests } from "@/features/sessions/autosave";
import {
  json,
  mockFetch,
  on,
  renderWithProviders,
  type Handler,
} from "./test-utils";

// the real editor is covered by the diagram-math tests; a textarea keeps these about the pop-up
vi.mock("@/features/sessions/editor/MarkdownEditor", () => ({
  MarkdownEditor: forwardRef<
    unknown,
    {
      noteId: string;
      initialContent: string;
      label: string;
      onChange: (id: string, t: string) => void;
    }
  >(function FakeEditor({ noteId, initialContent, label, onChange }, _ref) {
    return (
      <textarea
        aria-label={label}
        defaultValue={initialContent}
        onChange={(e) => onChange(noteId, e.target.value)}
      />
    );
  }),
}));
const toastMock = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
);
vi.mock("sonner", () => ({ toast: toastMock }));

afterEach(() => {
  resetSaversForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const AUTO = "General note 2026-10-29 14-05";
const note = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  sessionKey: null,
  name: AUTO,
  fileName: `${AUTO}.md`,
  version: 1,
  size: 0,
  createdAt: "2026-10-29T11:05:00+00:00",
  updatedAt: "2026-10-29T11:05:00+00:00",
  content: "",
  hash: "h0",
  missing: false,
  ...over,
});

function setup(list: unknown[], ...extra: Handler[]) {
  const api = mockFetch(
    ...extra,
    on("GET", "/api/v1/general-notes", () => json(list)),
    on("GET", "/api/v1/preferences", () =>
      json({ editorMode: "live", generalNotesCollapsed: false }),
    ),
  );
  const utils = renderWithProviders(<GeneralNotesSection />);
  return { api, user: userEvent.setup(), ...utils };
}

const sent = (
  api: ReturnType<typeof mockFetch>,
  method: string,
  path: string,
) =>
  api.calls.filter(
    (c) => (c.init.method ?? "GET") === method && c.url.pathname === path,
  );

describe("General notes section (018)", () => {
  it("explains what it is for, shows an empty state, and is axe clean", async () => {
    const { container } = setup([]);
    expect(
      screen.getByText(/Lecture notes go in a class session/),
    ).toBeInTheDocument();
    expect(await screen.findByText(/No general notes yet/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("a new note opens in a labelled pop-up, saves before closing and is named from its first line", async () => {
    let created: { name: string } | undefined;
    let renamedTo: unknown;
    const { api, user, baseElement } = setup(
      [],
      on("POST", "/api/v1/general-notes", (_u, init) => {
        created = JSON.parse(String(init.body));
        return json(note({ name: created!.name }), 201);
      }),
      on("GET", "/api/v1/notes/g1", () => json(note({ name: created!.name }))),
      on("PUT", "/api/v1/notes/g1/content", () =>
        json({ version: 2, hash: "h1", size: 9, updatedAt: "" }),
      ),
      on("PATCH", "/api/v1/notes/g1", (_u, init) => {
        renamedTo = JSON.parse(String(init.body));
        return json(note({ name: "Buy milk", version: 3 }));
      }),
    );
    await user.click(screen.getByRole("button", { name: "New general note" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleDescription(/not linked to any class/);
    expect(
      screen.getByText("General note", { selector: "[data-slot=badge]" }),
    ).toBeInTheDocument();
    expect(created?.name).toMatch(
      /^General note \d{4}-\d{2}-\d{2} \d{2}-\d{2}$/,
    );
    await user.type(
      await screen.findByRole("textbox", { name: /general note$/ }),
      "# Buy milk\neggs",
    );
    expect(await axe(baseElement)).toHaveNoViolations();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(sent(api, "PUT", "/api/v1/notes/g1/content")).not.toHaveLength(0);
    expect(renamedTo).toEqual({ name: "Buy milk" });
  });

  it("a new note closed while blank is deleted without asking", async () => {
    const { api, user } = setup(
      [],
      on("POST", "/api/v1/general-notes", () => json(note(), 201)),
      on("GET", "/api/v1/notes/g1", () => json(note())),
      on(
        "DELETE",
        "/api/v1/notes/g1",
        () => new Response(null, { status: 204 }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "New general note" }));
    await screen.findByRole("textbox", { name: /general note$/ });
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(sent(api, "DELETE", "/api/v1/notes/g1")).toHaveLength(1),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("deleting a listed note asks first; keeping it deletes nothing", async () => {
    const existing = note({
      name: "Ideas",
      fileName: "Ideas.md",
      content: "x",
    });
    const { api, user } = setup(
      [existing],
      on("GET", "/api/v1/notes/g1", () => json(existing)),
      on(
        "DELETE",
        "/api/v1/notes/g1",
        () => new Response(null, { status: 204 }),
      ),
    );
    await user.click(await screen.findByRole("button", { name: /Ideas/ }));
    await screen.findByRole("textbox", { name: /general note$/ });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent(
      "General Notes folder",
    );
    await user.click(screen.getByRole("button", { name: "Keep note" }));
    expect(sent(api, "DELETE", "/api/v1/notes/g1")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete note" }));
    await waitFor(() =>
      expect(sent(api, "DELETE", "/api/v1/notes/g1")).toHaveLength(1),
    );
  });
});

describe("Tasks panel rail (018)", () => {
  it("shows an item per section, keeps the task counts, and opens the chosen section", async () => {
    const onOpen = vi.fn();
    const onOpenSection = vi.fn();
    renderWithProviders(
      <PanelRail
        panel="tasks"
        onOpen={onOpen}
        openCount={7}
        overdueCount={2}
        onOpenSection={onOpenSection}
      />,
    );
    const user = userEvent.setup();
    expect(
      screen.getByRole("button", { name: "Show tasks, 7 open, 2 overdue" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("rail-open-count")).toHaveTextContent("7");
    expect(screen.getByTestId("rail-overdue")).toHaveTextContent("2 overdue");
    await user.click(screen.getByRole("button", { name: "General notes" }));
    expect(onOpenSection).toHaveBeenCalledWith("notes");
    await user.click(screen.getByRole("button", { name: "Tasks" }));
    expect(onOpenSection).toHaveBeenCalledWith("tasks");
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("nameFromText", () => {
  it("uses the first non-empty line without heading marks, cut to 60 characters", () => {
    expect(nameFromText("\n\n## Buy milk  \neggs")).toBe("Buy milk");
    expect(nameFromText("   ")).toBe("");
    expect(nameFromText("x".repeat(80))).toHaveLength(60);
  });
});
