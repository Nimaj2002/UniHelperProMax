// The app window: one persistent session partition (IndexedDB and localStorage survive restarts,
// research R7), hardened web preferences (research R14), and the client-secret header added to
// every request to the app's own address (research R8).
import { BrowserWindow, Menu, app, nativeTheme, session, type Session } from "electron";
import path from "node:path";
import { appOrigin } from "./backend";

export const PARTITION = "persist:unihelper";

export function appSession(): Session {
  return session.fromPartition(PARTITION);
}

export function devToolsAllowed(): boolean {
  return !app.isPackaged || process.env.UNIHELPER_PROBE === "1";
}

export function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: "UniHelperProMax",
    backgroundColor: "#00000000",
    // macOS takes the icon from the app bundle; Windows and Linux use the window's own
    ...(process.platform === "darwin" ? {} : { icon: path.join(__dirname, "icon.png") }),
    // Windows/Linux: no title or menu bar, only the native min/max/close buttons over the page;
    // the page leaves env(titlebar-area-height) free at the top and makes it draggable
    ...(process.platform === "darwin"
      ? {}
      : { titleBarStyle: "hidden" as const, titleBarOverlay: titleBarColors(nativeTheme.shouldUseDarkColors ? "dark" : "light") }),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: devToolsAllowed(),
      spellcheck: true,
    },
  });
  if (app.isPackaged && !devToolsAllowed()) Menu.setApplicationMenu(appMenu());
  win.once("ready-to-show", () => win.show());
  return win;
}

export function titleBarColors(theme: "light" | "dark"): Electron.TitleBarOverlay {
  return { color: "#00000000", symbolColor: theme === "dark" ? "#e5e5e5" : "#262626", height: 36 };
}

/** A menu without developer tools (FR-039); keeps the standard edit and window roles. */
function appMenu(): Menu {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : [{ role: "fileMenu" as const }]),
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template);
}

let headerHook: { port: number; secret: () => string } | null = null;

/** Add X-UniHelper-Client to every request the app session makes to the backend. */
export function injectClientSecret(port: number, secret: () => string): void {
  headerHook = { port, secret };
  appSession().webRequest.onBeforeSendHeaders({ urls: [`${appOrigin(port)}/*`] }, (details, callback) => {
    const hook = headerHook;
    if (hook) details.requestHeaders["X-UniHelper-Client"] = hook.secret();
    callback({ requestHeaders: details.requestHeaders });
  });
}

export function startupPage(): string {
  return path.join(__dirname, "startup", "startup.html");
}
