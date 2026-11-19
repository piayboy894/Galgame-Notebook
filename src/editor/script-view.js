import { dialogueInputHTML } from "./dialogue-settings.js";
import { effectiveLocation, LOCATION_FIELDS } from "../domain/scenes.js";
import { mobileRowControls } from "./mobile-presentation.js";
import { branchRowCount, flattenRows } from "../domain/project.js";
import { safeColor } from "../domain/primitives.js";
import {
  $,
  $$,
  C,
  P,
  R,
  attr,
  btn,
  currentChapter,
  currentStage,
  esc,
  ib,
  ico,
  inspectName,
  option,
  state,
  textCount,
} from "./context.js";
import { investigationCanvas, setupInvestigationCanvas } from "./investigation-canvas.js";
import { describeInvestigationRule, investigationAddMenu } from "./investigation-editor.js";
import { currentInvestigationItem, currentInvestigationScript, selectInvestigationItem } from "./session.js";
import { setupRowDrag, syncRowSelection } from "./row-operations.js";

export function crumbs(items) {
  return (
    '<nav class="crumbs">' +
    items
      .map(
        (v, i) =>
          (i ? ico("next") : "") +
          (v.act
            ? `<button data-act="${v.act}" ${v.id ? `data-id="${attr(v.id)}"` : ""}>${esc(v.text)}</button>`
            : `<span class="current">${esc(v.text)}</span>`),
      )
      .join("") +
    "</nav>"
  );
}

export function renderChapter(e) {
  const c = currentChapter(),
    r = R(c.routeId);
  e.innerHTML =
    crumbs([
      { text: "路线图", act: "board" },
      { text: r?.name || "" },
      { text: c.title },
    ]) +
    `<div class="chapter-header"><input class="title-edit" data-bind="chapter-title" value="${attr(c.title)}" aria-label="章节标题" maxlength="300"><div class="view-actions">${btn("解锁", "link", "current-rules", "ghost")}${ib("note", "chapter-notes", "章节笔记")}${btn("阶段", "plus", "add-stage", "primary")}${ib("dots", "current-chapter-menu", "章节操作")}</div></div><div class="page-scroll">${c.summary ? `<div class="stage-summary">${esc(c.summary)}</div>` : ""}<div class="stage-grid">${c.stages.map((s, i) => `<article class="stage-card" data-act="open-stage" data-id="${attr(s.id)}" tabindex="0"><div class="stage-order">${state.sim.active ? `<button class="sim-check ${state.sim.chapters.has(c.id) || state.sim.stages.has(s.id) ? "done" : ""}" data-act="complete-stage" data-id="${attr(s.id)}" title="切换阶段完成状态">${state.sim.chapters.has(c.id) || state.sim.stages.has(s.id) ? ico("check") : ""}</button>` : ""}<span>${String(i + 1).padStart(2, "0")}</span>${ib("dots", "stage-menu", "阶段操作", `data-id="${attr(s.id)}"`)}</div><h2>${esc(s.title)}</h2>${s.notes ? `<p>${esc(s.notes)}</p>` : ""}<div class="stage-foot"><span>${s.kind === "investigation" ? "调查 · " + (s.objects || []).length + " 张卡片" : "剧情阶段"}</span><span>·</span><span>${branchRowCount(s)} 行脚本</span><span>·</span><span>${textCount(s)} 字</span><span class="spacer"></span>${ico("next")}</div></article>`).join("")}<button class="stage-add" data-act="add-stage" title="新建阶段">${ico("plus")}<span>阶段</span></button></div></div>`;
}

export function speakerOptions(id) {
  return (
    option("", "旁白", id) +
    state.project.characters.map((p) => option(p.id, p.name, id)).join("") +
    option("__new", "＋ 新建角色", id)
  );
}

export function effectButton(id) {
  return `<button class="row-select effect-select" data-select-row="${attr(id)}" aria-pressed="${state.selectedRowIds.has(id)}" title="选择描述行 · Shift 连选 · Ctrl 单选 · Delete 删除" aria-label="选择画面效果描述">·</button>`;
}

