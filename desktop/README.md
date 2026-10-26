# UniHelperProMax desktop app (developer notes)

The desktop app is an Electron window that loads the app from a bundled copy of the backend at
`http://127.0.0.1:<port>`. Design: [specs/015-desktop-app-packaging](../specs/015-desktop-app-packaging/).

The web version is unchanged. `start.sh` / `start.ps1`, Vite, port 8000, login and Docker all
work as before. Do UI work there, where Vite reloads instantly.

## Day to day

| I changed… | To see it in the desktop app |
|---|---|
| backend code | `npm run dev` (restart it) |
| frontend code | `pnpm --dir ../frontend build`, then restart `npm run dev` |
| desktop code (`src/`) | restart `npm run dev` (it compiles first) |

`npm run dev` (in this folder):
- runs the backend **from source** with `backend/.venv`, so there's no PyInstaller step
- uses its own profile in `../data-desktop-dev/` (ignored by git), so it never touches an
  installed app's data
- uses port 47823 by default, so it can run next to an installed copy

The first start can take a while, because Python compiles the backend.

Requirements: run `uv sync` in `backend/` once, and build the frontend once
(`pnpm --dir ../frontend install && pnpm --dir ../frontend build`).

## Building an installer

One command, run on the system you want the installer for:

```bash
scripts/build-desktop.sh              # Linux: AppImage + .deb · macOS: .dmg for this Mac's CPU
scripts/build-desktop.sh --arch x64   # macOS Intel (or arm64)
scripts/build-desktop.sh --unpacked   # just the unpacked app, quicker
```

```powershell
.\scripts\build-desktop.ps1             # Windows: UniHelperProMax-Setup-<version>-x64.exe
.\scripts\build-desktop.ps1 -Unpacked
```

Run these from the repository root. The script builds the frontend, then the standalone backend
(PyInstaller onedir, followed by a smoke test), then the app. Results go to `desktop/release/`.
You need `uv`, `pnpm`, `node` and `npm`.

PyInstaller can't build for another system, so each system's installer must be built on that
system. CI does all of them for you (below).

## Tests

```bash
npm run build:e2e                                            # the test build (release-e2e/)
UNIHELPER_E2E_EXECUTABLE="$(node scripts/e2e-executable.cjs)" npm run e2e
npm run e2e                                                  # or: against `electron .`
```

The test build is the normal app with one Electron fuse flipped (Node's `--inspect`), so that
Playwright can drive it. Installers keep that fuse off. Tests tagged `@microphone` need a
microphone permission, which macOS CI runners can't grant.

## Releasing

1. Set the same version in `desktop/package.json` and `backend/pyproject.toml`.
2. Commit, then tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. `.github/workflows/desktop-release.yml` builds Windows, macOS (Apple Silicon) and Linux,
   runs the e2e tests, and creates a **draft** GitHub Release with the installers.
   Check the draft, then publish it.

"Run workflow" on the Actions tab does a dry run: it builds and tests but makes no release.
Builds are not code-signed yet. macOS builds are ad-hoc signed so they run.

## Where things are

| | |
|---|---|
| `src/main.ts` | app lifecycle, single instance, quit sequence, startup page, fallback ports |
| `src/backend.ts` | starts, verifies, stops and replaces the backend |
| `src/permissions.ts` | microphone only, app origin only |
| `src/closeGuard.ts` | closing never fails silently |
| `src/winJob.ts` | Windows job object (backend dies with the app) |
| `electron-builder.yml` | installers, icons, entitlements, fuses |
| `../backend/packaging/unihelper-backend.spec` | the PyInstaller onedir build (never onefile) |
