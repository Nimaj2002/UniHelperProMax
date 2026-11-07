import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdateState } from "@/features/desktop/bridge";
import { VersionSettings } from "@/features/settings/version/VersionSettings";

afterEach(() => {
  delete window.uhDesktop;
});

function mount(state: UpdateState) {
  const updates = { state: vi.fn(async () => state), check: vi.fn(async () => {}), download: vi.fn(async () => {}), install: vi.fn(async () => {}) };
  window.uhDesktop = { updates, onUpdateState: () => () => {} } as unknown as NonNullable<Window["uhDesktop"]>;
  render(<MemoryRouter><VersionSettings /></MemoryRouter>);
  return updates;
}

const base: UpdateState = { status: "none", current: "1.0.0", version: null, percent: null, error: null, selfInstall: true };

describe("Settings → Version", () => {
  it("checks for updates", async () => {
    const updates = mount(base);
    expect(await screen.findByText("You have the latest version.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(updates.check).toHaveBeenCalled();
  });

  it("restarts to install a downloaded update", async () => {
    const updates = mount({ ...base, status: "ready", version: "1.1.0" });
    await userEvent.click(await screen.findByRole("button", { name: "Restart and update" }));
    expect(updates.install).toHaveBeenCalled();
  });

  it("offers the release page when the app can't update itself", async () => {
    const updates = mount({ ...base, status: "available", version: "1.1.0", selfInstall: false });
    await userEvent.click(await screen.findByRole("button", { name: "Download from GitHub" }));
    expect(updates.download).toHaveBeenCalled();
  });
});
