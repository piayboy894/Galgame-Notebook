import {
  encyclopediaParts,
  normalizeEncyclopediaLinks,
  setEncyclopediaLinks,
  wrappedEncyclopediaLinks,
} from "../domain/encyclopedia.js";
import { normalizeDialogueSettings, wrapDialogue } from "../domain/dialogue.js";
import { flattenRows, stageRootRows } from "../domain/project.js";
import { uid } from "../domain/primitives.js";
import { $, attr, btn, esc, ib, option, state } from "./context.js";
import { closeModal, confirmBox, menu, modal } from "./dialogs.js";
import { mutate, rowLocation, toast } from "./session.js";

const entryById = (id) => state.project.encyclopedia.find((entry) => entry.id === id);
const button = (id, label, style = "btn primary") =>
  `<button type="button" class="${style}" id="${id}">${label}</button>`;

export function renderEncyclopedia(element) {
  element.innerHTML = `<div class="view-head"><div class="view-title">${ib("back", "board", "路线图")}<h1>百科</h1></div><div class="view-actions">${btn("新建词条", "plus", "add-encyclopedia-entry", "primary")}</div></div>
    <div class="page-scroll encyclopedia-page">
      <div class="encyclopedia-list"><input class="input" type="search" id="encyclopedia-search" placeholder="搜索词条" aria-label="搜索词条"><div id="encyclopedia-entries"></div></div>
    </div>`;
  const search = $("#encyclopedia-search", element);
  const list = $("#encyclopedia-entries", element);
  const renderEntries = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const entries = state.project.encyclopedia.filter(({ title, body }) =>
      [title, body].some((value) => value.toLocaleLowerCase().includes(query)),
    );
    list.innerHTML = entries.map(({ id, title, body }) =>
      `<button type="button" class="search-item encyclopedia-entry" data-act="edit-encyclopedia-entry" data-id="${attr(id)}"><strong>${esc(title)}</strong><span>${esc(body.slice(0, 160))}</span></button>`,
    ).join("") || `<p class="empty-centered">${query ? "没有匹配的词条" : "还没有词条"}</p>`;
  };
  search.addEventListener("input", renderEntries);
  renderEntries();
}

function entryFields(title = "", body = "") {
  return `<div class="field"><label for="encyclopedia-title">词条名称</label><input class="input" id="encyclopedia-title" autofocus maxlength="120" value="${attr(title)}"></div>
    <div class="field"><label for="encyclopedia-body">词条内容</label><textarea class="input" id="encyclopedia-body" rows="7">${esc(body)}</textarea></div>`;
}

function readEntry(id = null) {
  const title = $("#encyclopedia-title").value.trim();
  if (!title) {
    toast("请输入词条名称", true);
    $("#encyclopedia-title").focus();
    return null;
  }
  if (state.project.encyclopedia.some((entry) => entry.id !== id && entry.title === title)) {
    toast("已有同名词条，请使用已有词条或换一个名称", true);
    $("#encyclopedia-title").focus();
    return null;
  }
  return { id: id || uid("entry"), title, body: $("#encyclopedia-body").value.trim() };
}

export function encyclopediaEntryDialog(id = null) {
  const entry = id && entryById(id);
  if (id && !entry) return;
  modal(
    entry ? "编辑词条" : "新建词条",
    entryFields(entry?.title, entry?.body),
    (entry ? button("encyclopedia-delete", "删除词条", "btn danger") : "") +
      btn("取消", null, "modal-close") + button("encyclopedia-save", "保存"),
  );
  $("#encyclopedia-save").onclick = () => {
    const next = readEntry(id);
    if (!next) return;
    mutate(() => {
      if (entry) Object.assign(entry, next);
      else state.project.encyclopedia.push(next);
    });
    closeModal();
    toast("词条已保存");
  };
  if (!entry) return;
  $("#encyclopedia-delete").onclick = () => {
    const rows = flattenRows(state.project.chapters.flatMap((chapter) =>
      chapter.stages.flatMap(stageRootRows),
    ));
    const count = rows.reduce((total, row) =>
      total + (row.encyclopediaLinks || []).filter((link) => link.entryId === id).length, 0);
    confirmBox("删除词条", count
      ? `删除「${entry.title}」并解除 ${count} 处对白关联？对白文字会保留。`
      : `删除「${entry.title}」？`, () => {
      mutate(() => {
        state.project.encyclopedia = state.project.encyclopedia.filter((item) => item.id !== id);
        for (const row of rows)
          if (row.encyclopediaLinks)
            setEncyclopediaLinks(row, row.encyclopediaLinks.filter((link) => link.entryId !== id));
      });
      toast("词条已删除");
    }, true);
  };
}

export function selectedDialogueText(field) {
  if (!field?.matches("textarea.dialogue-cell") || state.composition) return null;
  const element = field.closest("[data-branch-row],[data-row]");
  const rowId = element?.dataset.branchRow || element?.dataset.row;
  const row = rowLocation(rowId)?.row;
  if (row?.type !== "dialogue" || row.text !== field.value) return null;
  const start = field.selectionStart;
  const end = field.selectionEnd;
  if (!row.text.slice(start, end).trim()) return null;
  return { rowId, start, end, text: row.text, field };
}

export function dialogueLinkSelection(id) {
  return selectedDialogueText($(`[data-row="${CSS.escape(id)}"] textarea.dialogue-cell,[data-branch-row="${CSS.escape(id)}"] textarea.dialogue-cell`));
}

