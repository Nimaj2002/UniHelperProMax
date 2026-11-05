# Quickstart: validate the proxy feature

## Prerequisites

- Backend and frontend dev servers (see `CLAUDE.md`).
- A proxy to test against. Any of:
  - HTTP: `pip install proxy.py && proxy --port 8899` (or any corporate/campus proxy).
  - SOCKS5: `ssh -N -D 1080 user@some-host`.
  - With credentials: `proxy --port 8899 --basic-auth user:secret`.
- One remote provider configured (e.g. an OpenAI-compatible key) and, for the bypass check, one
  local one (e.g. Ollama at `http://localhost:11434/v1` or a local Voice Studio).

## Automated

```bash
cd backend
uv run pytest tests/unit/test_proxy_routing.py tests/contract/test_proxy.py   # focused
uv run pytest                                                                 # full: contract coverage + secret-leak check
cd ../frontend && corepack pnpm test && corepack pnpm typecheck
```

## Manual scenarios (map to spec stories)

1. **Save & test (US1)** — Settings → Proxy: pick HTTP, host `127.0.0.1`, port `8899`, press
   *Test proxy* → "Working" within 15 s. Stop the proxy, test again → "Proxy unreachable".
   With `--basic-auth`, a wrong password → "Proxy rejected the credentials". Save, reload:
   password shows only `••••` + last 4; changing just the port keeps it.
2. **Validation** — port `70000` or host `http://x/y` → inline error, nothing saved.
3. **Transcription (US2)** — Settings → Transcription: switch is disabled before step 1; after
   it, turn *Use proxy* on, save, *Test connection* and transcribe a short recording: the proxy
   log shows a `CONNECT` to the provider host. Stop the proxy and transcribe → job fails with a
   message naming the proxy; recording intact; *Retry* works after restarting the proxy.
4. **AI (US3)** — Settings → AI: turn *Use proxy* on; *Test* a remote endpoint and send a chat
   message → `CONNECT` lines in the proxy log, reply streams. Stop proxy mid-reply → error names
   the proxy, message and partial reply kept.
5. **Local bypass (FR-011a)** — with *Use proxy* on, chat with the local Ollama endpoint / test
   local Voice Studio → works with the proxy stopped; no proxy log lines.
6. **Independence** — AI on, Transcription off: only AI traffic appears in the proxy log.
7. **Delete (FR-006)** — delete the proxy, confirm → page lists "Transcription, AI" as turned
   off; both switches now off and disabled.
8. **Secrets** — `grep -r <password> <data dir>` and server logs → no matches. Backup → manifest
   lists the proxy under keys left out.
9. **UI quality** — repeat steps 1 and 3 keyboard-only in light and dark themes; axe clean.
