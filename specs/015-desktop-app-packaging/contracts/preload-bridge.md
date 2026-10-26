# Contract: Desktop Bridge (preload ↔ renderer ↔ main)

The preload script exposes one frozen object, `window.uhDesktop`, through
`contextBridge.exposeInMainWorld`.
- In the web build it is `undefined`. `frontend/src/features/desktop/bridge.ts` wraps it, and
  every call becomes a no-op or `null` when it is absent.
- The bridge exposes no file system or database access (Principle III).
- Every request from the renderer to main carries plain JSON. Main validates the shapes and
  ignores calls from any `webContents` other than the main window's.

## Renderer → main

| Call | Payload → result | Notes |
|---|---|---|
| `info()` | → `{version, platform: "win32"\|"darwin"\|"linux", arch, port, dataFolder, logsFolder, backendDataFolder}` | Settings → Desktop section, FR-007, FR-028 |
| `setGuardState(s)` | `{recording: bool, pendingUploads: int, unsavedNotes: int, other: int}` → void | Sent on every change; main stores it and writes `lastGuardState` to `desktop.json` |
| `respondToClose(decision)` | `"quit" \| "stay"` → void | Answer to `close-requested` within 3 s |
| `setPort(port)` | `int 1024–65535` → `{ok: true}` or `{ok:false, reason: "pending_work"\|"in_use"\|"invalid"}` | On ok, main saves and relaunches (FR-021–FR-023) |
| `chooseDataFolder()` | → `{path} \| null` | Native folder picker |
| `changeDataFolder(req)` | `{path, mode: "move"\|"use"}` → progress events, then `{ok}` or `{ok:false, reason}` | Main runs the backend data-folder endpoints and the restart (contracts/backend-desktop-mode.md §5) |
| `openDataFolder()`, `openLogsFolder()` | → void | `shell.openPath` |
| `revealPath(path)` | → void | 016: `shell.showItemInFolder`, only for an existing file under `<backend data>/backups/safety/`; anything else is ignored |
| `microphone.status()` | → `"granted"\|"denied"\|"restricted"\|"not-determined"\|"unknown"` | macOS/Windows via `systemPreferences.getMediaAccessStatus`; Linux `unknown` |
| `microphone.request()` | → `"granted"\|"denied"\|"unknown"` | macOS `askForMediaAccess`; elsewhere returns status |
| `microphone.markExplained()` | → void | `desktop.json` `micExplained = true` (FR-042) |

## Main → renderer (events)

The renderer subscribes with `uhDesktop.onCloseRequested(fn)`, `onNavigate(fn)` and
`onDataFolderProgress(fn)`; each returns an unsubscribe function. (IPC channel names are
`uh:close.requested`, `uh:navigate` and `uh:dataFolder.progress`.)

| Event | Payload | Renderer behaviour |
|---|---|---|
| `close-requested` | `{reason: "window"\|"quit"\|"relaunch"}` | `DesktopCloseGuard` shows the dialog (contracts/ui-contract.md) or answers `quit` at once |
| `navigate` | `{path}` (same origin, path + query + hash) | `router.navigate(path)` (internal `target=_blank` links) |
| `data-folder-progress` | `{state, copiedBytes, totalBytes}` | Settings progress bar |

## Close protocol timing

1. Main sends `close-requested`.
2. If no `respondToClose` arrives within **3 s**, main shows its native "not responding"
   dialog (research R12).
3. After `quit`, main sets `quitConfirmed`. Any `will-prevent-unload` that follows is
   overridden with `preventDefault()`.
4. `stay` cancels the close, and nothing else happens. The user saw the dialog, so the close
   was never refused silently.