export function optionBodyTargets(op) {
  return op.mode !== "jump"
    ? ""
    : `<div class="local-option-target"><select class="cell" data-option-field="chapterId" aria-label="跳转目标章节">${option("", "目标章节", op.chapterId)}${state.project.chapters.map((c) => option(c.id, `${R(c.routeId)?.name || ""} / ${c.title}`, op.chapterId)).join("")}</select><select class="cell" data-option-field="stageId" aria-label="跳转目标阶段">${option("", "章节起始", op.stageId)}${(C(op.chapterId)?.stages || []).map((st) => option(st.id, st.title, op.stageId)).join("")}</select></div>`;
}

export function groupHTML(group, insideOption = false, counter = { value: 0 }) {
  const values = effectiveLocation(group, state.project.locations);
  const collapsed = state.collapsedGroupIds.has(group.id);
  const body = renderSequence(group.rows, insideOption, counter);
  return `<section class="script-row group-row ${state.selectedRowIds.has(group.id) ? "selected" : ""}" data-row="${attr(group.id)}"><div class="scene-group-head"><button class="row-select group-select" aria-label="选择场景组 ${attr(group.title)}" data-select-row="${attr(group.id)}">组</button><button class="scene-group-toggle" data-act="group-toggle" data-id="${attr(group.id)}" aria-expanded="${!collapsed}" title="展开或折叠场景组">${ico(collapsed ? "next" : "down")}</button><button class="scene-group-title" data-act="edit-group" data-id="${attr(group.id)}">${esc(group.title)}</button><span class="scene-group-location">${esc(values.name || "未关联地点")}</span><span class="tiny">${flattenRows(group.rows).filter((row) => row.type !== "group").length} 行</span>${ib("dots", "group-menu", "场景组操作", `data-id="${attr(group.id)}"`)}</div><div class="scene-group-meta">${LOCATION_FIELDS.filter(
    (field) => values[field.key] || Object.hasOwn(group.overrides, field.key),
  )
    .map(
      (field) =>
        `<span>${field.label}：${esc(values[field.key] || "无")}${Object.hasOwn(group.overrides, field.key) ? " · 本组" : ""}</span>`,
    )
    .join(
      "",
    )}${values.properties.map((property) => `<span>${esc(property.name)}：${esc(property.value)}</span>`).join("")}${group.notes ? `<p>${esc(group.notes)}</p>` : ""}</div><div class="scene-group-content ${collapsed ? "hidden" : ""}"><div class="scene-group-rows">${body}</div><div class="row-add-pair"><button class="row-add" data-act="group-add-dialogue" data-id="${attr(group.id)}">${ico("plus")} 对白</button><button class="row-add" data-act="group-add-effect" data-id="${attr(group.id)}">${ico("plus")} 描述</button></div></div></section>`;
}

export function renderSequence(
  rows,
  insideOption = false,
  counter = { value: 0 },
) {
  return rows
    .map((row) => {
      if (row.type === "group") return groupHTML(row, insideOption, counter);
      const number = row.type === "effect" ? -1 : counter.value++;
      return insideOption
        ? branchLineHTML(null, null, row, number)
        : rowHTML(row, number);
    })
    .join("");
}

