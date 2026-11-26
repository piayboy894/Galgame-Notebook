import {
  canInheritInvestigation,
  inheritedInvestigationScript,
  investigationIdentity,
  investigationIndex,
  linkInvestigation,
} from "../domain/investigation-inheritance.js";
import { investigationObject } from "../domain/project.js";
import { findRow } from "../domain/scenes.js";
import { $, $$, R, attr, btn, currentChapter, currentStage, esc, inspectName, option, state } from "./context.js";
import { closeModal, modal } from "./dialogs.js";
import {
  revealInvestigationPosition, selectInvestigationCards, suggestInvestigationPosition,
} from "./investigation-canvas.js";
import { currentInvestigationItem, go, mutate, rowLocation, selectInvestigationItem, toast } from "./session.js";

const stageLabel = ({ stage, chapter }) =>
  [R(chapter.routeId)?.name, chapter.title, stage.title].filter(Boolean).join(" / ");

function sourceChoices(index, stageId, value) {
  return [...index.stages.values()].filter(({ stage }) => stage.id !== stageId)
    .map((entry) => option(entry.stage.id, stageLabel(entry), value)).join("");
}

function sourceFor(stage, item, matchName = false) {
  if (!stage) return null;
  const shared = stage.objects.filter((card) => card.poolId === item.poolId);
  if (shared.length) return shared.length === 1 ? shared[0] : null;
  if (!matchName) return null;
  const sameName = stage.objects.filter((card) => inspectName(card) === inspectName(item) &&
    card.characterId === item.characterId &&
    Boolean(card.temporaryCharacter) === Boolean(item.temporaryCharacter));
  return sameName.length === 1 ? sameName[0] : null;
}

function recentSource(stage, item) {
  const chapter = currentChapter();
  const earlier = state.project.chapters.filter((entry) => entry.routeId === chapter.routeId)
    .sort((a, b) => a.y - b.y).flatMap((entry) => entry.stages);
  for (let at = earlier.indexOf(stage) - 1; at >= 0; at--) {
    if (earlier[at].kind !== "investigation") continue;
    const found = sourceFor(earlier[at], item);
    if (found) return found;
  }
  return null;
}

