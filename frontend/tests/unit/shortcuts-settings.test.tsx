/** 019: Settings → Keyboard shortcuts records, saves, refuses, resolves conflicts, resets and removes. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { ShortcutsSettings } from "@/features/settings/shortcuts/ShortcutsSettings";
import { json, mockFetch, on, problem, renderWithProviders } from "./test-utils";

type Stored = Record<string, unknown>;

/** A preferences endpoint that keeps what is PATCHed; `fail` makes every PATCH fail. */
function api(initial: Stored = {}, { fail = false } = {}) {
  let shortcuts = initial;
  const mock = mockFetch(
    on("GET", "/api/v1/preferences", () => json({ theme: "system", shortcuts })),
    on("PATCH", "/api/v1/preferences", (_u, init) => {
      if (fail) return problem(500, "internal_error");
      shortcuts = JSON.parse(String(init.body)).shortcuts;
      return json({ theme: "system", shortcuts });
    }),
  );
  return { ...mock, stored: () => shortcuts };
}

const slot = (name: RegExp) => screen.findByRole("button", { name });

describe("Settings → Keyboard shortcuts", () => {
  it("records a new key and saves only the change; Esc is recorded; leaving cancels", async () => {
    const user = userEvent.setup();
    const { stored } = api();
    const { container } = renderWithProviders(<ShortcutsSettings />);
    const newNote = await slot(/^Key for New note: Alt \+ N\./);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(newNote);
    expect(screen.getByText("Press the new shortcut.")).toBeInTheDocument();
    await user.keyboard("{Alt>}{Shift>}[KeyM]{/Shift}{/Alt}");
    await waitFor(() => expect(stored()).toEqual({ "workspace.newNote": [{ chord: "Alt+Shift+KeyM", label: "Alt + Shift + M" }, null] }));
    expect(await slot(/^Key for New note: Alt \+ Shift \+ M\./)).toBeInTheDocument();
    expect(within(newNote.closest("li")!).getByText("Changed")).toBeInTheDocument();

    // Esc is a key like any other while recording (spec clarification)
    await user.click(await slot(/^Key for Mute or unmute/));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(stored()["player.mute"]).toEqual([{ chord: "Escape", label: "Esc" }, null]));

    // Tab moves on and leaves the old key
    await user.click(await slot(/^Key for Next tab/));
    await user.tab();
    expect(await slot(/^Key for Next tab: Alt \+ PageDown\./)).toBeInTheDocument();
   }, 20_000); // several recordings in one flow

  it("records Space without the button's own Space click starting a new recording", async () => {
    const user = userEvent.setup();
    const { stored } = api();
    renderWithProviders(<ShortcutsSettings />);
    const button = await slot(/^Alternate key for Reset the view/); // the diagram viewer has no Space
    button.focus();
    await user.keyboard("{Enter}"); // start from the keyboard
    await user.keyboard("[Space]");
    await waitFor(() => expect(stored()["diagram.reset"]).toEqual([{ chord: "Digit0", label: "0" }, { chord: "Space", label: "Space" }]));
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("refuses keys that can't work and keeps waiting", async () => {
    const user = userEvent.setup();
    const { calls } = api();
    renderWithProviders(<ShortcutsSettings />);
    await user.click(await slot(/^Key for New note/));
    await user.keyboard("{Control>}[KeyC]{/Control}");
    expect(screen.getByText("Ctrl + C is used by your browser or system.")).toBeInTheDocument();
    await user.keyboard("[KeyQ]");
    expect(screen.getByText("This command also works while typing, so it needs Alt, Ctrl or Cmd.")).toBeInTheDocument();
    await user.keyboard("{Alt}");
    expect(calls.filter((c) => c.init.method === "PATCH")).toEqual([]);
  });

  it("asks before taking a key from another command: reassign or cancel", async () => {
    const user = userEvent.setup();
    const { stored } = api();
    renderWithProviders(<ShortcutsSettings />);
    await user.click(await slot(/^Key for Close the current tab/));
    await user.keyboard("{Alt>}[KeyN]{/Alt}");
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Alt + N is used by “New note”");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(stored()).toEqual({});

    await user.click(await slot(/^Key for Close the current tab/));
    await user.keyboard("{Alt>}[KeyN]{/Alt}");
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reassign" }));
    await waitFor(() =>
      expect(stored()).toEqual({
        "workspace.newNote": [null, null],
        "workspace.closeTab": [{ chord: "Alt+KeyN", label: "Alt + N" }, null],
      }),
    );
  });

  it("lets two tools share a key", async () => {
    const user = userEvent.setup();
    const { stored } = api();
    renderWithProviders(<ShortcutsSettings />);
    await user.click(await slot(/^Alternate key for Play or pause/));
    await user.keyboard("[KeyC]"); // PDF annotations use C too
    await waitFor(() => expect(stored()).toEqual({ "player.playPause": [{ chord: "Space", label: "Space" }, { chord: "KeyC", label: "C" }] }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a default another command took", async () => {
    api({ "workspace.closeTab": [{ chord: "Alt+KeyN", label: "Alt + N" }, null] });
    renderWithProviders(<ShortcutsSettings />);
    expect(await slot(/^Key for New note: Not set — its default is used by Close the current tab\./)).toBeInTheDocument();
  });

  it("resets one key, resets all after asking, and removes a key", async () => {
    const user = userEvent.setup();
    const { stored } = api({ "workspace.newNote": [{ chord: "Alt+Shift+KeyM", label: "Alt + Shift + M" }, null], "player.mute": [{ chord: "KeyU", label: "U" }, null] });
    renderWithProviders(<ShortcutsSettings />);
    await user.click(await screen.findByRole("button", { name: "More for New note" }));
    await user.click(screen.getByRole("menuitem", { name: "Reset key" }));
    await waitFor(() => expect(stored()).toEqual({ "player.mute": [{ chord: "KeyU", label: "U" }, null] }));

    await user.click(screen.getByRole("button", { name: "Reset all" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Reset all" }));
    await waitFor(() => expect(stored()).toEqual({}));

    await user.click(screen.getByRole("button", { name: "More for Play or pause" }));
    await user.click(screen.getByRole("menuitem", { name: "Remove alternate key" }));
    await waitFor(() => expect(stored()).toEqual({ "player.playPause": [{ chord: "Space", label: "Space" }, null] }));
  });

  it("keeps the last key of a keyboard-only command", async () => {
    const user = userEvent.setup();
    api();
    renderWithProviders(<ShortcutsSettings />);
    await user.click(await screen.findByRole("button", { name: "More for Move up a 15-minute slot (inside the calendar grid)" }));
    expect(screen.getByRole("menuitem", { name: /^Remove key/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("says when a change was not saved and keeps the old key", async () => {
    const user = userEvent.setup();
    api({}, { fail: true });
    renderWithProviders(<ShortcutsSettings />);
    await user.click(await slot(/^Key for New note/));
    await user.keyboard("{Alt>}{Shift>}[KeyM]{/Shift}{/Alt}");
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(await slot(/^Key for New note: Alt \+ N\./)).toBeInTheDocument();
  });
});
