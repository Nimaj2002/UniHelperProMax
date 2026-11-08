/** 024: health, setup status, the signed-in demo student and preferences (research R8). */
import { http, type HttpHandler } from "msw";
import { API, json, readJson, type Body } from "../http";
import { getStore } from "../store";

export const handlers: HttpHandler[] = [
  http.get(`${API}/health`, () => json({ status: "ok" })),
  http.get(`${API}/setup/status`, () => json({ needsOwner: false, mode: "web" })),
  http.get(`${API}/auth/me`, () => json(getStore().me)),
  http.patch(`${API}/auth/profile`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/auth/profile", "patch">>(request);
    const s = getStore();
    if (body.timezone) s.me.timezone = body.timezone;
    return json(s.me);
  }),
  http.get(`${API}/preferences`, () => json(getStore().preferences)),
  http.patch(`${API}/preferences`, async ({ request }) => {
    const body = await readJson<Body<"/api/v1/preferences", "patch">>(request);
    const s = getStore();
    s.preferences = { ...s.preferences, ...body };
    return json(s.preferences);
  }),
];