export function dialogueEncyclopediaMenu(event, selection) {
  event.preventDefault();
  menu({ getBoundingClientRect: () => ({ right: event.clientX, bottom: event.clientY }) }, [
    { label: "转换成词条", icon: "link", click: () => dialogueLinkDialog(selection) },
    {
      label: "复制文字",
      icon: "copy",
      click: () => {
        if (!selection.field.isConnected) return;
        selection.field.focus({ preventScroll: true });
        selection.field.setSelectionRange(selection.start, selection.end);
        document.execCommand("copy");
      },
    },
  ]);
}

export function dialogueLinkDialog(selection) {
  if (!selection) return toast("请先选中对白中的文字");
  const { rowId, start, end, text } = selection;
  const row = rowLocation(rowId)?.row;
  if (row?.text !== text) return toast("对白已改变，请重新选择文字", true);
  const phrase = text.slice(start, end);
  const links = row.encyclopediaLinks || [];
  const current = links.find((link) => link.start === start && link.end === end);
  if (links.some((link) => link !== current && link.start < end && link.end > start))
    return toast("选区与已有词条重叠，请先调整选区或解除关联", true);

  const entries = state.project.encyclopedia;
  const suggestedTitle = phrase.trim().replace(/\s*\n\s*/g, "").slice(0, 120);
  const existing = current?.entryId || entries.find((entry) => entry.title === suggestedTitle)?.id || "__new";
  modal(current ? "词条关联" : "转换成词条",
    `<blockquote class="encyclopedia-selection">${esc(phrase)}</blockquote>
    <div class="field"><label for="encyclopedia-target">关联词条</label><select class="input" id="encyclopedia-target" autofocus>${entries.map((entry) => option(entry.id, entry.title, existing)).join("")}${option("__new", "新建词条…", existing)}</select></div>
    <div id="encyclopedia-new-fields" ${existing === "__new" ? "" : "hidden"}>${entryFields(suggestedTitle)}</div>`,
    (current ? button("encyclopedia-unlink", "解除关联", "btn danger") : "") +
      btn("取消", null, "modal-close") + button("encyclopedia-link", "保存关联"),
  );
  const picker = $("#encyclopedia-target");
  picker.onchange = () => {
    $("#encyclopedia-new-fields").hidden = picker.value !== "__new";
    if (picker.value === "__new") $("#encyclopedia-title").focus();
  };
  $("#encyclopedia-link").onclick = () => {
    const newEntry = picker.value === "__new";
    const entry = newEntry ? readEntry() : entryById(picker.value);
    if (!entry) return;
    const linkedRow = rowLocation(rowId)?.row;
    if (linkedRow !== row || linkedRow.text !== text)
      return toast("对白已改变，请重新选择文字", true);
    mutate(() => {
      if (newEntry) entries.push(entry);
      setEncyclopediaLinks(row, normalizeEncyclopediaLinks(
        [...links.filter((link) => link !== current), { start, end, entryId: entry.id }], text,
      ));
    });
    closeModal();
    toast("词条已关联");
  };
  if (current) $("#encyclopedia-unlink").onclick = () => {
    mutate(() => setEncyclopediaLinks(row, links.filter((link) => link !== current)));
    closeModal();
    toast("已解除词条关联");
  };
}

export function encyclopediaChips(row) {
  return (row.encyclopediaLinks || []).map(({ start, end, entryId }) => {
    const entry = entryById(entryId);
    if (!entry) return "";
    const label = row.text.slice(start, end);
    return `<button type="button" class="encyclopedia-chip" data-act="edit-dialogue-link" data-row-id="${attr(row.id)}" data-start="${start}" data-end="${end}" title="${attr(entry.title)}">${esc(label)}</button>`;
  }).join("");
}

export function editDialogueLink(button) {
  const rowId = button.dataset.rowId;
  const row = rowLocation(rowId)?.row;
  if (row) dialogueLinkDialog({
    rowId, start: Number(button.dataset.start), end: Number(button.dataset.end), text: row.text,
  });
}

export function previewEncyclopediaDialogue(row) {
  const text = wrapDialogue(row.text, normalizeDialogueSettings(state.project.settings).dialogueLineLength);
  const links = wrappedEncyclopediaLinks(row.encyclopediaLinks, row.text, text);
  return encyclopediaParts(text, links).map(({ text, entryId }) => {
    const entry = entryId && entryById(entryId);
    return entry
      ? `<button type="button" class="encyclopedia-term" data-act="read-encyclopedia-entry" data-id="${attr(entryId)}" aria-expanded="false" title="${attr(entry.title)}">${esc(text)}</button>`
      : esc(text);
  }).join("");
}

export function revealEncyclopediaEntry(button) {
  const entry = entryById(button.dataset.id);
  const row = button.closest(".preview-dialogue");
  if (!entry || !row) return;
  const current = row.querySelector(".encyclopedia-note");
  const expanded = button.getAttribute("aria-expanded") === "true";
  row.querySelector('.encyclopedia-term[aria-expanded="true"]')?.setAttribute("aria-expanded", "false");
  current?.remove();
  if (expanded) return;
  button.setAttribute("aria-expanded", "true");
  button.closest("p").insertAdjacentHTML("afterend",
    `<aside class="encyclopedia-note" role="status"><strong>${esc(entry.title)}</strong><p>${esc(entry.body || "暂无内容")}</p></aside>`,
  );
}
