import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ConflictDialog } from "@/features/sessions/ConflictDialog";
import { NoteNameDialog } from "@/features/sessions/NoteDialogs";
import { ApiError } from "@/lib/api";

describe("NoteNameDialog", () => {
  it("validates, shows server duplicate errors and is accessible", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(
      new ApiError(409, "name_taken", "taken", undefined, [
        { field: "/name", code: "name_taken", message: "A note with this name already exists in this session." },
      ]),
    );
    const { baseElement } = render(
      <NoteNameDialog title="New note" description="d" submitLabel="Create note" pending={false} onSubmit={onSubmit} onClose={vi.fn()} />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Create note" }));
    expect(screen.getByText("Enter a name for the note.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Note name"), "  Lecture notes ");
    await user.click(screen.getByRole("button", { name: "Create note" }));
    expect(onSubmit).toHaveBeenCalledWith("Lecture notes");
    expect(await screen.findByText("A note with this name already exists in this session.")).toBeInTheDocument();
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});

describe("ConflictDialog", () => {
  const conflict = { kind: "changed" as const, current: { version: 3, hash: "h", content: "file text" } };

  it("shows both texts, focuses Keep both, and runs each action", async () => {
    const onKeepBoth = vi.fn().mockResolvedValue(undefined);
    const onUseMine = vi.fn().mockResolvedValue(undefined);
    const onUseTheirs = vi.fn();
    const { baseElement } = render(
      <ConflictDialog noteName="Lecture" conflict={conflict} mine="my text" onKeepBoth={onKeepBoth} onUseMine={onUseMine} onUseTheirs={onUseTheirs} />,
    );
    expect(screen.getByRole("dialog", { name: "This note was changed outside the app" })).toBeInTheDocument();
    expect(screen.getByText("my text")).toBeInTheDocument();
    expect(screen.getByText("file text")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep both" })).toHaveFocus());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Use mine" }));
    await user.click(screen.getByRole("button", { name: "Use the file's version" }));
    await user.click(screen.getByRole("button", { name: "Keep both" }));
    expect(onUseMine).toHaveBeenCalledOnce();
    expect(onUseTheirs).toHaveBeenCalledOnce();
    expect(onKeepBoth).toHaveBeenCalledOnce();
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it("explains a missing file", () => {
    render(
      <ConflictDialog
        noteName="N"
        conflict={{ kind: "missing", current: { version: 2, hash: "", content: null } }}
        mine="x"
        onKeepBoth={vi.fn()}
        onUseMine={vi.fn()}
        onUseTheirs={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Save my text to the file" })).toBeInTheDocument();
    expect(screen.getByText("(no file)")).toBeInTheDocument();
  });
});
