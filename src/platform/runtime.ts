import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CommandBody, NativeError } from "../domain/contracts";

export const isNative = isTauri();
export const isAndroid =
  isNative &&
  (window as Window & { __XUXIAN_ANDROID__?: boolean }).__XUXIAN_ANDROID__ ===
    true;
export const isDesktop = isNative && !isAndroid;
export const credentialStoreName = isAndroid
  ? "Android Keystore"
  : "Windows 凭据管理器";
export const projectStorageName = isAndroid
  ? "本机 · 应用项目库"
  : "本地 · 文档/叙线/剧本项目";
let draftEpoch: number | null = null;
let draftSequence = 0;
export async function readMobileDraft(): Promise<any> {
  const result = await nativeCommand("mobile/read-draft");
  draftEpoch = result.epoch;
  draftSequence = 0;
  return result;
}
export async function writeMobileDraft(data: CommandBody): Promise<void> {
  if (draftEpoch === null) return;
  await nativeCommand("mobile/save-draft", {
    ...data,
    epoch: draftEpoch,
    sequence: ++draftSequence,
  });
}

export async function nativeCommand(
  endpoint: string,
  body: CommandBody = {},
): Promise<any> {
  try {
    if (endpoint.startsWith("mobile/"))
      return await invoke("mobile_command", { endpoint, body });
    if (endpoint.startsWith("sync/")) {
      return await invoke("github_sync_command", { endpoint, body });
    }
    if (endpoint === "projects/import-folder") {
      return await invoke("import_folder");
    }
    if (endpoint === "export") {
      if (isAndroid)
        return await invoke("mobile_command", {
          endpoint: "mobile/export",
          body,
        });
      return await invoke("export_file", {
        name: String(body.name),
        text: String(body.text),
      });
    }
    if (endpoint === "shutdown") {
      if (isAndroid)
        return await invoke("mobile_command", {
          endpoint: "mobile/background",
          body: {},
        });
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
