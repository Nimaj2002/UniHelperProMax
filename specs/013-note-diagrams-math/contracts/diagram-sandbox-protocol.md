# Contract: Diagram Renderer Frame Protocol

The editor (parent) and the sandboxed renderer frame (`diagram-sandbox.html`, opaque origin)
exchange messages with `postMessage`. Because the frame has an opaque origin, the parent sends
messages with `targetOrigin "*"`. Messages are checked on `event.source === frame.contentWindow`,
not on origin. Every message has a `v: 1` field.

## Parent → frame

```ts
type Render = {
  v: 1; type: "render"; id: string;            // id = cache key
  source: string;                               // ≤ 50 000 chars (longer sources are never sent)
  mode: "safe";                                 // always "safe" in this frame
  themeVariables: Record<string, string>;       // from the app's tokens (research R8)
  useOwnTheme: boolean;                         // false → theme settings removed before rendering
  background: string;                           // CSS colour; "#ffffff" for "Light, white background" export
  reducedMotion: boolean;
};
type Cancel = { v: 1; type: "cancel"; id: string };
```

## Frame → parent

```ts
type Ready    = { v: 1; type: "ready" };
type Rendered = { v: 1; type: "rendered"; id: string; svg: string; width: number; height: number; title?: string; description?: string };
type Failed   = { v: 1; type: "failed"; id: string; message: string; line?: number };
```

## Rules

- In safe mode, the frame always calls `mermaid.initialize` with `securityLevel: "strict"`,
  `htmlLabels: false`, `startOnLoad: false`, and
  `secure: ["securityLevel","startOnLoad","secure","dompurifyConfig","htmlLabels","maxTextSize"]`.
  Unsafe settings in the source therefore have no effect.
- The parent runs `svg` through DOMPurify (SVG profile; `foreignObject` and all `on*` attributes
  removed; `href`/`xlink:href` removed unless it starts with `#`) before inserting it.
- If no reply arrives **within 5 000 ms**, the parent removes the frame, marks the item
  `timedOut`, and creates a new frame for the requests still waiting.
- Requests are handled one at a time, in the order they were sent. A `cancel` for a request that
  hasn't started yet removes it from the queue.
- The frame page's CSP: `default-src 'none'; script-src 'self'; style-src 'unsafe-inline';
  img-src data:; font-src 'self'`, as a `<meta>` tag (dev) and as the response header with
  `base-uri 'none'; frame-ancestors 'self'` added (backend). It has no network access.
- Both pages load one classic script, `/sandbox/diagram-renderer.js` (built by
  `pnpm build:sandbox`). The page's `<html data-mode>` (`safe` or `allowed`) chooses the behaviour.
- DOMPurify is loaded by the editor with the first diagram. It removes `foreignObject`,
  `script`, `iframe`, `image` and `a` elements (keeping their text), every `on*` attribute, and
  any `href` that doesn't start with `#`.

## Allowed frame (`diagram-sandbox-allowed.html`)

- Used only for a diagram whose decision is `unsafe: "allow"`. It has
  `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` and **one frame per
  diagram, shown visibly**.
- Messages from the parent: `{v:1, type:"show", source, themeVariables, useOwnTheme, background,
  reducedMotion}`. Messages from the frame: `{v:1, type:"size", width, height}` and `failed`.
- Mermaid is initialised with the source's own settings (`secure: []`), so every directive
  applies.
- Header CSP for this route (sent by the backend): `default-src 'none'; script-src 'self'
  'unsafe-inline'; style-src 'unsafe-inline' https:; img-src data: https:; font-src 'self'
  https:; connect-src https:; base-uri 'none'; frame-ancestors 'self'`.
- The 5 s time limit applies to the first `size` message.
