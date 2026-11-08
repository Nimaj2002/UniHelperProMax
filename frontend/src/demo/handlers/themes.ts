/**
 * 024: custom themes (contracts/demo-mode.md §2), mirroring services/theme_service.py. Built-in
 * and preset themes live in the frontend; the store only holds the user's custom ones.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { API, checkIfMatch, json, noContent, notFound, problem, readJson, validation, type Body } from "../http";
import { bump, getStore, newId, nowIso, registerSlice } from "../store";

type Theme = Schemas["Theme"];
let themes: Theme[] = [];

registerSlice({ name: "themes", seed: () => (themes = []) });

const key = (name: string) => name.toLowerCase();
const taken = (name: string, exclude?: string) => themes.some((t) => t.id !== exclude && key(t.name) === key(name));

function cleanName(raw: unknown): string | Response {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (!name) return validation("name", "Enter a name for the theme.", "name_required");
  if (name.length > 60) return validation("name", "Use at most 60 characters.", "name_too_long");
  return name;
}

function nameTaken() {
  const msg = "A theme with this name already exists.";
  return problem(409, "name_taken", msg, undefined, [{ field: "/name", code: "name_taken", message: msg }]);
}

// shortcut: colours are stored as sent (the real API checks every token is #rrggbb); the theme editor only sends valid ones
const colours = (b: Body<"/api/v1/themes/{theme_id}", "put">) => ({ keyColors: b.keyColors, overrides: b.overrides, colors: b.colors, lowContrast: !!b.lowContrast });

export const handlers: HttpHandler[] = [
  http.get(`${API}/themes`, () => json([...themes].sort((a, b) => key(a.name).localeCompare(key(b.name))))),
  http.post(`${API}/themes`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/themes", "post">>(request);
    let name = cleanName(body.name);
    if (name instanceof Response) return name;
    if (taken(name)) {
      if (!body.uniqueName) return nameTaken();
      let n = 2;
      while (taken(`${name.slice(0, 54)} (${n})`)) n++;
      name = `${name.slice(0, 54)} (${n})`;
    }
    const at = nowIso();
    const t: Theme = { id: newId("theme"), name, base: body.base, ...colours(body), version: 1, createdAt: at, updatedAt: at };
    themes.push(t);
    return json(t, 201);
  }),
  http.get(`${API}/themes/:id`, ({ params }) => {
    const t = themes.find((x) => x.id === params.id);
    return t ? json(t) : notFound("Theme");
  }),
  http.put(`${API}/themes/:id`, async ({ request, params }) => {
    const t = themes.find((x) => x.id === params.id);
    if (!t) return notFound("Theme");
    const conflict = checkIfMatch(request, t);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/themes/{theme_id}", "put">>(request);
    const name = cleanName(body.name);
    if (name instanceof Response) return name;
    if (taken(name, t.id)) return nameTaken();
    Object.assign(t, { name, ...colours(body), updatedAt: nowIso() });
    bump(t);
    return json(t);
  }),
  http.delete(`${API}/themes/:id`, ({ request, params }) => {
    const t = themes.find((x) => x.id === params.id);
    if (!t) return notFound("Theme");
    const conflict = checkIfMatch(request, t);
    if (conflict) return conflict;
    const prefs = getStore().preferences;
    if (prefs.theme === t.id) prefs.theme = t.base; // fall back to its base
    themes = themes.filter((x) => x !== t);
    return noContent();
  }),
];
