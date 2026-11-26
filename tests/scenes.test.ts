import { describe, expect, it } from "vitest";
import {
  branchRowCount,
  flattenRows,
  line,
  newProject,
  normalizeProject,
  regenRowIds,
} from "../src/domain/project.js";
import {
  effectiveLocation,
  findRow,
  groupSelection,
  normalizeProperties,
  sceneGroup,
  selectedRoots,
} from "../src/domain/scenes.js";

describe("scene structure and location inheritance", () => {
  it("groups exactly the contiguous selected rows without changing their content or count", () => {
    const rows = [line(), line("effect"), line()];
    const picked = groupSelection(rows, new Set([rows[0].id, rows[1].id]));
    const group = sceneGroup(picked.selected, "书房初访");
    rows.splice(picked.start, picked.count, group);
    expect(rows).toHaveLength(2);
    expect(group.rows[0].type).toBe("dialogue");
    expect(branchRowCount({ kind: "story", rows })).toBe(3);
    expect(findRow(rows, group.rows[0].id)?.ancestors).toEqual([group]);
    expect(
      selectedRoots(rows, new Set([group.id, group.rows[0].id])),
    ).toHaveLength(1);
    rows.splice(0, 1, ...group.rows);
    expect(rows).toHaveLength(3);
  });
  it("rejects noncontiguous, cross-option and nested selections", () => {
    const rows = [line(), line(), line()];
    expect(() =>
      groupSelection(rows, new Set([rows[0].id, rows[2].id])),
    ).toThrow("连续");
    const branch: any = line("branch");
    expect(() =>
      groupSelection(
        [branch],
        new Set([branch.options[0].rows[0].id, branch.options[1].rows[0].id]),
      ),
    ).toThrow("同一段");
    const group = sceneGroup(rows);
    expect(() => groupSelection([group], new Set([rows[0].id]))).toThrow(
      "单层",
    );
  });
  it("retains groups and locations through JSON round trips and regenerates all copied IDs", () => {
    const project: any = newProject();
    project.locations = [
      {
        id: "location_room",
        name: "旧书房",
        bgm: "雨夜",
        background: "书房.png",
        ambience: "下雨",
        notes: "",
        properties: [{ name: "时间", value: "夜晚" }],
      },
    ];
    const branch: any = line("branch");
    const group = sceneGroup([line(), branch], "第一次调查");
    group.locationId = "location_room";
    group.notes = "窗边的桌子";
    group.overrides = { bgm: "紧张" };
    project.chapters[0].stages[0].rows = [group];
    const normalized: any = normalizeProject(
      JSON.parse(JSON.stringify(project)),
    );
    expect(normalized.version).toBe(6);
    expect(normalized.chapters[0].stages[0].rows[0]).toEqual(group);
    expect(normalizeProject(normalized)).toEqual(normalized);
    const copy = JSON.parse(JSON.stringify(group));
    regenRowIds(copy);
    const ids = new Set(flattenRows([group]).map((row: any) => row.id));
    expect(flattenRows([copy]).every((row: any) => !ids.has(row.id))).toBe(
      true,
    );
    expect(copy.locationId).toBe("location_room");
  });
  it("inherits preset values while allowing explicit empty overrides", () => {
    const group: any = sceneGroup([]);
    group.locationId = "room";
    const locations = [
      {
        id: "room",
        name: "书房",
        bgm: "雨夜",
        background: "bg.png",
        ambience: "雨声",
        properties: [
          { name: "时间", value: "夜晚" },
          { name: "楼层", value: "二楼" },
        ],
      },
    ];
    expect(effectiveLocation(group, locations).bgm).toBe("雨夜");
    group.overrides = { bgm: "" };
    expect(effectiveLocation(group, locations).bgm).toBe("");
    group.overrides.properties = [{ name: "时间", value: "深夜" }];
    expect(effectiveLocation(group, locations).properties).toEqual([
      { name: "时间", value: "深夜" },
      { name: "楼层", value: "二楼" },
    ]);
    locations[0].ambience = "远处雷声";
    expect(effectiveLocation(group, locations).ambience).toBe("远处雷声");
  });
  it("normalizes legacy projects and rejects missing location references or nested groups", () => {
    const project: any = newProject();
    project.version = 3;
    delete project.locations;
    expect(normalizeProject(project).locations).toEqual([]);
    const group = sceneGroup([line()]);
    group.locationId = "missing";
    project.chapters[0].stages[0].rows = [group];
    expect(() => normalizeProject(project)).toThrow("不存在的地点");
    group.locationId = "";
    group.rows = [sceneGroup([])];
    expect(() => normalizeProject(project)).toThrow("嵌套");
    expect(() =>
      normalizeProperties([
        { name: "时间", value: "夜" },
        { name: "时间", value: "昼" },
      ]),
    ).toThrow("重复");
  });
});
