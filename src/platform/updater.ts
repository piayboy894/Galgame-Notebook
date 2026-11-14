import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import type { UpdatePort } from "../application/update-service";

/** Signature and HTTPS verification are enforced by the native Tauri updater. */
export const desktopUpdater: UpdatePort = {
  async check() {
    const update = await check({ timeout: 30_000 });
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body || "此版本没有附加更新说明。",
      async install(progress) {
        let received = 0;
        let total: number | undefined;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") total = event.data.contentLength;
          if (event.event === "Progress") received += event.data.chunkLength;
          progress(received, total);
        });
      },
      async close() {
        await update.close();
      },
    };
  },
  async backup() {
    await invoke("backup_before_update");
  },
  async relaunch() {
    await relaunch();
  },
};
