import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { CreateBackupCard } from "@/features/settings/backup/CreateBackupCard";
import { json, mockFetch, on, problem, renderWithProviders } from "../test-utils";

const job = (phase: string, over: Record<string, unknown> = {}) => ({
  id: "job-1", kind: "export", phase, bytesDone: 0, bytesTotal: 100, expiresAt: null, ...over,
});

let clicked: string[] = [];
beforeEach(() => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.getAttribute("href") ?? "");
  });
});
afterEach(() => vi.restoreAllMocks());

describe("Settings → Backup & restore: Create a backup", () => {
  it("creates a backup, shows progress and downloads it through a plain link", async () => {
    const user = userEvent.setup();
    let polls = 0;
    const { calls } = mockFetch(
      on("POST", "/api/v1/backup/exports", () => json(job("preparing"), 202)),
      on("GET", "/api/v1/backup/jobs/job-1", () => {
        polls += 1;
        return polls < 2
          ? json(job("writing", { bytesDone: 40 }))
          : json(job("ready", { bytesDone: 100, fileName: "UniHelperProMax-backup-2026-10-26-1430.zip", size: 4.5 * 1024 ** 3 }));
      }),
    );
    const { container } = renderWithProviders(<CreateBackupCard />);
    expect(screen.getByText(/API keys are not included/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Create backup" }));
    expect(await screen.findByRole("progressbar", { name: "Backup progress" })).toBeInTheDocument();
    expect(await screen.findByText("Your backup is ready (4.5 GB).", {}, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(clicked).toEqual(["/api/v1/backup/exports/job-1/file"]));
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("button", { name: "Download again" }));
    expect(clicked).toHaveLength(2);
    expect(calls.filter((c) => c.url.pathname === "/api/v1/backup/exports")).toHaveLength(1);
  });

  it("cancels a running backup", async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch(
      on("POST", "/api/v1/backup/exports", () => json(job("preparing"), 202)),
      on("GET", "/api/v1/backup/jobs/job-1", () => json(job("writing", { bytesDone: 10 }))),
      on("DELETE", "/api/v1/backup/jobs/job-1", () => new Response(null, { status: 204 })),
    );
    renderWithProviders(<CreateBackupCard />);
    await user.click(screen.getByRole("button", { name: "Create backup" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls.some((c) => c.init.method === "DELETE")).toBe(true));
    expect(await screen.findByRole("button", { name: "Create backup" })).toBeInTheDocument();
  });

  it("explains a failure and offers to try again", async () => {
    const user = userEvent.setup();
    mockFetch(on("POST", "/api/v1/backup/exports", () => problem(507, "insufficient_storage", "There isn't enough free disk space.")));
    renderWithProviders(<CreateBackupCard />);
    await user.click(screen.getByRole("button", { name: "Create backup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There isn't enough free disk space.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
