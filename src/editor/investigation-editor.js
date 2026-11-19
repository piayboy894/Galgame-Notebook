import {
  INVESTIGATION_CARD,
  investigationConditionText,
  investigationRule,
  investigationScripts,
  investigationTiming,
  matchingInvestigationScript,
} from "../domain/investigation.js";
import {
  flattenRows,
  investigationObject,
  newCharacter,
  regenerateInvestigationIds,
} from "../domain/project.js";
import { locationPreset } from "../domain/scenes.js";
import { clone, uid } from "../domain/primitives.js";
import {
  $,
  $$,
  F,
  attr,
  btn,
  currentStage,
  esc,
  inspectLocation,
  inspectName,
  option,
  state,
} from "./context.js";
import { closeModal, confirmBox, menu, modal, previewRow } from "./dialogs.js";
import {
  revealInvestigationElement,
  revealInvestigationPosition,
  suggestInvestigationPosition,
} from "./investigation-canvas.js";
import {
  currentInvestigationItem,
  mutate,
  selectInvestigationItem,
  toast,
} from "./session.js";

export function investigationAddMenu(anchor, position = null) {
  menu(anchor, [
    {
      label: "新建物品",
      icon: "box",
      click: () => inspectObjectDialog(null, position),
    },
    {
      label: "新建人物",
      icon: "users",
      click: () => inspectObjectDialog(null, position, true),
    },
  ]);
}

export function inspectObjectDialog(
  id = null,
  position = null,
  person = false,
) {
  const stage = currentStage();
  if (stage?.kind !== "investigation") return;
  const item = id
    ? stage.objects.find((entry) => entry.id === id)
    : investigationObject("");
  if (!item) return;
  person = person || Boolean(item.characterId);
  const type = person ? "人物" : "物品";
  const entries = person ? state.project.characters : state.project.locations;
  const current = person
    ? item.characterId || (entries.length ? "" : "__new")
    : item.locationId;
  const field = person ? "项目角色" : "地点";
  const entity = person ? "角色" : "地点";
  modal(
    (id ? "编辑" : "新建") + "调查" + type,
    `${person ? "" : `<div class="field"><label for="inspect-name">物品名称</label><input class="input" id="inspect-name" value="${attr(item.name)}" maxlength="160" autofocus></div>`}
    <div class="field"><label for="inspect-reference">${field}</label><select class="input" id="inspect-reference" ${person && entries.length ? "autofocus" : ""}>${option("", person ? "选择已有角色" : "未设地点", current)}${entries.map((entry) => option(entry.id, entry.name, current)).join("")}${option("__new", "新建" + entity + "…", current)}</select></div>
    <div class="field" id="inspect-new-reference" ${current !== "__new" ? "hidden" : ""}><label for="inspect-reference-name">${entity}名称</label><input class="input" id="inspect-reference-name" maxlength="120" ${person && !entries.length ? "autofocus" : ""}></div>
    <div class="field"><label for="inspect-notes">备注</label><textarea class="input" id="inspect-notes" rows="3">${esc(item.notes)}</textarea></div>`,
    btn("取消", null, "modal-close") +
      `<button class="btn primary" id="inspect-save">${id ? "保存" : "创建"}</button>`,
  );
  const reference = $("#inspect-reference");
  reference.onchange = () => {
    const creating = reference.value === "__new";
    $("#inspect-new-reference").hidden = !creating;
    if (creating) $("#inspect-reference-name").focus();
  };
  $("#inspect-save").onclick = () => {
    const name = person ? "" : $("#inspect-name").value.trim();
    if (!person && !name) return toast("请输入物品名称");
    let linked = entries.find((entry) => entry.id === reference.value);
    const creating = reference.value === "__new";
    if (creating) {
      const value = $("#inspect-reference-name").value.trim();
      if (!value) return toast("请输入" + entity + "名称");
      linked =
        entries.find((entry) => entry.name === value) ||
        (person ? newCharacter(value, entries.length) : locationPreset(value));
    }
    if (person && !linked) return toast("请选择或新建角色");
    const notes = $("#inspect-notes").value;
    if (!id) {
      item.position = position || suggestInvestigationPosition(stage);
      if (stage.objects.length)
        revealInvestigationPosition(stage, item.position);
      else state.investigationCameras.delete(stage.id);
    }
    mutate(() => {
      if (creating && !entries.includes(linked)) entries.push(linked);
      item.name = person ? linked.name : name;
      item.notes = notes;
      item.characterId = person ? linked.id : "";
      item.locationId = person ? "" : linked?.id || "";
      if (!id) {
        stage.objects.push(item);
        selectInvestigationItem(item.id);
        state.expandedInvestigationItems.add(item.id);
      }
    });
    closeModal();
    if (!id)
      revealInvestigationElement($(`[data-investigation-card="${item.id}"]`));
  };
}

