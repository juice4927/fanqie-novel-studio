import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { StructuredLogger } from "./structured-log";

export function configureAutoUpdates(logger: StructuredLogger, beforeInstall: () => Promise<void>) {
  if (!app.isPackaged || process.env.NOVEL_STUDIO_DISABLE_AUTO_UPDATE === "1") return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => logger.write("info", "update.checking"));
  autoUpdater.on("update-available", (info) => logger.write("info", "update.available", { version: info.version }));
  autoUpdater.on("update-not-available", (info) => logger.write("info", "update.current", { version: info.version }));
  autoUpdater.on("error", (error) => logger.write("error", "update.failed", { error: error.message }));
  autoUpdater.on("update-downloaded", async (info) => {
    logger.write("info", "update.downloaded", { version: info.version });
    try {
      await beforeInstall();
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      logger.write("error", "update.backup_failed", { error: error instanceof Error ? error.message : String(error) });
    }
  });
  setTimeout(() => void autoUpdater.checkForUpdates(), 15_000).unref();
}
