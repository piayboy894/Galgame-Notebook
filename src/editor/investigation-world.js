import { investigationIndex } from "../domain/investigation-inheritance.js";
import {
  canContinueInvestigationWorld, isInvestigationPresent, presentInvestigationItems,
} from "../domain/investigation-world.js";
import { $, $$, R, attr, btn, currentStage, esc, inspectName, option, state } from "./context.js";
import { closeModal, modal } from "./dialogs.js";
import { selectInvestigationCards } from "./investigation-canvas.js";
import { mutate, toast } from "./session.js";

export const investigationStageLabel = ({ stage, chapter }) =>
  [R(chapter.routeId)?.name, chapter.title, stage.title].filter(Boolean).join(" / ");

export function investigationWorldOptions(stage, value, independent = "独立调查（自己安排在场名单）") {
  const index = investigationIndex(state.project);
  return option("", independent, value) + [...index.stages.values()]
    .filter((entry) => canContinueInvestigationWorld(index, stage, entry.stage))
    .map((entry) => option(entry.stage.id, investigationStageLabel(entry), value)).join("");
}

export function investigationWorldMenu(ids) {
  const stage = currentStage();
  const items = presentInvestigationItems(stage).filter((item) => ids.has(item.id));
  if (!items.length) return [];
  const carried = items.filter((item) => item.world?.from);
  return [
    {
      label: items.length > 1 ? "所选卡片在本阶段离场" : "本阶段离场",
      icon: "eye",
      click: () => {
        mutate(() => {
          for (const item of items) {
            (item.world ||= {}).presence = "away";
            state.expandedInvestigationItems.delete(item.id);
          }
          selectInvestigationCards([]);
        });
        toast("已设为离场，可在「世界状态」中恢复");
      },
    },
    ...(carried.length ? [{
      label: "本阶段从第 1 次调查开始",
      icon: "undo",
      disabled: carried.every((item) => item.world.resetVisits),
      click: () => mutate(() => {
        for (const item of carried) item.world.resetVisits = true;
      }),
    }] : []),
    ...(carried.some((item) => item.world.resetVisits) ? [{
      label: "沿用来源阶段的调查次数",
      icon: "link",
      click: () => mutate(() => {
        for (const item of carried) delete item.world.resetVisits;
      }),
    }] : []),
  ];
}

export function investigationWorldDialog() {
  const stage = currentStage();
  if (stage?.kind !== "investigation") return;
  const away = stage.objects.filter((item) => !isInvestigationPresent(item));
  const index = investigationIndex(state.project);
  const source = index.stages.get(stage.worldSourceId);
  modal("调查世界状态", `
    <div class="field"><label for="investigation-world-source">在场名单来源</label>
      <select id="investigation-world-source" class="input">${investigationWorldOptions(stage, stage.worldSourceId || "")}</select>
    </div>
    <p class="investigation-form-help">${source ? "当前延续 " + esc(investigationStageLabel(source)) + "。" : "当前为独立调查。"} 延续在场名单、对白和调查次数。</p>
    <label class="investigation-checkbox" id="investigation-world-match-row" hidden><input type="checkbox" id="investigation-world-match"> 合并两阶段里名称相同且唯一的旧卡片，保留本阶段的改写</label>
    <div class="field"><label>离场卡片（${away.length}）</label>${away.length
      ? `<div class="investigation-pool-list">${away.map((item) => `<label><input type="checkbox" data-world-restore="${attr(item.id)}"><span><strong>${esc(inspectName(item))}</strong><small>${item.world.presence === "away" ? "本阶段明确离场" : "随来源离场"}</small></span></label>`).join("")}</div>
        <small class="investigation-form-help">勾选要恢复在场的卡片。保存后也会出现在延续本阶段的名单里。</small>`
      : '<p class="investigation-form-help">暂无离场卡片。可在画布上右键单张卡片或框选多张后设置。</p>'}</div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="investigation-world-save">保存</button>',
  );
  const chooser = $("#investigation-world-source");
  chooser.onchange = () => {
    $("#investigation-world-match-row").hidden =
      !chooser.value || chooser.value === stage.worldSourceId || !stage.objects.length;
  };
  $("#investigation-world-save").onclick = () => {
    const restore = new Set($$("[data-world-restore]:checked").map((input) => input.dataset.worldRestore));
    const matchNames = chooser.value !== stage.worldSourceId && $("#investigation-world-match").checked;
    mutate(() => {
      if (chooser.value) stage.worldSourceId = chooser.value;
      else delete stage.worldSourceId;
      for (const item of away)
        if (restore.has(item.id)) (item.world ||= {}).presence = "present";
    }, true, matchNames ? stage.id : null);
    closeModal();
    toast("已保存本阶段世界状态");
  };
}