export function rowHTML(row, i) {
  if (row.type === "group") return groupHTML(row);
  const selected = state.selectedRowIds.has(row.id);
  const num = `<div class="row-number"><span class="drag-handle" data-drag-row="${attr(row.id)}" title="拖动排序">${ico("grip")}</span><button class="row-select" data-select-row="${attr(row.id)}" aria-pressed="${selected}" aria-label="选择第 ${i + 1} 行" title="选择行 · Shift 连选 · Ctrl 单选 · Delete 删除">${String(i + 1).padStart(2, "0")}</button></div>`;
  const menu = `<button class="icon-btn row-menu" data-act="row-menu" data-id="${attr(row.id)}" title="行操作" aria-label="行操作">${ico("dots")}</button>${mobileRowControls(row)}`;
  if (row.type === "effect")
    return `<div class="script-row effect-row ${selected ? "selected" : ""}" data-row="${attr(row.id)}"><div class="effect-gutter">${effectButton(row.id)}</div><textarea class="cell autosize effect-text" rows="1" data-row-field="text" placeholder="画面效果描述" aria-label="画面效果描述">${esc(row.text)}</textarea>${menu}</div>`;
  if (row.type === "note")
    return `<div class="script-row note-row ${selected ? "selected" : ""}" data-row="${attr(row.id)}">${num}<textarea class="cell autosize" rows="1" data-row-field="text" placeholder="笔记" aria-label="笔记">${esc(row.text)}</textarea>${menu}</div>`;
  if (row.type === "branch")
    return `<div class="script-row local-choice-row ${selected ? "selected" : ""}" data-row="${attr(row.id)}">${num}<div class="local-choice-body">
 <div class="local-choice-top">${ico("branch")}<input class="cell local-question" data-row-field="text" value="${attr(row.text)}" placeholder="选择提示" aria-label="选择提示"></div>
 <div class="local-choice-options">${row.options
   .map(
     (
       op,
       idx,
     ) => `<section class="local-option ${state.collapsedOptionIds.has(op.id) ? "collapsed" : ""}" data-option="${attr(op.id)}" data-parent="${attr(row.id)}">
   <div class="local-option-title"><button class="local-fold" data-act="local-toggle" title="展开或折叠" aria-expanded="${!state.collapsedOptionIds.has(op.id)}">${ico("down")}</button><span class="local-branch-label">${String.fromCharCode(65 + idx)}</span><input class="cell" data-option-field="text" value="${attr(op.text)}" placeholder="选项文字" aria-label="选项文字"><select class="cell local-option-mode" data-option-field="mode" aria-label="选项去向" title="此选项播放完后">${option("continue", "合流", op.mode)}${option("jump", "跳转", op.mode)}</select>${ib("dots", "local-option-menu", "选项操作", `data-id="${attr(row.id)}" data-option="${attr(op.id)}"`)}</div>
   <div class="local-option-content">${optionBodyTargets(op)}<div class="local-option-lines">${renderSequence(op.rows || [], true)}</div><div class="local-add-pair"><button class="local-add-line" data-act="branch-add-line" data-id="${attr(row.id)}" data-option="${attr(op.id)}" title="添加对白">${ico("plus")}<span>对白</span></button><button class="local-add-line" data-act="branch-add-effect" data-id="${attr(row.id)}" data-option="${attr(op.id)}" title="添加画面效果描述">${ico("plus")}<span>描述</span></button></div></div>
  </section>`,
   )
   .join("")}</div>
 <div class="local-choice-footer"><button class="local-add-option" data-act="local-add-option" data-id="${attr(row.id)}" title="增加一个选项">${ico("plus")} 选项</button></div>
 </div>${menu}</div>`;
  const p = P(row.speakerId),
    eid = "expr_" + row.id;
  return `<div class="script-row ${selected ? "selected" : ""}" data-row="${attr(row.id)}">${num}<div class="speaker-wrap"><i class="speaker-swatch" style="background:${safeColor(p?.color || "#adb7bb")}"></i><select class="cell" data-row-field="speakerId" aria-label="说话人">${speakerOptions(row.speakerId)}</select></div>${dialogueInputHTML(row)}<div class="expression-wrap"><input class="cell expression-cell" data-row-field="expression" value="${attr(row.expression)}" list="${eid}" placeholder="表情" aria-label="立绘表情"><datalist id="${eid}">${(p?.expressions || []).map((x) => `<option value="${attr(x)}">`).join("")}</datalist></div><div class="action-wrap"><textarea class="cell autosize action-cell" rows="1" data-row-field="action" placeholder="动作" aria-label="人物动作">${esc(row.action)}</textarea>${p?.actions?.length ? `<button class="field-preset" data-act="action-presets" data-id="${attr(row.id)}" title="常用动作" aria-label="常用动作">${ico("down")}</button>` : ""}</div>${menu}</div>`;
}

