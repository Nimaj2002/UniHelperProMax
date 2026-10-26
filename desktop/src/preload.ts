// The only surface the pages get (contracts/preload-bridge.md). The app (http://127.0.0.1:<port>)
// gets window.uhDesktop; the local startup page (file://) gets window.uhStartup. No file system
// or database access is exposed (Principle III).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

type Listener<T> = (payload: T) => void;

function on<T>(channel: string, listener: Listener<T>): () => void {
  const wrapped = (_e: IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld(
    "uhStartup",
    Object.freeze({
      onState: (listener: Listener<unknown>) => on("uh:startup.state", listener),
      action: (name: string, payload?: unknown) => ipcRenderer.invoke("uh:startup.action", name, payload),
      ready: () => ipcRenderer.send("uh:startup.ready"),
    }),
  );
} else {
  contextBridge.exposeInMainWorld(
    "uhDesktop",
    Object.freeze({
      info: () => ipcRenderer.invoke("uh:info"),
      setGuardState: (state: unknown) => ipcRenderer.send("uh:guard", state),
      respondToClose: (decision: "quit" | "stay") => ipcRenderer.send("uh:close.respond", decision),
      setPort: (port: number) => ipcRenderer.invoke("uh:port.set", port),
      chooseDataFolder: () => ipcRenderer.invoke("uh:dataFolder.choose"),
      changeDataFolder: (req: unknown) => ipcRenderer.invoke("uh:dataFolder.change", req),
      openDataFolder: () => ipcRenderer.invoke("uh:open.dataFolder"),
      openLogsFolder: () => ipcRenderer.invoke("uh:open.logs"),
      revealPath: (target: string) => ipcRenderer.invoke("uh:reveal.path", target),
      microphone: Object.freeze({
        status: () => ipcRenderer.invoke("uh:microphone.status"),
        request: () => ipcRenderer.invoke("uh:microphone.request"),
        markExplained: () => ipcRenderer.invoke("uh:microphone.markExplained"),
      }),
      onCloseRequested: (listener: Listener<{ reason: string }>) => on("uh:close.requested", listener),
      onNavigate: (listener: Listener<{ path: string }>) => on("uh:navigate", listener),
      onDataFolderProgress: (listener: Listener<unknown>) => on("uh:dataFolder.progress", listener),
    }),
  );
}
