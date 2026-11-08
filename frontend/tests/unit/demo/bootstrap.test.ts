import { describe, expect, it } from "vitest";
import { ApiError, type Schemas } from "@/lib/api";
import { api, startDemoServer } from "./setup";

startDemoServer();

describe("demo bootstrap", () => {
  it("reports web mode and a signed-in demo student", async () => {
    expect(await api<Schemas["SetupStatus"]>("/setup/status")).toEqual({ needsOwner: false, mode: "web" });
    const me = await api<Schemas["Me"]>("/auth/me");
    expect(me.username).toBe("demo-student");
    expect(me.role).toBe("member");
  });

  it("answers unknown GETs with 404 and unknown writes with demo_unavailable", async () => {
    await expect(api("/nope")).rejects.toMatchObject({ status: 404 });
    const err = await api("/nope", { method: "POST", body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("demo_unavailable");
  });

  it("serves sessions by their encoded key", async () => {
    const list = await api<Schemas["SessionOut"][]>("/sessions", { query: { from: "2026-11-01", to: "2026-11-07" } });
    expect(list.length).toBeGreaterThan(3);
    const one = await api<Schemas["SessionOut"]>(`/sessions/${encodeURIComponent(list[0].key)}`);
    expect(one.key).toBe(list[0].key);
  });
});

describe("demo look", () => {
  it("starts on the Yuii light theme preset", async () => {
    const { presetById } = await import("@/features/settings/themes/presets");
    const prefs = await api<Schemas["Preferences"]>("/preferences");
    const preset = presetById(prefs.theme!);
    expect(preset?.name).toBe("Yuii");
    expect(preset?.base).toBe("light");
  });
});
