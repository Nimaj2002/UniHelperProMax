import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { DemoBanner } from "@/demo/DemoBanner";

describe("DemoBanner (024)", () => {
  afterEach(() => localStorage.clear());

  it("says changes aren't saved and links to the download", async () => {
    const { container } = render(<DemoBanner />);
    const region = screen.getByRole("region", { name: "Demo notice" });
    expect(region).toHaveTextContent("Changes aren't saved");
    const link = screen.getByRole("link", { name: "Download the app" });
    expect(link).toHaveAttribute("href", "https://www.unihelperpromax.tech/#download");
    expect(link).toHaveAttribute("target", "_blank");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("asks before resetting, then clears the app's caches and reloads", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    localStorage.setItem("uh.theme", "{}");
    localStorage.setItem("other", "kept");
    render(<DemoBanner />);

    await userEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    const dialog = screen.getByRole("alertdialog", { name: "Reset the demo?" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(reload).toHaveBeenCalledOnce();
    expect(localStorage.getItem("uh.theme")).toBeNull();
    expect(localStorage.getItem("other")).toBe("kept");
    vi.unstubAllGlobals();
  });
});