export function inspectObjectMenu(id, anchor) {
  const stage = currentStage();
  const index = stage?.objects.findIndex((item) => item.id === id) ?? -1;
  const item = stage?.objects[index];
  if (!item) return;
  const type = item.characterId ? "人物卡片" : "物品";
  menu(anchor, [
    {
      label: "编辑" + type,
      icon: "edit",
      click: () => inspectObjectDialog(id),
    },
    {
      label: "复制" + type,
      icon: "copy",
      click: () => {
        const copy = clone(item);
        regenerateInvestigationIds([copy]);
        if (!copy.characterId) copy.name += " · 副本";
        copy.position = suggestInvestigationPosition(stage, {
          x:
            item.position.x + INVESTIGATION_CARD.width + INVESTIGATION_CARD.gap,
          y: item.position.y,
        });
        revealInvestigationPosition(stage, copy.position);
        mutate(() => {
          stage.objects.splice(index + 1, 0, copy);
          selectInvestigationItem(copy.id);
        });
      },
    },
    {
      label: "提前阅读顺序",
      icon: "up",
      disabled: index === 0,
      click: () =>
        mutate(() =>
          stage.objects.splice(index - 1, 0, stage.objects.splice(index, 1)[0]),
        ),
    },
    {
      label: "推后阅读顺序",
      icon: "down",
      disabled: index === stage.objects.length - 1,
      click: () =>
        mutate(() =>
          stage.objects.splice(index + 1, 0, stage.objects.splice(index, 1)[0]),
        ),
    },
    null,
    {
      label: "删除" + type,
      icon: "trash",
      danger: true,
      click: () => {
        const used = stage.objects.find(
          (other) =>
            other !== item &&
            other.interactions.some((rule) =>
              rule.conditions.some(
                (condition) =>
                  condition.type === "investigated" &&
                  condition.targetId === id,
              ),
            ),
        );
        if (used)
          return toast(
            `「${inspectName(used)}」的交互仍在引用这张卡片，请先修改条件`,
            true,
          );
        const remove = () =>
          mutate(() => {
            stage.objects.splice(index, 1);
            if (state.activeInspectObjectId === id)
              selectInvestigationItem(stage.objects[0]?.id || null);
          });
        const rows = investigationScripts(item).flatMap((script) =>
          flattenRows(script.rows),
        );
        if (rows.length || item.interactions.length || item.outcomes.length)
          confirmBox(
            "删除" + type,
            `删除「${inspectName(item)}」及其中的交互与脚本？`,
            remove,
            true,
          );
        else remove();
      },
    },
  ]);
}

function conditionText(stage, condition) {
  return investigationConditionText(
    condition,
    (id) => {
      const item = stage.objects.find((entry) => entry.id === id);
      return item && inspectName(item);
    },
    (id) => F(id)?.name,
  );
}

