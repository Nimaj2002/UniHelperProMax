/**
 * Diagram colours from the app's theme tokens (research R8, FR-028). `themeKey` changes whenever
 * the theme on <html> changes (light/dark switch, custom theme colours), so drawings can be redone.
 */
import { useSyncExternalStore } from "react";
import { hashString } from "./katexLoader";

export type ThemeVariables = Record<string, string | boolean>;

const TOKENS = [
  "--editor-surface",
  "--surface-elevated",
  "--surface-sunken",
  "--text-primary",
  "--text-muted",
  "--border",
  "--divider",
  "--accent",
  "--accent-foreground",
  "--danger",
  "--success",
  "--warning",
] as const;

type Tokens = Record<(typeof TOKENS)[number], string>;

function readTokens(root: HTMLElement): Tokens {
  const style = getComputedStyle(root);
  return Object.fromEntries(TOKENS.map((t) => [t, style.getPropertyValue(t).trim()])) as Tokens;
}

/** Mermaid `base` theme variables for a set of tokens. */
export function mermaidVariables(t: Tokens, dark: boolean): ThemeVariables {
  const bg = t["--editor-surface"];
  const text = t["--text-primary"];
  const muted = t["--text-muted"] || text;
  const node = t["--surface-sunken"] || bg;
  const accent = t["--accent"] || muted;
  const line = t["--border"] || muted;
  return {
    darkMode: dark,
    background: bg,
    fontFamily: '"Geist Variable", ui-sans-serif, system-ui, sans-serif',
    fontSize: "14px",
    primaryColor: node,
    primaryTextColor: text,
    primaryBorderColor: accent,
    secondaryColor: t["--surface-elevated"] || bg,
    secondaryTextColor: text,
    secondaryBorderColor: line,
    tertiaryColor: bg,
    tertiaryTextColor: text,
    tertiaryBorderColor: line,
    lineColor: line,
    textColor: text,
    mainBkg: node,
    nodeBorder: accent,
    nodeTextColor: text,
    clusterBkg: t["--surface-elevated"] || bg,
    clusterBorder: line,
    titleColor: text,
    edgeLabelBackground: bg,
    noteBkgColor: t["--surface-elevated"] || bg,
    noteTextColor: text,
    noteBorderColor: line,
    actorBkg: node,
    actorBorder: accent,
    actorTextColor: text,
    actorLineColor: line,
    signalColor: text,
    signalTextColor: text,
    labelBoxBkgColor: node,
    labelBoxBorderColor: accent,
    labelTextColor: text,
    loopTextColor: text,
    activationBkgColor: t["--surface-elevated"] || bg,
    activationBorderColor: line,
    sectionBkgColor: node,
    altSectionBkgColor: bg,
    taskBkgColor: node,
    taskBorderColor: accent,
    taskTextColor: text,
    taskTextOutsideColor: text,
    taskTextLightColor: text,
    taskTextDarkColor: text,
    activeTaskBkgColor: t["--surface-elevated"] || bg,
    activeTaskBorderColor: accent,
    doneTaskBkgColor: t["--divider"] || node,
    doneTaskBorderColor: line,
    critBorderColor: t["--danger"] || accent,
    critBkgColor: node,
    gridColor: t["--divider"] || line,
    todayLineColor: t["--danger"] || accent,
    errorBkgColor: bg,
    errorTextColor: t["--danger"] || text,
  };
}

export interface ThemeSnapshot {
  variables: ThemeVariables;
  key: string;
  dark: boolean;
}

let snapshot: ThemeSnapshot | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function compute(): ThemeSnapshot {
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark";
  const variables = mermaidVariables(readTokens(root), dark);
  return { variables, dark, key: String(hashString(JSON.stringify(variables))) };
}

function current(): ThemeSnapshot {
  snapshot ??= compute();
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      const next = compute();
      if (next.key === snapshot?.key) return;
      snapshot = next;
      listeners.forEach((l) => l());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/** The current diagram theme; re-renders when the app theme changes (FR-030). */
export function useDiagramTheme(): ThemeSnapshot {
  return useSyncExternalStore(subscribe, current);
}

/** The white of "Light, white background" export (a token, the same in every theme). */
export function exportWhite(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--diagram-export-background").trim();
}

/** The light theme's variables, for "Light, white background" export (FR-043). */
export function lightVariables(): ThemeVariables {
  const probe = document.createElement("div");
  probe.dataset.theme = "light";
  probe.style.display = "none";
  document.body.append(probe);
  const vars = mermaidVariables(readTokens(probe), false);
  probe.remove();
  const paper = exportWhite();
  return { ...vars, background: paper, tertiaryColor: paper, edgeLabelBackground: paper };
}
