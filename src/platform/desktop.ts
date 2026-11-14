import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CommandBody, NativeError } from "../domain/contracts";

export const isDesktop = isTauri();

export async function desktopCommand(
  endpoint: string,
  body: CommandBody = {},
): Promise<any> {
  try {
    if (endpoint === "projects/import-folder") {
      return await invoke("import_folder");
    }
    if (endpoint === "export") {
      return await invoke("export_file", {
        name: String(body.name),
        text: String(body.text),
      });
    }
    if (endpoint === "shutdown") {
      await getCurrentWindow().destroy();
      return { stopped: true };
    }
    return await invoke("project_command", { endpoint, body });
  } catch (cause) {
    const detail = cause as Partial<NativeError>;
    const message =
      typeof cause === "string" ? cause : detail?.message || "本地文件操作失败";
    throw Object.assign(new Error(message), { status: detail?.status || 500 });
  }
}

export async function onDesktopClose(
  callback: () => Promise<boolean>,
): Promise<void> {
  if (!isDesktop) return;
  await getCurrentWindow().onCloseRequested(async (event) => {
    event.preventDefault();
    if (await callback()) await getCurrentWindow().destroy();
  });
}
