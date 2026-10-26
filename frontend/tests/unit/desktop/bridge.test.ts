import { afterEach, describe, expect, it, vi } from "vitest";
import { desktop, isDesktop } from "@/features/desktop/bridge";

afterEach(() => {
  delete window.uhDesktop;
});

describe("desktop bridge (015)", () => {
  it("is safe to call every function without the desktop app", async () => {
    expect(isDesktop()).toBe(false);
    expect(await desktop.info()).toBeNull();
    expect(await desktop.setPort(50000)).toBeNull();
    expect(await desktop.chooseDataFolder()).toBeNull();
    expect(await desktop.changeDataFolder({ path: "/x", mode: "move" })).toBeNull();
    expect(await desktop.microphone.status()).toBeNull();
    expect(await desktop.microphone.request()).toBeNull();
    await desktop.microphone.markExplained();
    await desktop.openDataFolder();
    await desktop.openLogsFolder();
    desktop.setGuardState({ recording: false, pendingUploads: 0, unsavedNotes: 0, other: 0 });
    desktop.respondToClose("quit");
    const off = [desktop.onCloseRequested(() => {}), desktop.onNavigate(() => {}), desktop.onDataFolderProgress(() => {})];
    off.forEach((fn) => fn());
  });

  it("forwards to window.uhDesktop when present", async () => {
    const setGuardState = vi.fn();
    const info = vi.fn(async () => ({ version: "1.2.3" }));
    window.uhDesktop = { setGuardState, info } as unknown as NonNullable<Window["uhDesktop"]>;
    expect(isDesktop()).toBe(true);
    desktop.setGuardState({ recording: true, pendingUploads: 2, unsavedNotes: 0, other: 0 });
    expect(setGuardState).toHaveBeenCalledWith({ recording: true, pendingUploads: 2, unsavedNotes: 0, other: 0 });
    expect(await desktop.info()).toEqual({ version: "1.2.3" });
  });
});
