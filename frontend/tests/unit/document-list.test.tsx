/** 017: the session's Documents list — what a PDF's menu offers depends on the session that owns it. */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Document } from "@/features/documents/api";
import { DocumentList } from "@/features/documents/DocumentList";
import { json, mockFetch, on, renderWithProviders, type Handler } from "./test-utils";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const MONDAY = "L:2026-09-28";
const FRIDAY = "L:2026-10-02";

const doc = (over: Partial<Document> = {}): Document => ({
  id: "d1", sessionKey: MONDAY, name: "Week 1 slides", fileName: "Week 1 slides.pdf", originalFileName: "slides.pdf",
  size: 1000, encrypted: false, pageCount: 3, uploadedAt: "2026-09-28T10:00:00Z", annotationCount: 0, missing: false, version: 1, ...over,
});

function setup(sessionKey: string, docs: Document[], ...extra: Handler[]) {
  return setupWith(sessionKey, docs, [], ...extra);
}

function setupWith(sessionKey: string, docs: Document[], hiddenDocs: Document[], ...extra: Handler[]) {
  let listed = docs;
  let hidden = hiddenDocs;
  const session = `/api/v1/sessions/${encodeURIComponent(sessionKey)}`;
  const base = `${session}/documents`;
  const fetch = mockFetch(
    ...extra,
    on("GET", session, () => json({ key: sessionKey, kind: "class", courseId: "c1" })),
    on("GET", base, () => json(listed)),
    on("GET", `${base}/hidden`, () => json(hidden)),
    on("PUT", /\/documents\/[^/]+\/hidden$/, () => {
      [listed, hidden] = [[], [...hidden, ...listed]];
      return new Response(null, { status: 204 });
    }),
    on("DELETE", /\/documents\/[^/]+\/hidden$/, () => {
      [listed, hidden] = [[...listed, ...hidden], []];
      return new Response(null, { status: 204 });
    }),
  );
  const openDocument = vi.fn();
  const closeDocument = vi.fn();
  const utils = renderWithProviders(<DocumentList sessionKey={sessionKey} openDocument={openDocument} closeDocument={closeDocument} />);
  return { ...utils, fetch, openDocument, closeDocument };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("DocumentList in a session that doesn't own the PDF (US1)", () => {
  it("offers only “Remove from this and later sessions”", async () => {
    const user = userEvent.setup();
    const { container } = setup(FRIDAY, [doc()]);
    expect(await screen.findByText("Week 1 slides")).toBeVisible();
    expect(screen.getByText(/from/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Actions for Week 1 slides" }));
    expect(screen.getByRole("menuitem", { name: "Remove from this and later sessions" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("hides it here, closes its tab and confirms", async () => {
    const user = userEvent.setup();
    const { fetch, closeDocument } = setup(FRIDAY, [doc()]);
    await user.click(await screen.findByRole("button", { name: "Actions for Week 1 slides" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from this and later sessions" }));
    await waitFor(() => expect(closeDocument).toHaveBeenCalledWith("d1"));
    const put = fetch.calls.find((c) => c.init.method === "PUT");
    expect(put?.url.pathname).toBe(`/api/v1/sessions/${encodeURIComponent(FRIDAY)}/documents/d1/hidden`);
    expect(toastMock.success.mock.calls[0]?.[0]).toBe("Removed “Week 1 slides” from this and later sessions.");
    await waitFor(() => expect(screen.queryByText("Week 1 slides")).toBeNull());
  });
});

describe("DocumentList in the session that owns the PDF (US2)", () => {
  it("offers Rename and Delete, and sends the session with each", async () => {
    const user = userEvent.setup();
    const { fetch } = setup(
      MONDAY,
      [doc()],
      on("PATCH", "/api/v1/documents/d1", () => json(doc({ name: "Week 1", version: 2 }))),
      on("DELETE", "/api/v1/documents/d1", () => new Response(null, { status: 204 })),
    );
    await user.click(await screen.findByRole("button", { name: "Actions for Week 1 slides" }));
    expect(screen.queryByRole("menuitem", { name: "Remove from this and later sessions" })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const field = screen.getByLabelText("Document name");
    await user.clear(field);
    await user.type(field, "Week 1");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(fetch.calls.some((c) => c.init.method === "PATCH")).toBe(true));
    const patch = fetch.calls.find((c) => c.init.method === "PATCH");
    expect(patch?.url.searchParams.get("fromSession")).toBe(MONDAY);

    await user.click(await screen.findByRole("button", { name: /Actions for/ }));
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("It is also listed in the course's other sessions and will disappear from all of them.");
    await user.click(screen.getByRole("button", { name: "Delete document" }));
    await waitFor(() => expect(fetch.calls.some((c) => c.init.method === "DELETE")).toBe(true));
    const del = fetch.calls.find((c) => c.init.method === "DELETE");
    expect(del?.url.searchParams.get("fromSession")).toBe(MONDAY);
  });
});

describe("bringing a removed PDF back (US3)", () => {
  it("shows nothing when no PDF was removed here", async () => {
    setup(FRIDAY, [doc()]);
    await screen.findByText("Week 1 slides");
    expect(screen.queryByRole("button", { name: /Removed from this session/ })).toBeNull();
  });

  it("lists removed PDFs by keyboard and shows one again", async () => {
    const user = userEvent.setup();
    const { container, fetch } = setupWith(FRIDAY, [], [doc()]);
    const toggle = await screen.findByRole("button", { name: "Removed from this session (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Show again: Week 1 slides" }));
    await waitFor(() => expect(fetch.calls.some((c) => c.init.method === "DELETE")).toBe(true));
    expect(fetch.calls.find((c) => c.init.method === "DELETE")?.url.pathname).toBe(
      `/api/v1/sessions/${encodeURIComponent(FRIDAY)}/documents/d1/hidden`,
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: /Removed from this session/ })).toBeNull());
    expect(await screen.findByRole("button", { name: "Actions for Week 1 slides" })).toBeVisible();
  });

  it("Undo in the confirmation shows the PDF again", async () => {
    const user = userEvent.setup();
    const { fetch } = setup(FRIDAY, [doc()]);
    await user.click(await screen.findByRole("button", { name: "Actions for Week 1 slides" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove from this and later sessions" }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    const options = toastMock.success.mock.calls[0]?.[1] as { action: { label: string; onClick: () => void } };
    expect(options.action.label).toBe("Undo");
    options.action.onClick();
    await waitFor(() => expect(fetch.calls.some((c) => c.init.method === "DELETE")).toBe(true));
  });
});
