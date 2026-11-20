import {
  longestDialogueLine,
  normalizeDialogueSettings,
  wrapDialogue,
} from "../domain/dialogue.js";
import { encyclopediaChips } from "./encyclopedia.js";
import { attr, btn, esc, state } from "./context.js";
import { closeModal, modal } from "./dialogs.js";
import { mutate, toast } from "./session.js";

export function projectSettingsDialog() {
  if (state.libraryOnly) return toast("请先打开一个项目", true);
  const settings = normalizeDialogueSettings(state.project.settings);
  modal(
    "项目设置",
    `<p>${esc(state.project.title)} · 设置只属于此项目，随源文件和云存档保存。</p><div class="field"><label for="dialogue-line-limit">对白每行最多字符</label><input class="input" id="dialogue-line-limit" type="number" min="0" max="500" step="1" value="${settings.dialogueLineLength}" autofocus><small>0 表示不限，可设置 1–500。中文、字母、标点和一个完整 emoji 各计 1 个字符。</small></div><p class="tiny">超过上限自动插入换行，不标红，不截断文字。设置后立即整理本项目对白，已有手动换行保留；编辑、阅读与导出保持相同换行。可撤销。描述、笔记和选项标题不受影响。</p><p id="dialogue-setting-error" class="sync-message" role="status"></p>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="dialogue-setting-save">保存设置</button>',
  );
  const limit = document.querySelector("#dialogue-line-limit");
  document.querySelector("#dialogue-setting-save").onclick = () => {
    const n = Number(limit.value);
    if (limit.value.trim() === "" || !Number.isInteger(n) || n < 0 || n > 500) {
      document.querySelector("#dialogue-setting-error").textContent =
        "请输入 0–500 之间的整数";
      return;
    }
    mutate(() => {
      state.project.settings = { dialogueLineLength: n };
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
  const chips = encyclopediaChips(row);
  return `<div class="dialogue-field"><textarea class="cell autosize dialogue-cell" rows="1" wrap="soft" ${branch ? 'data-branch-field="text"' : 'data-row-field="text"'} placeholder="对白" aria-label="对白 · Enter 换行 · Alt Enter 新增对白" aria-describedby="dialogue-meter-${attr(row.id)}">${esc(row.text)}</textarea><span class="dialogue-meter" id="dialogue-meter-${attr(row.id)}" ${n ? "" : "hidden"}>最长一行 ${size} / ${n}</span><div class="encyclopedia-chips" ${chips ? "" : "hidden"}>${chips}</div></div>`;
}
export function refreshDialogueLinks(field, row) {
  const links = field.parentElement.querySelector(".encyclopedia-chips");
  const chips = encyclopediaChips(row);
  links.innerHTML = chips;
  links.hidden = !chips;
}

export function refreshDialogueMeter(target) {
  if (!target.matches?.("textarea.dialogue-cell")) return;
  const meter = target.parentElement.querySelector(".dialogue-meter");
  const n = normalizeDialogueSettings(
    state.project.settings,
  ).dialogueLineLength;
  const size = longestDialogueLine(target.value);
  if (meter) {
    meter.hidden = !n;
    meter.textContent = `最长一行 ${size} / ${n}`;
  }
}
export function prepareDialogueInput(target) {
  if (!target.matches?.("textarea.dialogue-cell")) return false;
  const { dialogueLineLength: n } = normalizeDialogueSettings(
    state.project.settings,
  );
  const original = target.value;
  if (n) {
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