export function investigationPoolDialog(position = null) {
  const stage = currentStage();
  const index = investigationIndex(state.project);
  const placed = new Set(stage.objects.map((item) => item.poolId));
  const entries = state.project.investigationPool.filter((item) => !placed.has(item.id));
  const selected = new Set();
  const defaultSource = index.stages.get(stage.investigationSourceId);
  modal("调查卡池", `
    <div class="field"><label for="investigation-pool-search">搜索物品或人物</label><input class="input" id="investigation-pool-search" type="search" autofocus></div>
    <div class="investigation-pool-list" id="investigation-pool-list"></div>
    <p class="investigation-form-help">${defaultSource ? "本阶段默认继承 " + esc(stageLabel(defaultSource)) : "添加后沿用同一路线最近一次出现时的对白。"} ${btn("设置默认来源", null, "inspect-inheritance-default", "small ghost")}</p>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="investigation-pool-add" disabled>放入当前阶段</button>',
  );
  const field = $("#investigation-pool-search");
  const list = $("#investigation-pool-list");
  const add = $("#investigation-pool-add");
  function draw() {
    const items = entries.filter((item) => inspectName(item).toLowerCase().includes(field.value.trim().toLowerCase()));
    list.innerHTML = items.map((item) => {
      const placedItem = { ...item, poolId: item.id };
      const source = defaultSource ? sourceFor(defaultSource.stage, placedItem) : recentSource(stage, placedItem);
      const appearance = source ? index.placements.get(source.id) :
        [...index.placements.values()].find(({ item: card }) => card.poolId === item.id);
      const detail = appearance ? (source ? "继承自 " : "出现于 ") + stageLabel(appearance) : "尚未摆放";
      return `<label><input type="checkbox" value="${attr(item.id)}" ${selected.has(item.id) ? "checked" : ""}><span><strong>${esc(inspectName(item))}</strong><small>${esc(detail)}</small></span></label>`;
    }).join("") || '<p class="investigation-form-help">暂无可添加的卡片。</p>';
  }
  field.oninput = draw;
  list.onchange = ({ target }) => {
    if (target.checked) selected.add(target.value);
    else selected.delete(target.value);
    add.disabled = !selected.size;
  };
  draw();
  add.onclick = () => {
    const cards = entries.filter((entry) => selected.has(entry.id)).map((entry) => ({
      ...investigationObject(entry.name), ...investigationIdentity(entry), poolId: entry.id,
    }));
    if (!cards.length) return;
    const sources = cards.map((item) => defaultSource ? sourceFor(defaultSource.stage, item) : recentSource(stage, item));
    mutate(() => {
      for (const item of cards) {
        item.position = suggestInvestigationPosition(stage, position);
        stage.objects.push(item);
      }
      const nextIndex = investigationIndex(state.project);
      cards.forEach((item, index) => {
        if (sources[index]) {
          item.locationId = sources[index].locationId;
          linkInvestigation(nextIndex, stage, item, sources[index]);
        }
      });
      selectInvestigationItem(cards[0].id);
      selectInvestigationCards(cards.map((item) => item.id));
      revealInvestigationPosition(stage, cards[0].position);
    });
    closeModal();
    $(".investigation-viewport")?.focus({ preventScroll: true });
    const inherited = sources.filter(Boolean).length;
    toast(`已放入 ${cards.length} 张卡片 · ${inherited} 张继承对白`);
  };
}

export function investigationInheritanceDialog(ids = null) {
  const stage = currentStage();
  const index = investigationIndex(state.project);
  const targets = ids ? stage.objects.filter((item) => ids.has(item.id)) : [];
  if (ids && !targets.length) return toast("请先框选物品或人物");
  const linkedSource = index.placements.get(targets[0]?.inheritance?.sourceId);
  const value = ids ? linkedSource?.stage.id || stage.investigationSourceId || "" : stage.investigationSourceId || "";
  modal(ids ? "继承调查对白" : "本阶段默认来源",
    `<div class="field"><label for="investigation-source">来源章节与调查阶段</label><select class="input" id="investigation-source" autofocus>${option("", ids ? "请选择来源" : "本路线最近一次出现", value)}${sourceChoices(index, stage.id, value)}</select></div>
    ${ids ? `<div class="investigation-inheritance-options">
      <p class="investigation-form-help">现有对白会保留，来源中独有的对白和交互会补上。</p>
      <label><input type="checkbox" id="investigation-match-name"> 将唯一同名的旧卡片关联到同一个池条目</label>
      <label><input type="checkbox" id="investigation-replace-local"> 恢复为来源对白，清除本阶段覆盖</label>
      <div id="investigation-inheritance-preview" aria-live="polite"></div>
    </div>` : '<p class="investigation-form-help">用于此后从卡池放入的卡片。你也可以框选现有卡片，单独指定来源。</p>'}`,
    btn("取消", null, "modal-close") + '<button class="btn primary" id="investigation-inherit-save">应用</button>',
  );
  const chooser = $("#investigation-source");
  const matchName = $("#investigation-match-name");
  const replace = $("#investigation-replace-local");
  const save = $("#investigation-inherit-save");
  let matches = [];
  function update() {
    if (!ids) return;
    const source = index.stages.get(chooser.value)?.stage;
    const results = targets.map((item) => ({
      item, from: sourceFor(source, item, matchName.checked),
    }));
    const proposed = { ...index, placements: new Map(index.placements) };
    for (const { item, from } of results) {
      if (!from) continue;
      proposed.placements.set(item.id, {
        ...index.placements.get(item.id), item: { ...item, inheritance: { sourceId: from.id } },
      });
    }
    for (const result of results)
      if (result.from && !canInheritInvestigation(proposed, result.item.id, result.from.id))
        result.from = null;
    matches = results.filter(({ from }) => from);
    $("#investigation-inheritance-preview").innerHTML = `
      <p class="investigation-form-help">${matches.length} / ${targets.length} 张可继承。来源缺少对应卡片或会形成循环时跳过。</p>
      <ul>${results.map(({ item, from }) => `<li>${esc(inspectName(item))} · ${from ? "跟随来源" : "保留当前对白"}</li>`).join("")}</ul>`;
    save.disabled = !matches.length;
  }
  chooser.onchange = update;
  if (matchName) matchName.onchange = update;
  update();
  save.onclick = () => {
    if (currentStage() !== stage) return;
    mutate(() => {
      if (!ids) {
        if (chooser.value) stage.investigationSourceId = chooser.value;
        else delete stage.investigationSourceId;
        return;
      }
      for (const { item, from } of matches) item.poolId = from.poolId;
      for (const { item, from } of matches)
        if (item.inheritance?.sourceId !== from.id || replace.checked)
          linkInvestigation(index, stage, item, from, !replace.checked);
    });
    closeModal();
    toast(ids ? `已设置 ${matches.length} 张卡片的来源` : "已保存默认来源");
  };
}

export function investigationInheritanceItems(ids) {
  const items = currentStage().objects.filter((item) => ids.has(item.id));
  return [
    {
      label: items.length > 1 ? "批量继承对白…" : "设置对白来源…",
      icon: "link",
      disabled: !items.length,
      click: () => investigationInheritanceDialog(ids),
    },
    ...(items.some((item) => item.inheritance) ? [{
      label: "解除继承并保留当前对白",
      icon: "close",
      click: () => {
        mutate(() => items.forEach((item) => { delete item.inheritance; }));
        toast("已保留当前对白，后续可独立编辑");
      },
    }] : []),
  ];
}

export function investigationSourceLabel(item) {
  if (!item.inheritance) return "";
  const source = investigationIndex(state.project).placements.get(item.inheritance.sourceId);
  return source ? stageLabel(source) : "";
}

export function openInvestigationSource() {
  const item = currentInvestigationItem();
  const source = investigationIndex(state.project).placements.get(item?.inheritance?.sourceId);
  if (!source) return;
  state.expandedInvestigationItems.add(source.item.id);
  go("stage", source.chapter.id, source.stage.id);
  $$(`[data-investigation-card="${CSS.escape(source.item.id)}"] .inspect-open`)[0]?.click();
}

export function restoreInvestigationRowItem(id) {
  const item = currentInvestigationItem();
  if (!item?.inheritance) return [];
  const loc = rowLocation(id);
  const inherited = inheritedInvestigationScript(investigationIndex(state.project), item);
  const source = [inherited, ...(inherited?.interactions || [])]
    .map((script) => findRow(script?.rows || [], id)?.row).find(Boolean);
  const includesRow = (path) => path.split(".").includes(id);
  const pinned = item.inheritance.overrides?.some(includesRow);
  if (!loc || !source || (!pinned && JSON.stringify(loc.row) === JSON.stringify(source))) return [];
  return [{
    label: "恢复此行的继承内容",
    icon: "undo",
    click: () => mutate(() => {
      loc.rows.splice(loc.rows.indexOf(loc.row), 1, source);
      if (item.inheritance.overrides)
        item.inheritance.overrides = item.inheritance.overrides.filter((path) => !includesRow(path));
    }),
  }];
}