export function branchLineHTML(parent, op, row, i) {
  if (row.type === "group") return groupHTML(row, true);
  const selected = state.selectedRowIds.has(row.id),
    p = P(row.speakerId),
    num = String(i + 1).padStart(2, "0");
  const rowHead =
    row.type === "effect"
      ? effectButton(row.id)
      : `<button class="row-select" data-select-row="${attr(row.id)}" aria-pressed="${selected}" title="选择此行 · Shift 连选 · Ctrl 单选" aria-label="选择分支对白 ${i + 1}">${num}</button>`;
  const menu = `<button class="icon-btn branch-row-menu" data-act="branch-row-menu" data-id="${attr(row.id)}" title="行操作" aria-label="行操作">${ico("dots")}</button>${mobileRowControls(row)}`;
  if (row.type === "effect")
    return `<div class="branch-script-row branch-effect ${selected ? "selected" : ""}" data-branch-row="${attr(row.id)}"><div class="branch-gutter">${rowHead}</div><textarea class="cell autosize effect-text" data-branch-field="text" rows="1" placeholder="画面效果描述" aria-label="画面效果描述">${esc(row.text)}</textarea>${menu}</div>`;
  if (row.type === "note")
    return `<div class="branch-script-row branch-note ${selected ? "selected" : ""}" data-branch-row="${attr(row.id)}"><div class="branch-gutter">${rowHead}</div><textarea class="cell autosize" data-branch-field="text" rows="1" placeholder="笔记">${esc(row.text)}</textarea>${menu}</div>`;
  const eid = "expr_" + row.id;
  return `<div class="branch-script-row ${selected ? "selected" : ""}" data-branch-row="${attr(row.id)}"><div class="branch-gutter">${rowHead}</div><div class="speaker-wrap"><i class="speaker-swatch" style="background:${safeColor(p?.color || "#adb7bb")}"></i><select class="cell" data-branch-field="speakerId" aria-label="说话人">${speakerOptions(row.speakerId)}</select></div>${dialogueInputHTML(row, true)}<div class="expression-wrap"><input class="cell expression-cell" data-branch-field="expression" value="${attr(row.expression)}" list="${eid}" placeholder="表情" aria-label="立绘表情"><datalist id="${eid}">${(p?.expressions || []).map((x) => `<option value="${attr(x)}">`).join("")}</datalist></div><div class="action-wrap"><textarea class="cell autosize action-cell" rows="1" data-branch-field="action" placeholder="动作" aria-label="人物动作">${esc(row.action)}</textarea>${p?.actions?.length ? `<button class="field-preset" data-act="branch-action-presets" data-id="${attr(row.id)}" title="常用动作">${ico("down")}</button>` : ""}</div>${menu}</div>`;
}

export function stageScriptTable(rows) {
  return `<div class="script-table"><div class="script-table-head"><span></span><span>说话人</span><span>对白</span><span>立绘表情</span><span>人物动作</span><span></span></div><div class="script-rows">${renderSequence(rows)}</div><div class="row-add-pair"><button class="row-add" data-act="add-row" title="新增对白 · Alt Enter">${ico("plus")}<span>对白</span></button><button class="row-add" data-act="add-effect" title="新增画面效果描述">${ico("plus")}<span>描述</span></button></div></div>`;
}

