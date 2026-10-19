/**
 * What a diagram's own settings ask for (data-model "Settings found in a diagram",
 * FR-028a, FR-032). Pure functions: used by the editor and inside the renderer frame.
 * Settings are only ever removed from the text sent to the renderer, never from the note.
 */

export interface DiagramFlags {
  /** Settings that need "Allow" before they take effect. */
  unsafe: string[];
  /** Theme and colour settings that need "Use diagram theme". */
  theme: string[];
  title?: string;
  description?: string;
}

const INIT_RE = /%%\{\s*(?:init|initialize)\s*:([\s\S]*?)\}%%/g;
const FRONT_MATTER_RE = /^\s*---[ \t]*\n([\s\S]*?)\n[ \t]*---[ \t]*(?:\n|$)/;

/** Parses the JSON-ish object of a `%%{init: …}%%` directive (single quotes, bare keys, trailing commas). */
export function parseLooseJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    // fall through to the tolerant form
  }
  try {
    const json = t
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, s: string) => JSON.stringify(s.replace(/\\'/g, "'")))
      .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** A small YAML subset: nested maps of scalars, by indentation (enough for mermaid front matter). */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; obj: Record<string, unknown> }> = [{ indent: -1, obj: root }];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const m = /^(\s*)([^:#]+?)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1].length;
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    const key = m[2].trim().replace(/^["']|["']$/g, "");
    const raw = m[3].trim();
    if (raw === "") {
      const child: Record<string, unknown> = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = scalar(raw);
    }
  }
  return root;
}

function scalar(raw: string): unknown {
  const v = raw.replace(/\s+#.*$/, "");
  if (/^["'].*["']$/.test(v)) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

/** All configuration a diagram gives: front matter `config:` and init directives, merged. */
export function diagramConfig(source: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const fm = FRONT_MATTER_RE.exec(source);
  if (fm) Object.assign(config, (parseSimpleYaml(fm[1]).config as Record<string, unknown>) ?? {});
  for (const m of source.matchAll(INIT_RE)) Object.assign(config, parseLooseJson(m[1]) ?? {});
  return config;
}

const COLOUR_PROPS = /\b(?:fill|stroke|color|background(?:-color)?)\s*:/i;
const STYLE_LINE = /^\s*(?:style|classDef|linkStyle)\b.*$/gim;
const UNSAFE_LINE = /^\s*(?:click|callback|href)\b|^\s*link\s+\S+\s*:|^\s*links\s+\S+\s*:/im;

function truthy(v: unknown) {
  return v === true || v === "true";
}

/** What a diagram source asks for (data model table). */
export function classify(source: string): DiagramFlags {
  const config = diagramConfig(source);
  const unsafe: string[] = [];
  const theme: string[] = [];
  const level = config.securityLevel;
  if (level !== undefined && level !== "strict") unsafe.push(`securityLevel: ${String(level)}`);
  const flowchart = (config.flowchart ?? {}) as Record<string, unknown>;
  if (truthy(config.htmlLabels) || truthy(flowchart.htmlLabels)) unsafe.push("htmlLabels");
  if ("secure" in config) unsafe.push("secure");
  if ("dompurifyConfig" in config) unsafe.push("dompurifyConfig");
  const css = typeof config.themeCSS === "string" ? config.themeCSS : "";
  if (/url\(|@import/i.test(css)) unsafe.push("themeCSS with url()/@import");
  const body = stripConfigText(source);
  if (UNSAFE_LINE.test(body)) unsafe.push("click / link actions");

  for (const key of ["theme", "themeVariables", "themeCSS", "darkMode"]) if (key in config) theme.push(key);
  const styled = [...body.matchAll(STYLE_LINE)].some((m) => COLOUR_PROPS.test(m[0]));
  if (styled) theme.push("colours in style / classDef / linkStyle");

  const fm = FRONT_MATTER_RE.exec(source);
  const fmTitle = fm ? parseSimpleYaml(fm[1]).title : undefined;
  const accTitle = /^\s*accTitle\s*:\s*(.+)$/im.exec(body)?.[1];
  const titleLine = /^\s*title\s+(.+)$/im.exec(body)?.[1];
  const description = /^\s*accDescr\s*:\s*(.+)$/im.exec(body)?.[1] ?? /^\s*accDescr\s*\{([\s\S]*?)\}/im.exec(body)?.[1];
  const title = (typeof fmTitle === "string" ? fmTitle : undefined) ?? accTitle ?? titleLine;
  return { unsafe, theme, title: title?.trim() || undefined, description: description?.trim() || undefined };
}

/** The diagram text without front matter and init directives. */
function stripConfigText(source: string): string {
  return source.replace(FRONT_MATTER_RE, "").replace(INIT_RE, "");
}

const THEME_KEYS = ["theme", "themeVariables", "themeCSS", "darkMode"];
const UNSAFE_KEYS = ["securityLevel", "htmlLabels", "secure", "dompurifyConfig"];

function withoutKeys(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k)) continue;
    if (k === "flowchart" && keys.includes("htmlLabels") && v && typeof v === "object") out[k] = withoutKeys(v as Record<string, unknown>, ["htmlLabels"]);
    else out[k] = v;
  }
  return out;
}

/** Rewrites the config as one init directive with `keys` removed (renderer text only). */
function rebuild(source: string, keys: string[], body: string): string {
  const config = withoutKeys(diagramConfig(source), keys);
  const fm = FRONT_MATTER_RE.exec(source);
  const title = fm ? parseSimpleYaml(fm[1]).title : undefined;
  const head = typeof title === "string" ? `---\ntitle: ${JSON.stringify(title)}\n---\n` : "";
  const init = Object.keys(config).length ? `%%{init: ${JSON.stringify(config)}}%%\n` : "";
  return head + init + body;
}

/** For drawing in the app theme: removes theme/colour settings and colours in style lines. */
export function stripThemeSettings(source: string): string {
  const body = stripConfigText(source).replace(STYLE_LINE, (line) => (COLOUR_PROPS.test(line) ? "" : line));
  return rebuild(source, THEME_KEYS, body);
}

/** For drawing safely: removes unsafe settings and click/link lines. */
export function stripUnsafeSettings(source: string): string {
  const body = stripConfigText(source)
    .split("\n")
    .filter((line) => !UNSAFE_LINE.test(line))
    .join("\n");
  return rebuild(source, UNSAFE_KEYS, body);
}
