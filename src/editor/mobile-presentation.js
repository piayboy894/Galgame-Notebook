import { isAndroid } from "../platform/runtime";
import { attr, esc, ico, state } from "./context.js";

// Window size chooses navigation; the current input device chooses interaction density.
export const isPhoneLayout = () => isAndroid && innerWidth < 600;
export const touchActions = () =>
  isAndroid &&
  innerWidth < 840 &&
  document.documentElement.dataset.input === "touch";

export function mobileRowControls(row) {
  if (row.type !== "dialogue") return "";
  const values = [row.expression, row.action].filter(Boolean).join(" · ");
  return `<button class="mobile-performance-toggle" data-mobile-details="${attr(row.id)}" aria-expanded="false"><span>${esc(values || "表情与动作")}</span>${ico("down")}</button>`;
}

export function renderMobileSettings(element) {
  element.innerHTML = `<div class="mobile-settings page-scroll"><h1>设定</h1><p class="mobile-section-hint">${esc(state.project.title)}</p><div class="mobile-settings-group"><button data-act="project-settings">${ico("settings")}<span>项目设置<small>对白每行字符上限</small></span>${ico("next")}</button><button data-act="characters">${ico("users")}<span>角色与表情<small>维护角色、立绘和常用动作</small></span>${ico("next")}</button><button data-act="locations">${ico("map")}<span>地点预设<small>背景、BGM 和环境音</small></span>${ico("next")}</button></div><div class="mobile-settings-group"><button data-mobile-command="shortcuts">${ico("help")}<span>键盘快捷键<small>适用于外接键盘与 DeX</small></span>${ico("next")}</button><button data-mobile-command="updates">${ico("download")}<span>检测软件更新</span>${ico("next")}</button></div><p class="mobile-section-hint">草稿会在本机暂存；保存写入项目库。整个项目库的云存档在「项目」中手动管理。</p></div>`;
}
