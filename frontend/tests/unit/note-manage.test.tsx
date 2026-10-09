import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { DeleteNoteDialog } from "@/features/sessions/NoteDialogs";
import { NoteList } from "@/features/sessions/NoteList";
import { WorkspaceTabs } from "@/features/sessions/WorkspaceTabs";
import type { TabRef } from "@/features/sessions/tabState";
import type { NoteMeta } from "@/features/sessions/api";

const note = (id: string, name: string): NoteMeta => ({
  id, sessionKey: "L:2026-10-05", name, fileName: `${name}.md`, version: 1, size: 0, createdAt: "", updatedAt: "",
});
const notes = [note("a", "Lecture notes"), note("b", "Homework 3")];
const tab = (id: string): TabRef => ({ kind: "note", id });

describe("note management", () => {
  it("list marks open notes and offers rename/delete; selecting calls onOpen", async () => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    const { container } = render(
      <NoteList notes={notes} openIds={["a"]} activeId="a" loading={false} onNew={vi.fn()} onOpen={onOpen} onRename={onRename} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Lecture notes (open)" })).toHaveAttribute("aria-current", "true");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Homework 3" }));
    expect(onOpen).toHaveBeenCalledWith("b");
    await user.click(screen.getByRole("button", { name: "Actions for Homework 3" }));
    await user.click(await screen.findByRole("menuitem", { name: "Rename…" }));
    expect(onRename).toHaveBeenCalledWith(notes[1]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("tabs: one per open note, arrow keys move, close button closes", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const state = { tabs: [tab("a"), tab("b")], active: tab("a"), split: null };
    const titleOf = (t: TabRef) => notes.find((n) => n.id === t.id)?.name;
    render(
      <WorkspaceTabs state={state} titleOf={titleOf} splitAvailable={false} onSelect={onSelect} onClose={onClose} onToggleSplit={vi.fn()} onMoveToOtherPane={vi.fn()} />,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /^Lecture notes/ })).toHaveAttribute("aria-selected", "true");
    const user = userEvent.setup();
    screen.getByRole("tab", { name: /^Lecture notes/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenCalledWith(tab("b"));
    await user.keyboard("{Delete}");
    expect(onClose).toHaveBeenCalledWith(tab("a"));
    await user.click(document.querySelector<HTMLElement>("[data-close-tab='b']")!);
    expect(onClose).toHaveBeenCalledWith(tab("b"));
    expect(onSelect).toHaveBeenCalledTimes(1); // clicking × does not select the tab
  });

  it("delete confirmation names the file and does nothing until confirmed", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<DeleteNoteDialog name="Homework 3" fileName="Homework 3.md" pending={false} onConfirm={onConfirm} onClose={onClose} />);
    expect(screen.getByRole("alertdialog", { name: "Delete “Homework 3”?" })).toHaveTextContent("Homework 3.md");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Keep note" }));
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete note" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
