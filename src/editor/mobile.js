import { onBackButtonPress } from "@tauri-apps/api/app";
import { isAndroid, nativeCommand } from "../platform/runtime";
import { $, state, libraryVisible } from "./context.js";
import { closeMenu, closeModal } from "./dialogs.js";
import { closeProjectLibrary, showProjectLibrary } from "./project-files.js";
import { go, persist, render, toast } from "./session.js";

let compact = window.innerWidth < 600;
export function initializeMobile() {
  if (!isAndroid) return;
  document.documentElement.classList.add("android");
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(state.cacheTimer);
      persist();
    }
  });
  window.addEventListener("pagehide", persist);
  window.addEventListener("resize", () => {
    const next = window.innerWidth < 600;
    if (compact !== next) {
      compact = next;
      if (
        state.project &&
        state.view.type === "board" &&
        !$("#modal-root").firstChild
      )
        render();
    }
    const active = document.activeElement;
    if (active?.matches("input,textarea,select"))
      requestAnimationFrame(() => active.scrollIntoView({ block: "nearest" }));
  });
  void onBackButtonPress(async () => {
    if (state.syncBusy) {
      toast("同步进行中，请稍候");
      return;
    }
    if ($(".update-overlay")) {
      $("#update-close")?.click();
      return;
    }
    if ($("#modal-root").firstChild) {
      closeModal();
      return;
    }
    if ($("#menu-root").firstChild) {
      closeMenu();
      return;
    }
    if (libraryVisible()) {
      if (state.dirty || state.sourceName) closeProjectLibrary();
      else {
        persist();
        await nativeCommand("mobile/background");
      }
    } else if (state.view.type === "stage") go("chapter", state.view.chapterId);
    else if (state.view.type !== "board") go("board");
    else showProjectLibrary();
  }).catch(() => toast("系统返回操作初始化失败", true));
}
