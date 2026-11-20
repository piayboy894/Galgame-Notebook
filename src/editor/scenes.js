import { hasCopiedRows } from "./clipboard.js";
import { copyRowsButton, moveRowDialog, pasteRowsButton, rowInsertionItems } from "./row-operations.js";
import {
  LOCATION_FIELDS,
  effectiveLocation,
  groupSelection,
  locationPreset,
  locationReferences,
  normalizeProperties,
  sceneGroup,
} from "../domain/scenes.js";
import { flattenRows, regenRowIds } from "../domain/project.js";
import { uid, clone } from "../domain/primitives.js";
import { $, attr, btn, esc, ico, option, state } from "./context.js";
import { currentRows, mutate, rowLocation, toast } from "./session.js";
import { closeModal, confirmBox, menu, modal } from "./dialogs.js";

function propertyText(properties) {
  return (properties || [])
    .map((item) => item.name + " = " + item.value)
    .join("\n");
}
function readProperties(value) {
  return normalizeProperties(
    value
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const split = line.indexOf("=");
        if (split < 1) throw Error("自定义属性请按「名称 = 值」填写，每行一项");
        return {
          name: line.slice(0, split).trim(),
          value: line.slice(split + 1).trim(),
        };
      }),
  );
}

export function renderLocations(element) {
  const referenceCounts = new Map();
  for (const group of locationReferences(state.project))
    referenceCounts.set(
      group.locationId,
      (referenceCounts.get(group.locationId) || 0) + 1,
    );
  element.innerHTML = `<div class="view-head"><div class="view-title"><button class="icon-btn" data-act="board" title="路线图">${ico("back")}</button><h1>地点预设</h1><span class="count">${state.project.locations.length}</span></div><div class="view-actions">${btn("角色", "users", "characters", "ghost")}${btn("地点", "plus", "add-location", "primary")}</div></div><div class="page-scroll"><div class="characters-grid">${state.project.locations.map((location) => `<article class="character-card location-card" data-act="edit-location" data-id="${attr(location.id)}" tabindex="0"><h2>${esc(location.name)}</h2><dl>${LOCATION_FIELDS.map((field) => `<div><dt>${field.label}</dt><dd>${esc(location[field.key] || "未设置")}</dd></div>`).join("")}</dl>${location.notes ? `<p>${esc(location.notes)}</p>` : ""}<span class="tiny">${referenceCounts.get(location.id) || 0} 处引用</span></article>`).join("")}<button class="stage-add" data-act="add-location">${ico("plus")}<span>地点</span></button></div></div>`;
}

export function locationDialog(id = null) {
  const location = id
    ? state.project.locations.find((item) => item.id === id)
    : locationPreset();
  if (!location) return;
  modal(
    id ? "编辑地点" : "新地点",
    `<div class="field"><label for="location-name">地点名称</label><input class="input" id="location-name" value="${attr(location.name)}" maxlength="120" autofocus></div>${LOCATION_FIELDS.map((field) => `<div class="field"><label for="location-${field.key}">${field.label}</label><input class="input" id="location-${field.key}" value="${attr(location[field.key])}" placeholder="资源名称或路径"></div>`).join("")}<div class="field"><label for="location-notes">地点备注</label><textarea class="input" id="location-notes" rows="3">${esc(location.notes)}</textarea></div><div class="field"><label for="location-properties">自定义属性 <span class="tiny">每行「名称 = 值」</span></label><textarea class="input" id="location-properties" rows="3" placeholder="时间 = 夜晚">${esc(propertyText(location.properties))}</textarea></div>${id ? '<div class="danger-zone"><span></span><button class="btn danger small" id="location-delete">删除地点</button></div>' : ""}`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="location-save">保存地点</button>',
  );
  $("#location-save").onclick = () => {
    const name = $("#location-name").value.trim();
    if (!name) return toast("请输入地点名称", true);
    if (
      state.project.locations.some(
        (item) => item.id !== id && item.name === name,
      )
    )
      return toast("已有同名地点", true);
    let properties;
    try {
      properties = readProperties($("#location-properties").value);
    } catch (error) {
      return toast(error.message, true);
    }
    const changes = { name, properties, notes: $("#location-notes").value };
    for (const field of LOCATION_FIELDS)
      changes[field.key] = $("#location-" + field.key).value;
    mutate(() => {
      Object.assign(location, changes);
      if (!id) state.project.locations.push(location);
    });
    closeModal();
  };
  if (id)
    $("#location-delete").onclick = () => {
      const count = locationReferences(state.project).filter(
        (group) => group.locationId === id,
      ).length;
      if (count)
        return toast(
          `这个地点仍有 ${count} 处引用，请先更换或移除相关地点`,
          true,
        );
      confirmBox(
        "删除地点",
        `删除「${location.name}」？`,
        () =>
          mutate(() => {
            state.project.locations = state.project.locations.filter(
              (item) => item.id !== id,
            );
          }),
        true,
      );
    };
}

