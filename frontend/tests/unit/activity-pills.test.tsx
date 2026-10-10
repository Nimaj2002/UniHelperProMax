import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActivityPills } from "@/app/shell/ActivityPills";
import { registerActivity } from "@/app/shell/registry";
import { renderWithProviders } from "./test-utils";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

describe("ActivityPills (008 FR-023)", () => {
  it("stacks the running activities in priority order over the main card", () => {
    cleanups.push(
      registerActivity({ id: "t-transcription", priority: 1, component: () => <section aria-label="Transcription">t</section> }),
      registerActivity({ id: "t-recording", priority: 0, component: () => <section aria-label="Recording">r</section> }),
      registerActivity({ id: "t-idle", priority: 2, component: () => null }),
    );
    renderWithProviders(
      <div id="host">
        <ActivityPills />
      </div>,
    );
    const region = screen.getByRole("region", { name: "Activity" });
    expect(region.className).toContain("pointer-events-none");
    expect(region.className).toContain("absolute");
    const pills = [...region.querySelectorAll("section")].map((s) => s.getAttribute("aria-label"));
    expect(pills).toEqual(["Recording", "Transcription"]);
  });
});
