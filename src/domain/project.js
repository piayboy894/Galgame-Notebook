import { FORMAT, PALETTE, uid, now, safeColor } from "./primitives.js";
import { rowChildren, normalizeProperties, LOCATION_FIELDS } from "./scenes.js";

export function line(type = "dialogue") {
  return {
    id: uid("line"),
    type,
    speakerId: "",
    text: "",
    expression: "",
    action: "",
    options:
      type === "branch"
        ? [
            {
              id: uid("opt"),
              text: "选项 A",
              mode: "continue",
              chapterId: "",
              stageId: "",
              rows: [line()],
            },
            {
              id: uid("opt"),
              text: "选项 B",
              mode: "continue",
              chapterId: "",
              stageId: "",
              rows: [line()],
            },
          ]
        : [],
  };
}
export function flattenRows(rows) {
  return (rows || []).flatMap((row) => [
    row,
    ...rowChildren(row).flatMap(flattenRows),
  ]);
}
export function regenRowIds(row) {
  row.id = uid(row.type === "group" ? "group" : "line");
  if (row.type === "group") row.rows.forEach(regenRowIds);
  else {
    if (!Array.isArray(row.options)) row.options = [];
    for (const option of row.options) {
      option.id = uid("opt");
      option.rows.forEach(regenRowIds);
    }
  }
  return row;
}
export function stageRootRows(s) {
  return s.kind === "investigation"
    ? (s.objects || []).flatMap((item) => item.rows || [])
    : s.rows;
}
export function stageRowsGroups(s) {
  return s.kind === "investigation"
    ? (s.objects || []).map((o) => o.rows || [])
    : [s.rows];
}
export function branchRowCount(s) {
  return flattenRows(stageRootRows(s)).filter((row) => row.type !== "group")
    .length;
}
export function investigationObject(name = "新调查物品") {
  return { id: uid("object"), name, notes: "", rows: [] };
}
export function stage(title = "阶段 01") {
  return {
    id: uid("stage"),
    title,
    notes: "",
    kind: "story",
    rows: [],
    objects: [],
  };
}
export function chapter(routeId, title = "新章节", y = 112) {
  return {
    id: uid("chapter"),
    routeId,
    title,
    summary: "",
    y,
    ending: "continue",
    unlock: { mode: "all", rules: [] },
    stages: [stage()],
  };
}
export function newProject(title = "未命名剧本") {
  const p = {
    format: FORMAT,
    version: 4,
    id: uid("project"),
    title,
    createdAt: now(),
    updatedAt: now(),
    routes: [],
    characters: [],
    locations: [],
    flags: [],
    chapters: [],
  };
  for (let i = 0; i < 3; i++) {
    const r = {
      id: uid("route"),
      name: "路线 " + String.fromCharCode(65 + i),
      color: PALETTE[i],
    };
    p.routes.push(r);
    p.chapters.push(chapter(r.id, "第一章"));
  }
  return p;
}
export function normalizeProject(raw) {
  if (!raw || typeof raw !== "object" || raw.format !== FORMAT)
    throw Error("这不是叙线源文件（.json）");
  if (![1, 2, 3, 4].includes(raw.version))
    throw Error("源文件版本不受支持，请使用兼容的编辑器");
  const ids = new Set();
  const id = (v) => {
    if (typeof v !== "string" || !v.match(/^[a-zA-Z0-9_-]{1,100}$/))
      throw Error("源文件中有无效标识");
    if (ids.has(v)) throw Error("源文件中存在重复标识：" + v);
    ids.add(v);
    return v;
  };
  const str = (v, def = "") => (typeof v === "string" ? v : def);
  const arr = (v) => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) throw Error("源文件结构不完整");
    return v;
  };
  const ref = (v) =>
    typeof v === "string" && /^[a-zA-Z0-9_-]{0,100}$/.test(v) ? v : "";
  const p = {
    format: FORMAT,
    version: 4,
    id: id(raw.id),
    title: str(raw.title, "未命名剧本"),
    createdAt: str(raw.createdAt, now()),
    updatedAt: str(raw.updatedAt, now()),
    routes: [],
    characters: [],
    locations: [],
    flags: [],
    chapters: [],
  };
  p.routes = arr(raw.routes).map((r) => ({
    id: id(r.id),
    name: str(r.name, "未命名路线"),
    color: safeColor(r.color),
  }));
  if (!p.routes.length) throw Error("源文件至少需要一条路线");
  if (p.routes.length > 100) throw Error("路线数量超过安全上限（100）");
  p.characters = arr(raw.characters).map((c) => ({
    id: id(c.id),
    name: str(c.name, "未命名角色"),
    color: safeColor(c.color),
    notes: str(c.notes),
    expressions: arr(c.expressions).filter((x) => typeof x === "string"),
    actions: arr(c.actions).filter((x) => typeof x === "string"),
  }));
  p.locations = arr(raw.locations).map((location) => ({
    id: id(location.id),
    name: str(location.name, "未命名地点"),
    background: str(location.background),
    bgm: str(location.bgm),
    ambience: str(location.ambience),
    notes: str(location.notes),
    properties: normalizeProperties(location.properties),
  }));
  if (p.locations.length > 1000) throw Error("地点数量超过安全上限（1000）");
  p.flags = arr(raw.flags).map((f) => ({
    id: id(f.id),
    name: str(f.name, "未命名条件"),
    notes: str(f.notes),
  }));
  const parseRow = (r, inside = false, inGroup = false, depth = 0) => {
    if (depth > 12) throw Error("脚本结构嵌套过深");
    if (r?.type === "group") {
      if (inGroup) throw Error("场景组采用单层结构，不支持嵌套");
      const overrides = {};
      for (const { key } of LOCATION_FIELDS)
        if (Object.hasOwn(r.overrides || {}, key))
          overrides[key] = str(r.overrides[key]);
      if (Object.hasOwn(r.overrides || {}, "properties"))
        overrides.properties = normalizeProperties(r.overrides.properties);
      const locationId = ref(r.locationId);
      if (
        locationId &&
        !p.locations.some((location) => location.id === locationId)
      )
        throw Error("场景组引用了不存在的地点");
      return {
        id: id(r.id),
        type: "group",
        title: str(r.title, "新场景组"),
        locationId,
        notes: str(r.notes),
        overrides,
        rows: arr(r.rows).map((child) =>
          parseRow(child, inside, true, depth + 1),
        ),
      };
    }
    const rawType = [
      "dialogue",
      "note",
      "effect",
      "branch",
      "choice",
      "localChoice",
    ].includes(r?.type)
      ? r.type
      : "dialogue";
    const type =
      inside && !["dialogue", "note", "effect"].includes(rawType)
        ? "dialogue"
        : ["choice", "localChoice"].includes(rawType)
          ? "branch"
          : rawType;
    const base = {
      id: id(r.id),
      type,
      speakerId: ref(r.speakerId),
      text: str(r.text),
      expression: str(r.expression),
      action: str(r.action),
      options: [],
    };
    if (type === "branch")
      base.options = arr(r.options).map((o) => ({
        id: id(o.id),
        text: str(o.text),
        mode:
          rawType === "choice"
            ? "jump"
            : rawType === "localChoice"
              ? "continue"
              : o.mode === "jump"
                ? "jump"
                : "continue",
        chapterId: ref(o.chapterId),
        stageId: ref(o.stageId),
        rows: arr(o.rows).map((x) => parseRow(x, true, inGroup, depth + 1)),
      }));
    return base;
  };
  p.chapters = arr(raw.chapters).map((c) => {
    const rid = ref(c.routeId);
    if (!p.routes.some((r) => r.id === rid))
      throw Error("章节“" + str(c.title) + "”缺少所属路线");
    return {
      id: id(c.id),
      routeId: rid,
      title: str(c.title, "未命名章节"),
      summary: str(c.summary),
      y:
        typeof c.y === "number" && Number.isFinite(c.y)
          ? Math.max(112, Math.min(100000, c.y))
          : 112,
      ending: ["continue", "pause", "end"].includes(c.ending)
        ? c.ending
        : "continue",
      unlock: {
        mode: c.unlock?.mode === "any" ? "any" : "all",
        rules: arr(c.unlock?.rules).map((r) => {
          if (!["chapter", "stage", "flag"].includes(r.type))
            throw Error("未知的解锁条件类型");
          return {
            id: id(r.id),
            type: r.type,
            targetId: ref(r.targetId),
            expected: r.expected !== false,
          };
        }),
      },
      stages: arr(c.stages).map((st) => ({
        id: id(st.id),
        title: str(st.title, "未命名阶段"),
        notes: str(st.notes),
        kind: st.kind === "investigation" ? "investigation" : "story",
        rows: arr(st.rows).map((r) => parseRow(r)),
        objects: arr(st.objects).map((o) => ({
          id: id(o.id),
          name: str(o.name, "未命名物品"),
          notes: str(o.notes),
          rows: arr(o.rows).map((r) => parseRow(r)),
        })),
      })),
    };
  });
  if (p.chapters.length > 3000) throw Error("章节数量超过安全上限（3000）");
  return p;
}
