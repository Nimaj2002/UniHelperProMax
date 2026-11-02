// Auto-update from GitHub Releases (electron-updater; publish config in electron-builder.yml).
// Windows (NSIS) and AppImage download in the background and install when the app quits, after
// will-quit has stopped the backend. macOS (ad-hoc signed: Squirrel.Mac refuses the update) and
// .deb (would need a root password) only show a notification that links to the release.
import { Notification, app, shell } from "electron";
import { autoUpdater } from "electron-updater";
import { log } from "./logs";

const APP_ID = "io.github.nimaj2002.unihelperpromax"; // electron-builder.yml appId
const RELEASES = "https://github.com/Nimaj2002/UniHelperProMax/releases/latest";

export function canSelfInstall(platform: string = process.platform, appImage = process.env.APPIMAGE): boolean {
  return platform === "win32" || (platform === "linux" && !!appImage);
}

export function checkForUpdates(): void {
  // UNIHELPER_NO_UPDATE: e2e runs packaged builds and must not download or install a release
  if (!app.isPackaged || process.env.UNIHELPER_NO_UPDATE === "1") return;
  if (process.platform === "win32") app.setAppUserModelId(APP_ID); // Windows shows no notifications without it
  autoUpdater.logger = log;
  const selfInstall = canSelfInstall();
  autoUpdater.autoDownload = selfInstall;
  autoUpdater.autoInstallOnAppQuit = selfInstall;
  if (!selfInstall) {
    autoUpdater.on("update-available", (info) => {
      log.info(`update ${info.version} available; this install can't update itself`);
      if (!Notification.isSupported()) return;
      const note = new Notification({
        title: "UniHelperProMax update available",
        body: `Version ${info.version} is out. Click to download it.`,
      });
      note.on("click", () => void shell.openExternal(RELEASES));
      note.show();
    });
  }
  const check = selfInstall ? autoUpdater.checkForUpdatesAndNotify() : autoUpdater.checkForUpdates();
  check.catch((err: unknown) => log.warn(`update check failed: ${String(err)}`));
}
