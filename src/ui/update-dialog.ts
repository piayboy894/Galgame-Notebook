import { UpdateService, type UpdateState } from "../application/update-service";
import { desktopUpdater } from "../platform/updater";
import { isDesktop } from "../platform/desktop";
import { version } from "../../package.json";

let service: UpdateService | undefined;
let saveBeforeUpdate: () => Promise<boolean> = async () => true;
let overlay: HTMLDivElement | undefined;

export function configureUpdates(save: () => Promise<boolean>): void {
  saveBeforeUpdate = save;
}

export function showUpdates(): void {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "overlay update-overlay";
  overlay.innerHTML = `<section class="modal update-modal" role="dialog" aria-modal="true" aria-labelledby="update-heading">
    <div class="modal-head"><h2 id="update-heading">软件更新</h2><button class="icon-btn" id="update-close" aria-label="关闭">×</button></div>
    <div class="modal-body"><p class="update-version">叙线 v${version}</p><p id="update-status" role="status" aria-live="polite"></p>
    <progress id="update-progress" hidden></progress><pre id="update-notes"></pre>
    <p class="update-hint">更新来源：GitHub 官方仓库。仅在点击检测时联网，安装前保存并备份剧本。</p></div>
    <div class="modal-foot"><a class="btn" href="https://github.com/piayboy894/Galgame-Notebook/releases/latest" target="_blank" rel="noopener">下载页面</a>
    <button class="btn primary" id="update-action">检测 GitHub 更新</button></div></section>`;
  document.body.append(overlay);
  const action = overlay.querySelector<HTMLButtonElement>("#update-action")!;
  overlay.querySelector<HTMLButtonElement>("#update-close")!.onclick = () => {
    if (
      service?.state.phase === "downloading" ||
      service?.state.phase === "installing"
    )
      return;
    overlay?.remove();
    overlay = undefined;
  };
  if (!isDesktop) {
    overlay.querySelector("#update-status")!.textContent =
      "浏览器预览模式。请安装 Windows 桌面版以使用一键更新。";
    action.hidden = true;
    return;
  }
  service ??= new UpdateService(desktopUpdater, render);
  render(service.state);
  action.onclick = async () => {
    if (service?.state.phase === "available")
      await service.install(saveBeforeUpdate);
    else await service?.check();
  };
  action.focus();
}

function render(state: UpdateState): void {
  if (!overlay) return;
  const status = overlay.querySelector("#update-status")!;
  const action = overlay.querySelector<HTMLButtonElement>("#update-action")!;
  const close = overlay.querySelector<HTMLButtonElement>("#update-close")!;
  const notes = overlay.querySelector("#update-notes")!;
  const progress =
    overlay.querySelector<HTMLProgressElement>("#update-progress")!;
  action.disabled = ["checking", "downloading", "installing"].includes(
    state.phase,
  );
  close.disabled = ["downloading", "installing"].includes(state.phase);
  progress.hidden = state.phase !== "downloading";
  notes.textContent = state.phase === "available" ? state.notes : "";
  action.textContent =
    state.phase === "available" ? "保存并一键更新" : "检测 GitHub 更新";
  if (state.phase === "idle")
    status.textContent = "点击下方按钮，检查是否有新版本。";
  if (state.phase === "checking") status.textContent = "正在连接 GitHub…";
  if (state.phase === "current") status.textContent = "当前已是最新版本。";
  if (state.phase === "available")
    status.textContent = `发现新版本 v${state.version}`;
  if (state.phase === "downloading") {
    status.textContent = state.total
      ? `正在下载 ${Math.min(100, Math.round((state.received / state.total) * 100))}%`
      : `正在下载 ${(state.received / 1048576).toFixed(1)} MB…`;
    if (state.total) {
      progress.max = state.total;
      progress.value = state.received;
    } else progress.removeAttribute("value");
  }
  if (state.phase === "installing")
    status.textContent = "正在安装更新，程序即将重新启动…";
  if (state.phase === "error")
    status.textContent = `更新未完成：${state.message}。请检查网络后重试，也可以打开下载页面。`;
}
