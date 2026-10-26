# Contract: Packaging, Artifacts and Release

Research R1, R2, R4, R15, R18.

## Artifacts (per tag `vX.Y.Z`)

| File | System | Built on |
|---|---|---|
| `UniHelperProMax-Setup-X.Y.Z-x64.exe` | Windows 10+ x64 (per-user NSIS) | `windows-2022` |
| `UniHelperProMax-X.Y.Z-arm64.dmg` | macOS 13+ Apple Silicon | `macos-14` |
| `UniHelperProMax-X.Y.Z-x64.dmg` | macOS 13+ Intel | `macos-15-intel` |
| `UniHelperProMax-X.Y.Z-x86_64.AppImage` | Linux x64 | `ubuntu-22.04` |
| `unihelperpromax_X.Y.Z_amd64.deb` | Debian/Ubuntu x64 | `ubuntu-22.04` |
| `latest.yml`, `latest-mac.yml`, `latest-linux.yml` | update metadata (unused until auto-update) | each runner |

- The names come from `artifactName` templates and are part of this contract: a future updater
  relies on them.
- Expected sizes: about 100–120 MB for the Electron shell plus the PyInstaller backend,
  measured in Phase B. This is reported, not gated.

## Installed layout

```text
<app>/resources/
├── app.asar                 # desktop/dist (main, preload, startup page)
├── backend/                 # PyInstaller onedir: unihelper-backend[.exe] + _internal/
│   └── _internal/unihelper/db/migrations/{env.py, versions/*.py}
└── frontend/                # frontend/dist (index.html, assets/, pdfium.wasm, fonts)
```

## Version

One version for everything:
- `desktop/package.json` `version`, `backend/pyproject.toml` `version` and the tag `vX.Y.Z` must
  be equal, and CI fails otherwise.
- Settings shows `app.getVersion()`.

## macOS signing (first release)

- Ad-hoc signing (`identity: "-"`), hardened runtime, and entitlements:
  `device.audio-input`, `cs.allow-jit`, `cs.allow-unsigned-executable-memory` and
  `cs.disable-library-validation`.
- `NSMicrophoneUsageDescription` is in Info.plist.
- The backend's Mach-O files are signed in `afterPack`.
- No notarization in this release.

## Uninstall

- **Windows**: the NSIS `customUnInstall` macro shows a message: "Your notes, recordings and
  documents were kept in <data folder>. App settings and the database were kept in <backend
  data>." It removes no user or app data (`deleteAppDataOnUninstall: false`).
- **macOS and Linux**: the README documents the paths and how to remove them by hand (FR-031).

## Release workflow

`.github/workflows/desktop-release.yml`:
- Triggered by `push: tags v*.*.*`, plus `workflow_dispatch` for dry runs.
- One job per runner in the table above, then a `publish` job that creates a **draft** GitHub
  Release with every artifact.
- The steps are in research R18.
- Secrets: only `GITHUB_TOKEN` in this release. Signing secrets are added later without
  workflow restructuring.