export function renderStage(e) {
  const c = currentChapter(),
    s = currentStage(),
    investigation = s.kind === "investigation",
    opened = investigation ? currentInvestigationItem() : null;
  const header =
    crumbs([
      { text: "路线图", act: "board" },
      { text: R(c.routeId)?.name || "" },
      { text: c.title, act: "open-chapter", id: c.id },
      { text: s.title },
    ]) +
    `<div class="stage-header"><input class="title-edit" value="${attr(s.title)}" data-bind="stage-title" aria-label="阶段标题" maxlength="300"><div class="view-actions"><span class="count desktop-only">${branchRowCount(s)} 行 · ${textCount(s)} 字</span>${ib("note", "stage-notes", "阶段笔记")}${ib("eye", "read-stage", "阅读本阶段")}${investigation ? "" : btn("对白", "plus", "add-row", "primary")}${ib("dots", "script-menu", "脚本操作")}</div></div><div class="stage-tabs">${c.stages.map((st, j) => `<button class="stage-tab ${st.id === s.id ? "active" : ""}" data-act="open-stage" data-id="${attr(st.id)}" title="${attr(st.title)}">${String(j + 1).padStart(2, "0")} &nbsp; ${esc(st.title)}</button>`).join("")}${ib("plus", "add-stage", "新建阶段")}</div>${investigation ? "" : '<div class="selection-toolbar" id="selection-toolbar" hidden></div>'}`;
  const body = investigation
    ? investigationCanvas(s, opened, investigationScript)
    : `<div class="script-scroll">${stageScriptTable(s.rows)}</div>`;
  e.innerHTML = header + body;
  if (investigation) {
    setupInvestigationCanvas(e, s, investigationAddMenu);
    const viewport = $(".investigation-viewport", e);
    const activate = (event) => {
      const editor = event.target.closest("[data-inspect-item]");
      if (!editor || !selectInvestigationItem(editor.dataset.inspectItem)) return;
      $$(".investigation-card", viewport).forEach((card) =>
        card.classList.toggle("is-selected", card.dataset.investigationCard === editor.dataset.inspectItem),
      );
      syncRowSelection();
    };
    viewport.addEventListener("pointerdown", activate, true);
    viewport.addEventListener("focusin", activate, true);
  }
  $$(".script-scroll", e).forEach((scroll) => setupRowDrag(scroll));
  syncRowSelection();
}

function investigationScript(stage, item) {
  const script = currentInvestigationScript(item);
  const defaultScript = item === script;
  const name = inspectName(item);
  return `<section class="investigation-writing" data-inspect-item="${attr(item.id)}" aria-label="${attr(name + "的调查脚本")}">
    <div class="investigation-script-head">
      <div class="investigation-script-actions">
        <select class="input investigation-script-select" aria-label="交互脚本">${option("", item.fallbackEnabled ? "默认脚本" : "默认脚本（已停用）", defaultScript ? "" : script.id)}${item.interactions.map((rule, index) => option(rule.id, (index + 1) + ". " + rule.name, script.id)).join("")}</select>
        ${ib("settings", "inspect-rule-settings", defaultScript ? "默认交互设置" : "编辑交互规则")}
        ${btn("交互规则", "plus", "inspect-rule-add")}
        ${ib("dots", "script-menu", "脚本操作")}
      </div>
    </div>
    ${!defaultScript ? `<p class="investigation-active-rule" title="${attr(describeInvestigationRule(stage, script))}">${esc(describeInvestigationRule(stage, script))}</p>` : ""}
    <div class="script-scroll investigation-script-scroll">
      ${item.notes && defaultScript ? `<div class="inspect-notes">${esc(item.notes)}</div>` : ""}
      ${stageScriptTable(script.rows)}
    </div>
  </section>`;
}

export function renderCharacters(e) {
  e.innerHTML = `<div class="view-head"><div class="view-title"><button class="icon-btn" data-act="board" title="路线图">${ico("back")}</button><h1>角色</h1><span class="count">${state.project.characters.length}</span></div><div class="view-actions">${btn("地点", "map", "locations", "ghost")}${btn("角色", "plus", "add-character", "primary")}</div></div><div class="page-scroll"><div class="characters-grid">${state.project.characters
    .map(
      (p) =>
        `<article class="character-card" data-act="edit-character" data-id="${attr(p.id)}" tabindex="0"><div class="character-head"><div class="avatar" style="background:${safeColor(p.color)}18;color:${safeColor(p.color)}">${esc(p.name[0] || "角")}</div><h2>${esc(p.name)}</h2></div>${p.notes ? `<p>${esc(p.notes)}</p>` : ""}<div class="character-tags">${p.expressions
          .slice(0, 6)
          .map((x) => `<span class="tag">${esc(x)}</span>`)
          .join("")}</div></article>`,
    )
    .join(
      "",
    )}<button class="stage-add" data-act="add-character">${ico("plus")}<span>角色</span></button></div></div>`;
}

export function autoSize(el) {
  el.style.height = "auto";
  el.style.height =
    Math.max(
      el.classList.contains("effect-text") ? 27 : 35,
      el.scrollHeight + 2,
    ) + "px";
}
