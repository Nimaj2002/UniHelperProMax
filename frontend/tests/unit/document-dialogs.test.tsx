import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Document } from "@/features/documents/api";
import { DeleteDocumentDialog, deleteText, RenameDocumentDialog, renameProblem } from "@/features/documents/DocumentDialogs";

const doc = (over: Partial<Document> = {}): Document => ({
  id: "d1", sessionKey: "L:2026-10-05", name: "Lecture 5 — Trees", fileName: "Lecture 5 — Trees.pdf", originalFileName: "trees.pdf",
  size: 1000, encrypted: false, pageCount: 3, uploadedAt: "2026-10-05T10:00:00Z", annotationCount: 12, missing: false, version: 1, ...over,
});

describe("document dialogs", () => {
  it("checks a new name while typing", () => {
    expect(renameProblem("  ", [])).toBe("Enter a name.");
    expect(renameProblem("x".repeat(121), [])).toBe("Use at most 120 characters.");
    expect(renameProblem("handout", ["Handout"])).toBe("A document with this name already exists in this session.");
    expect(renameProblem("Trees", ["Handout"])).toBeUndefined();
  });

  it("delete names the annotations that go with the PDF, and every session that lists it", () => {
    const shared = "It is also listed in the course's other sessions and will disappear from all of them.";
    expect(deleteText(doc())).toBe(`The PDF is removed from this session's documents folder. Its 12 annotations are deleted too. ${shared} This can't be undone.`);
    expect(deleteText(doc({ annotationCount: 1 }))).toContain("Its annotation is deleted too.");
    expect(deleteText(doc({ annotationCount: 0 }))).toBe(`The PDF is removed from this session's documents folder. ${shared} This can't be undone.`);
    expect(deleteText(doc({ annotationCount: 0 }), "event")).toContain(
      "It is also listed in the event's other occurrences and will disappear from all of them.",
    );
  });

  it("rename refuses a taken name without a request; delete waits for confirmation", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    const { unmount } = render(<RenameDocumentDialog doc={doc()} others={["Handout"]} onSubmit={onSubmit} onClose={vi.fn()} />);
    const field = screen.getByLabelText("Document name");
    await user.clear(field);
    await user.type(field, "handout");
    expect(screen.getByText("A document with this name already exists in this session.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, "Trees");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(onSubmit).toHaveBeenCalledWith("Trees");
    unmount();

    const onConfirm = vi.fn(async () => undefined);
    const { container } = render(<DeleteDocumentDialog doc={doc()} onConfirm={onConfirm} onClose={vi.fn()} />);
    expect(screen.getByRole("alertdialog", { name: "Delete “Lecture 5 — Trees”?" })).toHaveTextContent("Its 12 annotations are deleted too.");
    await user.click(screen.getByRole("button", { name: "Keep document" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
});
