import { uid } from "./primitives.js";
import { investigationItems, investigationScripts } from "./investigation.js";

export const LOCATION_FIELDS = [
  { key: "background", label: "背景" },
  { key: "bgm", label: "BGM" },
  { key: "ambience", label: "环境音" },
];

export function locationPreset(name = "") {
  return { id: uid("location"), name, background: "", bgm: "", ambience: "", notes: "", properties: [] };
}

export function sceneGroup(rows, title = "新场景组") {
  return {
    id: uid("group"),
    type: "group",
    title,
    locationId: "",
    notes: "",
    overrides: {},
    rows,
  };
}

export function rowChildren(row) {
  if (row.type === "group") return [row.rows || []];
  if (row.type === "branch")
    return (row.options || []).map((option) => option.rows || []);
  return [];
}

export function walkRows(rows, visit, ancestors = [], option = null) {
  for (const row of rows || []) {
    visit({ row, rows, ancestors, option, parent: ancestors.at(-1) || null });
    if (row.type === "group")
      walkRows(row.rows, visit, [...ancestors, row], option);
    if (row.type === "branch")
      for (const opt of row.options || [])
        walkRows(opt.rows, visit, [...ancestors, row], opt);
  }
}

/** @returns {{row:any,rows:any[],ancestors:any[],option:any,parent:any,opt:any}|null} */
export function findRow(rows, id) {
  let result = null;
  walkRows(rows, (location) => {
    if (location.row.id === id) result = { ...location, opt: location.option };
  });
  return result;
}

export function selectedRoots(rows, selected) {
  const result = [];
  walkRows(rows, (loc) => {
    if (
      selected.has(loc.row.id) &&
      !loc.ancestors.some((parent) => selected.has(parent.id))
    )
      result.push(loc);
  });
  return result;
}

export function groupSelection(rows, selected) {
  const locations = selectedRoots(rows, selected);
  if (!locations.length) throw Error("请先选择要建组的连续行");
  const container = locations[0].rows;
  if (locations.some((loc) => loc.rows !== container))
    throw Error("请在同一段脚本中选择连续行");
  if (
    locations.some((loc) =>
      loc.ancestors.some((parent) => parent.type === "group"),
    )
  )
    throw Error("场景组采用单层结构，请先解除已有分组");
  const indexes = locations
    .map((loc) => container.indexOf(loc.row))
    .sort((a, b) => a - b);
  if (indexes.at(-1) - indexes[0] + 1 !== indexes.length)
    throw Error("请选中连续行后建组");
  let nested = false;
  for (const loc of locations)
    walkRows([loc.row], (child) => {
      if (child.row.type === "group") nested = true;
    });
  if (nested) throw Error("场景组采用单层结构，请先解除已有分组");
  return {
    rows: container,
    start: indexes[0],
    count: indexes.length,
    selected: container.slice(indexes[0], indexes.at(-1) + 1),
  };
}

/** @returns {{name:string,background:string,bgm:string,ambience:string,properties:Array<{name:string,value:string}>}} */
export function effectiveLocation(group, locations) {
  const preset = (locations || []).find(
    (location) => location.id === group.locationId,
  );
  const values = {};
  for (const { key } of LOCATION_FIELDS)
    values[key] = Object.hasOwn(group.overrides || {}, key)
      ? group.overrides[key]
      : preset?.[key] || "";
  const properties = new Map(
    (preset?.properties || []).map((property) => [
      property.name,
      property.value,
    ]),
  );
  for (const property of group.overrides?.properties || [])
    properties.set(property.name, property.value);
  return {
    name: preset?.name || "",
    ...values,
    properties: [...properties].map(([name, value]) => ({ name, value })),
  };
}

export function projectGroups(project) {
  const groups = [];
  for (const chapter of project.chapters)
    for (const stage of chapter.stages) {
      const containers =
        stage.kind === "investigation"
          ? (stage.objects || []).flatMap(investigationScripts).map((script) => script.rows)
          : [stage.rows];
      for (const rows of containers)
        walkRows(rows, (loc) => {
          if (loc.row.type === "group") groups.push(loc.row);
        });
    }
  return groups;
}

export function locationReferences(project) {
  return [...projectGroups(project), ...investigationItems(project)];
}

export function normalizeProperties(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > 50)
    throw Error("自定义属性应为不超过 50 项的列表");
  const seen = new Set();
  return raw.map((item) => {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!name || name.length > 80 || seen.has(name))
      throw Error("自定义属性名称不能为空或重复");
    seen.add(name);
    return { name, value: typeof item.value === "string" ? item.value : "" };
  });
}