export function groupDialog(id = null) {
  if (!id && state.selectedRowIds.size === 1) {
    const selected = rowLocation([...state.selectedRowIds][0])?.row;
    if (selected?.type === "group") id = selected.id;
  }
  let selection, group;
  if (id) {
    group = rowLocation(id)?.row;
    if (group?.type !== "group") return;
  } else {
    try {
      selection = groupSelection(currentRows(), state.selectedRowIds);
    } catch (error) {
      return toast(error.message, true);
    }
    group = sceneGroup([], "新场景组");
  }
  const draft = clone(group);
  modal(
    id ? "编辑场景组" : "建立场景组",
    `<div class="field"><label for="group-title">场景组名称</label><input class="input" id="group-title" value="${attr(group.title)}" maxlength="200" autofocus></div><div class="field"><label for="group-location">地点预设</label><select class="input" id="group-location">${option("", "不关联地点", group.locationId)}${state.project.locations.map((location) => option(location.id, location.name, group.locationId)).join("")}</select><small class="tiny">地点预设在路线图的「地点」中管理。</small></div><div class="field"><label for="group-notes">本段地点与场景备注</label><textarea class="input" id="group-notes" rows="3" placeholder="例如：书房窗边，主角站在门口">${esc(group.notes)}</textarea></div><div class="group-overrides">${LOCATION_FIELDS.map((field) => `<div class="field"><label><input type="checkbox" id="group-override-${field.key}" ${Object.hasOwn(group.overrides, field.key) ? "checked" : ""}> 单独设置${field.label}</label><input class="input" id="group-value-${field.key}" value="${attr(group.overrides[field.key] || "")}" ${Object.hasOwn(group.overrides, field.key) ? "" : "disabled"}></div>`).join("")}</div><div class="field"><label><input type="checkbox" id="group-override-properties" ${Object.hasOwn(group.overrides, "properties") ? "checked" : ""}> 单独设置自定义属性</label><textarea class="input" id="group-properties" rows="3" placeholder="仅填写需覆盖的属性，例如：时间 = 深夜。其他属性沿用地点。" ${Object.hasOwn(group.overrides, "properties") ? "" : "disabled"}>${esc(propertyText(group.overrides.properties || []))}</textarea></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="group-save">保存场景组</button>',
  );
  const refresh = () => {
    draft.locationId = $("#group-location").value;
    const values = effectiveLocation(
      { ...draft, overrides: {} },
      state.project.locations,
    );
    for (const field of LOCATION_FIELDS) {
      const input = $("#group-value-" + field.key);
      input.disabled = !$("#group-override-" + field.key).checked;
      input.placeholder = "沿用地点：" + (values[field.key] || "未设置");
    }
  };
  $("#group-override-properties").onchange = () => {
    $("#group-properties").disabled = !$("#group-override-properties").checked;
  };
  $("#group-location").onchange = refresh;
  for (const field of LOCATION_FIELDS)
    $("#group-override-" + field.key).onchange = refresh;
  refresh();
  $("#group-save").onclick = () => {
    const title = $("#group-title").value.trim();
    if (!title) return toast("请输入场景组名称", true);
    const changes = {
      title,
      locationId: $("#group-location").value,
      notes: $("#group-notes").value,
      overrides: {},
    };
    for (const field of LOCATION_FIELDS)
      if ($("#group-override-" + field.key).checked)
        changes.overrides[field.key] = $("#group-value-" + field.key).value;
    if ($("#group-override-properties").checked) {
      try {
        changes.overrides.properties = readProperties(
          $("#group-properties").value,
        );
      } catch (error) {
        return toast(error.message, true);
      }
    }
    mutate(() => {
      Object.assign(group, changes);
      if (!id) {
        group.rows = selection.rows.splice(
          selection.start,
          selection.count,
          group,
        );
        state.selectedRowIds = new Set([group.id]);
        state.selectionAnchor = group.id;
      }
    });
    closeModal();
  };
}

export function ungroup(id) {
  const loc = rowLocation(id);
  if (loc?.row.type !== "group") return;
  mutate(() => {
    loc.rows.splice(loc.rows.indexOf(loc.row), 1, ...loc.row.rows);
    state.selectedRowIds = new Set(loc.row.rows.map((row) => row.id));
  });
  toast("已解除分组，内容与顺序已保留");
}

export function groupMenu(id, anchor) {
  const loc = rowLocation(id);
  if (loc?.row.type !== "group") return;
  menu(anchor, [
    ...rowInsertionItems(id),
    null,
    { label: "编辑场景组", icon: "edit", click: () => groupDialog(id) },
    { label: "取消分组，保留内容", icon: "layers", click: () => ungroup(id) },
    {
      label: "复制场景组",
      icon: "copy",
      click: () => copyRowsButton(new Set([id])),
    },
    {
      label: "粘贴到场景组下方",
      icon: "layers",
      disabled: !hasCopiedRows(),
      click: () => pasteRowsButton(new Set([id])),
    },
    {
      label: "在下方创建副本",
      icon: "copy",
      click: () => {
        const copied = regenRowIds(clone(loc.row));
        copied.title += " 副本";
        mutate(() => loc.rows.splice(loc.rows.indexOf(loc.row) + 1, 0, copied));
      },
    },
    { label: "移至其他阶段", icon: "layers", click: () => moveRowDialog(id) },
    null,
    {
      label: "删除场景组及内容",
      icon: "trash",
      danger: true,
      click: () =>
        confirmBox(
          "删除场景组",
          `删除「${loc.row.title}」及其中 ${flattenRows(loc.row.rows).filter((row) => row.type !== "group").length} 行内容？`,
          () => mutate(() => loc.rows.splice(loc.rows.indexOf(loc.row), 1)),
          true,
        ),
    },
  ]);
}
