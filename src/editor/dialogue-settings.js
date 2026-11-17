import {
  dialogueWrapChanges,
  longestDialogueLine,
  normalizeDialogueSettings,
  wrapDialogue,
} from "../domain/dialogue.js";
import { attr, btn, esc, state } from "./context.js";
import { closeModal, modal } from "./dialogs.js";
import { mutate, toast } from "./session.js";

export function projectSettingsDialog() {
  if (state.libraryOnly) return toast("请先打开一个项目", true);
  const settings = normalizeDialogueSettings(state.project.settings);
  modal(
    "项目设置",
    `<p>${esc(state.project.title)} · 设置只属于此项目，随源文件和云存档保存。</p><div class="field"><label for="dialogue-line-limit">对白每行最多字符</label><input class="input" id="dialogue-line-limit" type="number" min="0" max="500" step="1" value="${settings.dialogueLineLength}" autofocus><small>0 表示不限，可设置 1–500。中文、字母、标点和一个完整 emoji 各计 1 个字符。</small></div><div class="field"><label for="dialogue-overflow">超出上限时</label><select class="input" id="dialogue-overflow"><option value="wrap" ${settings.dialogueOverflow === "wrap" ? "selected" : ""}>自动插入换行</option><option value="warn" ${settings.dialogueOverflow === "warn" ? "selected" : ""}>只提示超出，保留原文</option></select></div><p class="tiny">自动换行不会截断文字，已有换行会保留；描述、笔记和选项标题不受限制。</p><label class="dialogue-existing"><input type="checkbox" id="dialogue-format-existing" checked>同时整理现有对白换行（可撤销）</label><p id="dialogue-setting-error" class="sync-message" role="status"></p>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="dialogue-setting-save">保存设置</button>',
  );
  const limit = document.querySelector("#dialogue-line-limit");
  const mode = document.querySelector("#dialogue-overflow");
  const existing = document.querySelector("#dialogue-format-existing");
  mode.onchange = () => {
    existing.disabled = mode.value !== "wrap";
  };
  mode.onchange();
  document.querySelector("#dialogue-setting-save").onclick = () => {
    const n = Number(limit.value);
    if (limit.value.trim() === "" || !Number.isInteger(n) || n < 0 || n > 500) {
      document.querySelector("#dialogue-setting-error").textContent =
        "请输入 0–500 之间的整数";
      return;
    }
    mutate(() => {
      state.project.settings = {
        dialogueLineLength: n,
        dialogueOverflow: mode.value,
      };
      if (existing.checked && mode.value === "wrap")
        for (const { row, text } of dialogueWrapChanges(state.project))
          row.text = text;
    });
    closeModal();
    toast("项目设置已保存到草稿，请保存项目源文件");
  };
}
export function dialogueInputHTML(row, branch = false) {
  const n = normalizeDialogueSettings(
    state.project.settings,
  ).dialogueLineLength;
  const size = longestDialogueLine(row.text);
  return `<div class="dialogue-field"><textarea class="cell autosize dialogue-cell" rows="1" wrap="soft" ${branch ? 'data-branch-field="text"' : 'data-row-field="text"'} placeholder="对白" aria-label="对白 · Enter 换行 · Alt Enter 新增对白" aria-describedby="dialogue-meter-${attr(row.id)}" aria-invalid="${Boolean(n && size > n)}">${esc(row.text)}</textarea><span class="dialogue-meter ${n && size > n ? "over-limit" : ""}" id="dialogue-meter-${attr(row.id)}" ${n ? "" : "hidden"}>最长一行 ${size} / ${n}</span></div>`;
}
export function refreshDialogueMeter(target) {
  if (!target.matches?.("textarea.dialogue-cell")) return;
  const meter = target.parentElement.querySelector(".dialogue-meter");
  const n = normalizeDialogueSettings(
    state.project.settings,
  ).dialogueLineLength;
  const size = longestDialogueLine(target.value);
  const over = Boolean(n && size > n);
  target.setAttribute("aria-invalid", String(over));
  if (meter) {
    meter.hidden = !n;
    meter.textContent = `最长一行 ${size} / ${n}`;
    meter.classList.toggle("over-limit", over);
  }
}
export function prepareDialogueInput(target) {
  if (!target.matches?.("textarea.dialogue-cell")) return false;
  const { dialogueLineLength: n, dialogueOverflow: mode } =
    normalizeDialogueSettings(state.project.settings);
  const original = target.value;
  if (mode === "wrap" && n) {
    const text = wrapDialogue(original, n);
    if (text !== original) {
      const start = wrapDialogue(
        original.slice(0, target.selectionStart),
        n,
      ).length;
      const end = wrapDialogue(
        original.slice(0, target.selectionEnd),
        n,
      ).length;
      const direction = target.selectionDirection;
      target.value = text;
      target.setSelectionRange(start, end, direction);
    }
  }
  refreshDialogueMeter(target);
  return original !== target.value;
}
