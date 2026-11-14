import { UpdateService, type UpdateState } from "../application/update-service";
import { desktopUpdater, androidUpdater } from "../platform/updater";
import { isNative, isAndroid, nativeCommand } from "../platform/runtime";
import { version } from "../../package.json";

let service: UpdateService | undefined;
let saveBeforeUpdate: () => Promise<boolean> = async () => true;
let overlay: HTMLDivElement | undefined;
let previousFocus: HTMLElement | null = null;

function setEditorInert(inert: boolean): void {
  for (const selector of [".app", "#project-library"]) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) element.inert = inert;
  }
}

function closeUpdates(): void {
  overlay?.remove();
  overlay = undefined;
  setEditorInert(false);
  previousFocus?.focus();
}

export function configureUpdates(save: () => Promise<boolean>): void {
  saveBeforeUpdate = save;
}

export function showUpdates(): void {
  if (overlay) return;
  previousFocus = document.activeElement as HTMLElement | null;
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
  setEditorInert(true);
  const action = overlay.querySelector<HTMLButtonElement>("#update-action")!;
  overlay.querySelector<HTMLButtonElement>("#update-close")!.onclick = () => {
    if (
      service?.state.phase === "downloading" ||
      service?.state.phase === "installing"
    )
      return;
    closeUpdates();
  };
  overlay.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape")
      overlay?.querySelector<HTMLButtonElement>("#update-close")?.click();
    if (event.key === "Tab") {
      const controls = [
        ...overlay!.querySelectorAll<HTMLElement>(
          "button:not(:disabled):not([hidden]),a[href]",
        ),
      ];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  overlay.querySelector<HTMLAnchorElement>("a")!.onclick = async (event) => {
    if (!isNative) return;
    event.preventDefault();
    try {
      await nativeCommand("updates/open-download-page");
    } catch {
      overlay!.querySelector("#update-status")!.textContent =
        "无法打开下载页面，请重试。";
    }
  };
  if (!isNative) {
    overlay.querySelector("#update-status")!.textContent =
      "浏览器预览模式。请安装 Windows 桌面版以使用一键更新。";
    action.hidden = true;
    overlay.querySelector<HTMLButtonElement>("#update-close")!.focus();
    return;
  }
  service ??= new UpdateService(
    isAndroid ? androidUpdater : desktopUpdater,
    render,
  );
  render(service.state);
  action.onclick = async () => {
    if (service?.state.phase === "awaiting-install") {
      closeUpdates();
      return;
    }
    if (service?.state.phase === "available")
      await service.install(async () => {
        const dialog = overlay!;
        dialog.hidden = true;
        setEditorInert(false);
        let saved = false;
        try {
          saved = await saveBeforeUpdate();
        } finally {
          if (saved) {
            dialog.hidden = false;
            setEditorInert(true);
          } else closeUpdates();
        }
        return saved;
      });
    else await service?.check();
  };
  action.focus();
  void service.check();
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
    state.phase === "awaiting-install"
      ? "关闭"
      : state.phase === "available"
        ? "保存并一键更新"
        : "检测 GitHub 更新";
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
  if (state.phase === "awaiting-install")
    status.textContent =
      "签名校验已通过，系统安装器已打开，请按系统提示完成更新。";
  if (state.phase === "error")
    status.textContent = `更新未完成：${state.message}。请检查网络后重试，也可以打开下载页面。`;
}
