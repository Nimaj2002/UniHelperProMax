import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { axe } from "vitest-axe";
import { setThemeChoice, ThemeProvider, THEME_CACHE_KEY } from "@/app/theme";
import { ThemeSync } from "@/features/settings/ThemeSync";
import { BUILT_IN, keyColorsOf, resolve } from "@/features/settings/themes/colors";
import { AppearanceSettings } from "@/features/settings/themes/AppearanceSettings";
import { ThemeEditor } from "@/features/settings/themes/ThemeEditor";
import { json, mockFetch, on, renderRoutes } from "./test-utils";

const key = { background: "#0b1020", surface: "#141a2e", text: "#e6e9f2", accent: "#7aa2ff" };
const night = {
  id: "t1", name: "Sabancı Night", base: "dark", keyColors: key, overrides: {}, colors: resolve("dark", key, {}),
  lowContrast: false, version: 1, createdAt: "", updatedAt: "",
};

let prefs: Record<string, unknown>;
beforeEach(() => {
  prefs = { editorMode: "live", theme: "system" };
  localStorage.clear();
  setThemeChoice({ kind: "system" });
});
afterEach(() => {
  document.documentElement.removeAttribute("style");
});

function api(themes: unknown[] = [night], extra: Parameters<typeof on>[] = []) {
  return mockFetch(
    on("GET", "/api/v1/preferences", () => json(prefs)),
    on("PATCH", "/api/v1/preferences", (_u, init) => {
      prefs = { ...prefs, ...JSON.parse(String(init.body)) };
      return json(prefs);
    }),
    on("GET", "/api/v1/themes", () => json(themes)),
    ...extra.map((a) => on(...a)),
  );
}

function renderSettings(path = "/settings/appearance") {
  return renderRoutes(
    [
      {
        path: "*",
        element: (
          <ThemeProvider>
            <ThemeSync />
          </ThemeProvider>
        ),
      },
      { path: "/settings/appearance", element: <ThemeProvider><ThemeSync /><AppearanceSettings /></ThemeProvider> },
      { path: "/settings/appearance/themes/new", element: <ThemeEditor /> },
      { path: "/settings/appearance/themes/:themeId", element: <ThemeEditor /> },
    ],
    path,
  );
}

describe("Appearance", () => {
  it("lists built-in and custom themes and applies a choice at once", async () => {
    const user = userEvent.setup();
    const { calls } = api();
    const { container } = renderSettings();
    expect(await screen.findByRole("radio", { name: /Match system/ })).toBeChecked();
    expect(await screen.findByRole("radio", { name: /Sabancı Night/ })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole("radio", { name: /^Dark/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(JSON.parse(localStorage.getItem(THEME_CACHE_KEY)!)).toEqual({ kind: "dark" });
    expect(calls.some((c) => c.init.method === "PATCH" && JSON.parse(String(c.init.body)).theme === "dark")).toBe(true);

    await user.click(screen.getByRole("radio", { name: /Sabancı Night/ }));
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--surface")).toBe(key.background));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(JSON.parse(localStorage.getItem(THEME_CACHE_KEY)!)).toMatchObject({ kind: "custom", base: "dark" });

    await user.click(screen.getByRole("radio", { name: /^Light/ }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(document.documentElement.style.getPropertyValue("--surface")).toBe(""); // custom colours removed
  });

  it("built-in themes can be duplicated and exported but not edited or deleted", async () => {
    const user = userEvent.setup();
    api();
    renderSettings();
    await user.click(await screen.findByRole("button", { name: "Actions for Light" }));
    expect(screen.getByRole("menuitem", { name: "Duplicate" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Export/ })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("imports a theme file, and rejects a bad one with a clear error", async () => {
    const user = userEvent.setup();
    const { calls } = api([], [["POST", "/api/v1/themes", (_u, init) => json({ ...night, ...JSON.parse(String(init.body)), id: "t9" }, 201)]]);
    renderSettings();
    const input = await screen.findByLabelText("Theme file to import");
    const file = JSON.stringify({ format: "unihelper-theme", version: 1, name: "Shared", base: "dark", keyColors: key, overrides: {}, colors: night.colors });
    await user.upload(input, new File([file], "Shared.uhtheme.json", { type: "application/json" }));
    await waitFor(() => expect(calls.some((c) => c.init.method === "POST")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init.method === "POST")!.init.body));
    expect(body).toMatchObject({ name: "Shared", base: "dark", uniqueName: true, lowContrast: false, colors: night.colors });

    await user.upload(input, new File(["not json"], "x.json", { type: "application/json" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't a theme file");
  });
});

describe("Theme editor", () => {
  it("derives colours from key colours, flags failing pairs, and confirms before saving low contrast", async () => {
    const user = userEvent.setup();
    const { calls } = api([], [["POST", "/api/v1/themes", (_u, init) => json({ ...night, ...JSON.parse(String(init.body)), id: "t2" }, 201)]]);
    const { container } = renderSettings("/settings/appearance/themes/new?name=Mine&from=light");
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Mine");
    expect(screen.getByText("All colour pairs meet WCAG AA.")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    const accent = screen.getByRole("textbox", { name: "Accent" });
    await user.clear(accent);
    await user.type(accent, "#ffd400");
    expect(await screen.findByText(/^Accent on Background — 1\.\d:1, needs 4\.5:1/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Theme preview" }).style.getPropertyValue("--accent")).toBe("#ffd400");

    await user.click(screen.getByRole("button", { name: "Save theme" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Save a low-contrast theme?" });
    expect(confirm).toHaveTextContent("Accent on Background");
    await user.click(screen.getByRole("button", { name: "Save as low contrast" }));
    await waitFor(() => expect(calls.some((c) => c.init.method === "POST")).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.init.method === "POST")!.init.body));
    expect(body).toMatchObject({ name: "Mine", base: "light", lowContrast: true, keyColors: { ...keyColorsOf(BUILT_IN.light), accent: "#ffd400" } });
    expect(Object.keys(body.colors)).toHaveLength(18);
  });

  it("Advanced: overrides are marked, resettable, and kept when a key colour changes", async () => {
    const user = userEvent.setup();
    api();
    renderSettings("/settings/appearance/themes/t1");
    const advanced = await screen.findByRole("switch", { name: /Advanced/ });
    await user.click(advanced);
    expect(screen.queryByRole("group", { name: "Key colours" })).not.toBeInTheDocument();
    const warning = screen.getByRole("textbox", { name: "Warning" });
    await user.clear(warning);
    await user.type(warning, "#123456");
    expect(screen.getByRole("textbox", { name: "Warning" })).toHaveAccessibleDescription("Overridden");

    await user.click(advanced); // back to the 4 key colours
    const background = screen.getByRole("textbox", { name: "Background" });
    await user.clear(background);
    await user.type(background, "#000000");
    expect(screen.getByText("1 colour you set by hand was kept.")).toBeInTheDocument();
    await user.click(advanced);
    expect(screen.getByRole("textbox", { name: "Warning" })).toHaveValue("#123456");
    expect(screen.getByRole("textbox", { name: "Background" })).toHaveValue("#000000");
    await user.click(screen.getByRole("button", { name: "Reset warning" }));
    expect(screen.queryByText("Overridden")).not.toBeInTheDocument();
  });
});
