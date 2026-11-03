/**
 * 015: the desktop app's bridge (specs/015-desktop-app-packaging/contracts/preload-bridge.md).
 * `window.uhDesktop` exists only inside the desktop app; in the web build every call here is a
 * no-op or returns null, so callers never need to branch on the build.
 */

export type DesktopPlatform = "win32" | "darwin" | "linux";

export interface DesktopInfo {
  version: string;
  platform: DesktopPlatform;
  arch: string;
  port: number;
  dataFolder: string | null;
  logsFolder: string;
  backendDataFolder: string;
}

export interface GuardState {
  recording: boolean;
  pendingUploads: number;
  unsavedNotes: number;
  other: number;
}

export type MicStatus = "granted" | "denied" | "restricted" | "not-determined" | "unknown";
export type SetPortResult = { ok: true } | { ok: false; reason: "pending_work" | "in_use" | "invalid" };
export interface DataFolderRequest {
  path: string;
  mode: "move" | "use";
}
export type DataFolderResult = { ok: true } | { ok: false; reason: string };
export interface DataFolderProgress {
  state: string;
  copiedBytes: number;
  totalBytes: number;
}

interface DesktopApi {
  info(): Promise<DesktopInfo | null>;
  setGuardState(state: GuardState): void;
  respondToClose(decision: "quit" | "stay"): void;
  setPort(port: number): Promise<SetPortResult>;
  chooseDataFolder(): Promise<{ path: string } | null>;
  changeDataFolder(req: DataFolderRequest): Promise<DataFolderResult>;
  openDataFolder(): Promise<void>;
  openLogsFolder(): Promise<void>;
  /** 016: show a safety backup in the file manager (only paths under backups/safety). */
  revealPath(path: string): Promise<void>;
  setTitleBarTheme(theme: "light" | "dark"): void;
  microphone: {
    status(): Promise<MicStatus>;
    request(): Promise<"granted" | "denied" | "unknown">;
    markExplained(): Promise<void>;
  };
  onCloseRequested(listener: (e: { reason: string }) => void): () => void;
  onNavigate(listener: (e: { path: string }) => void): () => void;
  onDataFolderProgress(listener: (p: DataFolderProgress) => void): () => void;
}

declare global {
  interface Window {
    uhDesktop?: DesktopApi;
  }
}

function api(): DesktopApi | undefined {
  return typeof window === "undefined" ? undefined : window.uhDesktop;
}

const noop = () => {};

export function isDesktop(): boolean {
  return api() !== undefined;
}

export const desktop = {
  info: (): Promise<DesktopInfo | null> => api()?.info() ?? Promise.resolve(null),
  setGuardState: (state: GuardState): void => api()?.setGuardState(state),
  respondToClose: (decision: "quit" | "stay"): void => api()?.respondToClose(decision),
  setPort: (port: number): Promise<SetPortResult | null> => api()?.setPort(port) ?? Promise.resolve(null),
  chooseDataFolder: (): Promise<{ path: string } | null> => api()?.chooseDataFolder() ?? Promise.resolve(null),
  changeDataFolder: (req: DataFolderRequest): Promise<DataFolderResult | null> =>
    api()?.changeDataFolder(req) ?? Promise.resolve(null),
  openDataFolder: (): Promise<void> => api()?.openDataFolder() ?? Promise.resolve(),
  openLogsFolder: (): Promise<void> => api()?.openLogsFolder() ?? Promise.resolve(),
  revealPath: (path: string): Promise<void> => api()?.revealPath(path) ?? Promise.resolve(),
  microphone: {
    status: (): Promise<MicStatus | null> => api()?.microphone.status() ?? Promise.resolve(null),
    request: (): Promise<"granted" | "denied" | "unknown" | null> => api()?.microphone.request() ?? Promise.resolve(null),
    markExplained: (): Promise<void> => api()?.microphone.markExplained() ?? Promise.resolve(),
  },
  onCloseRequested: (listener: (e: { reason: string }) => void): (() => void) =>
    api()?.onCloseRequested(listener) ?? noop,
  onNavigate: (listener: (e: { path: string }) => void): (() => void) => api()?.onNavigate(listener) ?? noop,
  onDataFolderProgress: (listener: (p: DataFolderProgress) => void): (() => void) =>
    api()?.onDataFolderProgress(listener) ?? noop,
};