export function describeInvestigationRule(stage, rule) {
  const parts = [investigationTiming(rule)];
  if (rule.conditions.length)
    parts.push(
      (rule.conditions.length > 1
        ? rule.conditionMode === "any"
          ? "满足任一 "
          : "全部满足 "
        : "") +
        rule.conditions
          .map((condition) => conditionText(stage, condition))
          .join("、"),
    );
  return parts.join(" · ");
}

export function describeInvestigationOutcomes(script) {
  return script.outcomes
    .map((id) => F(id)?.name)
    .filter(Boolean)
    .join("、");
}

const lines = (value) => [
  ...new Set(
    value
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];

export function investigationRuleDialog(id = null, editingDefault = false) {
  const stage = currentStage(),
    item = currentInvestigationItem();
  if (!item) return;
  const rule = editingDefault
    ? item
    : id
      ? item.interactions.find((entry) => entry.id === id)
      : investigationRule();
  if (!rule) return;
  const original = new Map(
    (rule.conditions || []).map((condition) => [
      conditionText(stage, condition),
      condition,
    ]),
  );
  const originalConditions = (rule.conditions || [])
    .map((condition) => conditionText(stage, condition))
    .join("\n");
  const originalOutcomes = new Map(
    rule.outcomes.map((flagId) => [F(flagId)?.name || "（缺失条件）", flagId]),
  );
  const index = item.interactions.indexOf(rule);
  const title = editingDefault
    ? "默认交互设置"
    : id
      ? "编辑交互规则"
      : "新建交互规则";
  modal(
    title,
    `${
      editingDefault
        ? `<label class="investigation-checkbox"><input type="checkbox" id="interaction-fallback" ${item.fallbackEnabled ? "checked" : ""}>无匹配规则时运行默认脚本</label><p class="investigation-form-help">关闭后，需要至少匹配一条规则才能交互。未满足条件的点击不会计入次数。</p>`
        : `<div class="field"><label for="interaction-name">规则名称</label><input class="input" id="interaction-name" value="${attr(rule.name)}" placeholder="拿到钥匙后的对话" maxlength="160" autofocus></div>
        <div class="field-row"><div class="field"><label for="interaction-timing">触发次数</label><select class="input" id="interaction-timing">${option("any", "任意次数", rule.timing)}${option("exact", "仅第 N 次", rule.timing)}${option("from", "第 N 次及以后", rule.timing)}</select></div><div class="field" id="interaction-attempt-field" ${rule.timing === "any" ? "hidden" : ""}><label for="interaction-attempt">第几次</label><input type="number" class="input" id="interaction-attempt" min="1" step="1" value="${rule.attempt}"></div></div>
        <div class="field"><label for="interaction-conditions">触发条件（选填）</label><textarea class="input" id="interaction-conditions" rows="3" placeholder="拿到钥匙&#10;调查过信封">${esc(originalConditions)}</textarea><small class="investigation-form-help">每行一句。输入「调查过信封」可引用名为「信封」的卡片。其他文字可作为自定条件，在演练中切换，也可由另一段交互达成。</small></div>
        <div class="field"><label for="interaction-condition-mode">多条条件如何匹配</label><select class="input" id="interaction-condition-mode">${option("all", "全部满足", rule.conditionMode)}${option("any", "满足任一条", rule.conditionMode)}</select></div>
        ${item.interactions.length > (id ? 1 : 0) ? `<div class="field"><label for="interaction-priority">优先顺序</label><select class="input" id="interaction-priority">${Array.from({ length: item.interactions.length + (id ? 0 : 1) }, (_, rank) => option(String(rank), "第 " + (rank + 1) + " 条", String(id ? index : item.interactions.length))).join("")}</select><small class="investigation-form-help">同时匹配时，使用顺序最靠前的一条。</small></div>` : ""}`
    }
    <div class="field"><label for="interaction-outcomes">交互完成后达成的条件（选填）</label><textarea class="input" id="interaction-outcomes" rows="2" placeholder="拿到钥匙">${esc([...originalOutcomes.keys()].join("\n"))}</textarea><small class="investigation-form-help">每行一句。其他规则可用相同文字作为触发条件。</small></div>
    ${id ? '<button type="button" class="btn danger" id="interaction-delete">删除规则</button>' : ""}`,
    btn("取消", null, "modal-close") +
      `<button class="btn primary" id="interaction-save">${id || editingDefault ? "保存" : "创建"}</button>`,
  );
  if (!editingDefault)
    $("#interaction-timing").onchange = (event) => {
      $("#interaction-attempt-field").hidden = event.target.value === "any";
    };
  if (id) {
    $("#interaction-delete").onclick = () =>
      confirmBox(
        "删除交互规则",
        `删除「${rule.name}」及其专属脚本？`,
        () =>
          mutate(() => {
            item.interactions.splice(index, 1);
            selectInvestigationItem(item.id);
          }),
        true,
      );
  }
  $("#interaction-save").onclick = () => {
    const added = [];
    const flagId = (name) => {
      if (name.length > 200) throw Error("每条条件最多 200 个字");
      const existing = [...state.project.flags, ...added].find(
        (flag) => flag.name === name,
      );
      if (existing) return existing.id;
      const flag = { id: uid("flag"), name, notes: "" };
      added.push(flag);
      return flag.id;
    };
    const changes = {};
    try {
      if (editingDefault)
        changes.fallbackEnabled = $("#interaction-fallback").checked;
      else {
        const timing = $("#interaction-timing").value;
        const attempt =
          timing === "any" ? 1 : $("#interaction-attempt").valueAsNumber;
        const conditionInput = $("#interaction-conditions").value;
        if (!Number.isSafeInteger(attempt) || attempt < 1)
          throw Error("请输入大于 0 的整数次数");
        Object.assign(changes, {
          name:
            $("#interaction-name").value.trim() ||
            investigationTiming({ timing, attempt }),
          timing,
          attempt,
          conditionMode: $("#interaction-condition-mode").value,
          conditions:
            conditionInput === originalConditions
              ? rule.conditions
              : lines(conditionInput).map((text) => {
                  if (original.has(text)) return original.get(text);
                  const cardText = text.match(
                    /^(调查过|已调查|还没调查|未调查)[：:\s]*(.+)$/u,
                  );
                  if (cardText) {
                    const matches = stage.objects.filter(
                      (entry) => inspectName(entry) === cardText[2].trim(),
                    );
                    if (matches.length > 1)
                      throw Error(
                        `「${cardText[2].trim()}」对应多张卡片，请用名称唯一的卡片或自定条件`,
                      );
                    if (matches.length === 1)
                      return {
                        type: "investigated",
                        targetId: matches[0].id,
                        expected: ["调查过", "已调查"].includes(cardText[1]),
                      };
                  }
                  const negative = text.match(/^未达成[：:\s]+(.+)$/u);
                  return {
                    type: "flag",
                    targetId: flagId(negative ? negative[1].trim() : text),
                    expected: !negative,
                  };
                }),
        });
      }
      const outcomes = lines($("#interaction-outcomes").value);
      changes.outcomes = outcomes.map(
        (name) => originalOutcomes.get(name) || flagId(name),
      );
    } catch (error) {
      return toast(error.message, true);
    }
    const priority = $("#interaction-priority")?.value;
    mutate(() => {
      state.project.flags.push(...added);
      Object.assign(rule, changes);
      if (!editingDefault) {
        if (id) item.interactions.splice(index, 1);
        item.interactions.splice(
          priority === undefined ? item.interactions.length : Number(priority),
          0,
          rule,
        );
      }
      selectInvestigationItem(item.id, editingDefault ? null : rule.id);
    });
    closeModal();
    revealInvestigationElement($(`[data-investigation-card="${item.id}"]`));
  };
}

export function rehearseInvestigation() {
  const stage = currentStage();
  if (!stage?.objects.length) return toast("请先新建一张调查卡片");
  const visits = new Map();
  const initialFlags = new Set(state.sim.flags);
  let flags = new Set(initialFlags);
  const knownFlags = new Set(state.project.flags.map((flag) => flag.id));
  const knownItems = new Set(stage.objects.map((item) => item.id));
  let result = "",
    flagsOpen = false;

  function draw(focus = null) {
    modal(
      "演练调查",
      `<div class="investigation-rehearsal">
        <p class="investigation-form-help">点击卡片模拟一次交互。按规则顺序取第一条匹配的脚本，成功后才增加次数。</p>
        <div class="investigation-rehearsal-picks">${stage.objects.map((item) => `<button class="btn" data-investigation-visit="${attr(item.id)}">${esc(inspectName(item))}<small>已交互 ${visits.get(item.id) || 0} 次</small></button>`).join("")}</div>
        ${state.project.flags.length ? `<details id="investigation-rehearsal-flags" ${flagsOpen ? "open" : ""}><summary>演练条件 <span>${state.project.flags.filter((flag) => flags.has(flag.id)).length} 项已达成</span></summary><div class="investigation-rehearsal-flags">${state.project.flags.map((flag) => `<label><input type="checkbox" data-investigation-flag="${attr(flag.id)}" ${flags.has(flag.id) ? "checked" : ""}> ${esc(flag.name)}</label>`).join("")}</div></details>` : ""}
        <div class="readable-preview investigation-rehearsal-result" aria-live="polite">${result || "<p>选择一张卡片开始。</p>"}</div>
      </div>`,
      '<button class="btn" id="investigation-rehearsal-reset">重置演练</button>' +
        btn("完成", null, "modal-close", "primary"),
      true,
    );
    if (focus)
      $(`[data-investigation-visit="${focus}"]`)?.setAttribute("autofocus", "");
    $$("[data-investigation-visit]").forEach((button) => {
      button.onclick = () => {
        const item = stage.objects.find(
          (entry) => entry.id === button.dataset.investigationVisit,
        );
        const attempt = (visits.get(item.id) || 0) + 1;
        const script = matchingInvestigationScript(
          item,
          attempt,
          visits,
          flags,
          knownFlags,
          knownItems,
        );
        if (!script)
          result = `<h3>${esc(inspectName(item))}</h3><p>当前条件未满足，交互次数保持为 ${attempt - 1}。</p>`;
        else {
          visits.set(item.id, attempt);
          const outcomes = script.outcomes.map((id) => F(id)).filter(Boolean);
          for (const flag of outcomes) flags.add(flag.id);
          result = `<h3>${esc(inspectName(item))} · 第 ${attempt} 次 · ${script === item ? "默认脚本" : esc(script.name)}</h3>
            ${outcomes.length ? `<p>已达成 ${esc(outcomes.map((flag) => flag.name).join("、"))}</p>` : ""}
            ${script.rows.length ? script.rows.map(previewRow).join("") : "<p>此交互暂无脚本。</p>"}`;
        }
        flagsOpen = $("#investigation-rehearsal-flags")?.open || false;
        draw(item.id);
      };
    });
    $$("[data-investigation-flag]").forEach((input) => {
      input.onchange = () => {
        if (input.checked) flags.add(input.dataset.investigationFlag);
        else flags.delete(input.dataset.investigationFlag);
        $("#investigation-rehearsal-flags summary span").textContent =
          state.project.flags.filter((flag) => flags.has(flag.id)).length +
          " 项已达成";
      };
    });
    $("#investigation-rehearsal-reset").onclick = () => {
      visits.clear();
      flags = new Set(initialFlags);
      flagsOpen = $("#investigation-rehearsal-flags")?.open || false;
      result = "";
      draw();
    };
  }
  draw();
}
