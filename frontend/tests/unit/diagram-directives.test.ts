import { describe, expect, it } from "vitest";
import {
  classify,
  diagramConfig,
  parseLooseJson,
  stripThemeSettings,
  stripUnsafeSettings,
} from "@/features/sessions/editor/diagram-math/directives";

describe("what a diagram's own settings ask for (data-model table)", () => {
  it.each([
    ['%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\n A-->B', ["securityLevel: loose"]],
    ["%%{init: {'flowchart': {'htmlLabels': true}}}%%\nflowchart LR\n A-->B", ["htmlLabels"]],
    ['%%{init: {"htmlLabels": true}}%%\ngraph TD\n a-->b', ["htmlLabels"]],
    ['%%{init: {"secure": []}}%%\ngraph TD\n a-->b', ["secure"]],
    ['%%{init: {"dompurifyConfig": {}}}%%\ngraph TD\n a-->b', ["dompurifyConfig"]],
    ["flowchart LR\n A-->B\n click A call alert(1)", ["click / link actions"]],
    ['flowchart LR\n A-->B\n click B href "javascript:alert(2)"', ["click / link actions"]],
    ['%%{init: {"themeCSS": "@import url(https://x.invalid/a.css)"}}%%\ngraph TD\n a-->b', ["themeCSS with url()/@import"]],
    ['%%{init: {"securityLevel": "strict"}}%%\ngraph TD\n a-->b', []],
    ["flowchart LR\n A-->B", []],
  ])("unsafe: %s", (source, expected) => {
    expect(classify(source).unsafe).toEqual(expected);
  });

  it.each([
    ['%%{init: {"theme": "forest"}}%%\nflowchart LR\n A-->B', ["theme"]],
    ['%%{init: {"themeVariables": {"primaryColor": "#ff0000"}}}%%\nflowchart LR\n A-->B', ["themeVariables"]],
    ['%%{init: {"darkMode": true}}%%\nflowchart LR\n A-->B', ["darkMode"]],
    ["flowchart LR\n A-->B\n style A fill:#f9f,stroke:#333", ["colours in style / classDef / linkStyle"]],
    ["flowchart LR\n A-->B\n classDef hot color:#f00", ["colours in style / classDef / linkStyle"]],
    ["flowchart LR\n A-->B\n style A stroke-width:4px", []],
    ['---\nconfig:\n  theme: dark\n---\nflowchart LR\n A-->B', ["theme"]],
  ])("theme: %s", (source, expected) => {
    expect(classify(source).theme).toEqual(expected);
  });

  it("follows every other setting", () => {
    const f = classify('---\ntitle: Plan\nconfig:\n  flowchart:\n    curve: linear\n---\nflowchart LR\n A-->B');
    expect(f).toMatchObject({ unsafe: [], theme: [], title: "Plan" });
  });

  it("finds the title and description", () => {
    expect(classify("flowchart LR\n accTitle: Build steps\n accDescr: From commit to deploy\n A-->B")).toMatchObject({
      title: "Build steps",
      description: "From commit to deploy",
    });
    expect(classify("gantt\n  title Semester plan\n  dateFormat YYYY-MM-DD").title).toBe("Semester plan");
  });

  it("parses loose JSON", () => {
    expect(parseLooseJson("{'theme': 'dark', flowchart: {curve: 'basis',},}")).toEqual({ theme: "dark", flowchart: { curve: "basis" } });
    expect(parseLooseJson("{nope")).toBeNull();
  });

  it("removes settings only from the text for the renderer", () => {
    const src = '%%{init: {"theme": "forest", "securityLevel": "loose", "flowchart": {"curve": "linear", "htmlLabels": true}}}%%\nflowchart LR\n A-->B\n style A fill:#f9f\n click A call alert(1)';
    const copy = src;
    const noTheme = stripThemeSettings(src);
    expect(diagramConfig(noTheme)).toEqual({ securityLevel: "loose", flowchart: { curve: "linear", htmlLabels: true } });
    expect(noTheme).not.toContain("fill:#f9f");
    const safe = stripUnsafeSettings(src);
    expect(diagramConfig(safe)).toEqual({ theme: "forest", flowchart: { curve: "linear" } });
    expect(safe).not.toContain("click A");
    expect(src).toBe(copy);
  });
});
