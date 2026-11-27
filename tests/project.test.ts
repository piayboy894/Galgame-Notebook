import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeProject,
  newProject,
  regenerateInvestigationIds,
} from "../src/domain/project.js";
import { matchingInvestigationScript } from "../src/domain/investigation.js";

describe("existing story compatibility", () => {
  for (const file of [
    "三线交汇_示例.story.json",
    "示例剧本.story.json",
    "空白剧本.story.json",
  ]) {
    it(`round-trips ${file} without losing script content`, () => {
      const input = JSON.parse(
        readFileSync(new URL(`../examples/${file}`, import.meta.url), "utf8"),
      );
      const project = normalizeProject(input);
      expect(project.id).toBe(input.id);
      expect(project.routes).toHaveLength(input.routes.length);
      expect(project.chapters).toHaveLength(input.chapters.length);
      expect(normalizeProject(JSON.parse(JSON.stringify(project)))).toEqual(
        project,
      );
    });
  }
  it("converts legacy choice groups and retains both merge and jump branches", () => {
    const p: any = newProject();
    p.version = 1;
    p.chapters[0].stages[0].rows = [
      {
        id: "old-choice",
        type: "choice",
        text: "去哪？",
        options: [
          { id: "o1", text: "走廊", chapterId: p.chapters[1].id, rows: [] },
        ],
      },
      {
        id: "old-local",
        type: "localChoice",
        text: "询问",
        options: [
          {
            id: "o2",
            text: "信封",
            rows: [{ id: "inside", type: "dialogue", text: "没有署名" }],
          },
        ],
      },
    ];
    const result: any = normalizeProject(p);
    expect(result.version).toBe(7);
    expect(result.chapters[0].stages[0].rows[0].options[0].mode).toBe("jump");
    expect(result.chapters[0].stages[0].rows[1].options[0].rows[0].text).toBe(
      "没有署名",
    );
  });
  it("rejects duplicate IDs and invalid parent references", () => {
    const p: any = newProject();
    p.routes[1].id = p.routes[0].id;
    expect(() => normalizeProject(p)).toThrow("重复标识");
    const q: any = newProject();
    q.chapters[0].routeId = "missing";
    expect(() => normalizeProject(q)).toThrow("缺少所属路线");
  });
  it("copies only the schema and treats imported markup as plain text", () => {
    const p = {
      ...newProject("<script>alert(1)</script>"),
      injected: "untrusted",
    };
    const normalized = normalizeProject(p);
    expect(normalized.title).toBe("<script>alert(1)</script>");
    expect(normalized).not.toHaveProperty("injected");
  });
});

it("preserves scripted investigations and remaps their internal references when copied", () => {
  const project: any = newProject();
  project.flags = [{ id: "key", name: "拿到钥匙" }];
  const stage = project.chapters[0].stages[0];
  stage.kind = "investigation";
  stage.objects = [
    { id: "letter", name: "信封", outcomes: ["key"] },
    {
      id: "door",
      name: "房门",
      position: { x: -421, y: 790 },
      fallbackEnabled: false,
      interactions: [
        {
          id: "first",
          name: "第一次",
          timing: "exact",
          attempt: 1,
          conditions: [
            { type: "investigated", targetId: "letter", expected: true },
            { type: "flag", targetId: "key", expected: true },
          ],
          rows: [{ id: "line_first", type: "dialogue", text: "门打开了" }],
        },
        { id: "later", name: "后续", timing: "from", attempt: 1 },
      ],
    },
  ];
  const normalized: any = normalizeProject(project);
  const items = normalized.chapters[0].stages[0].objects;
  const [letter, door] = items;
  expect(letter.position).toEqual({ x: 0, y: 0 });
  expect(door.position).toEqual({ x: -448, y: 800 });
  const visits = new Map([[letter.id, 1]]);
  const flags = new Set(["key"]);
  const knownItems = new Set(items.map((item: { id: string }) => item.id));
  expect(
    matchingInvestigationScript(door, 1, visits, flags, flags, knownItems)?.id,
  ).toBe("first");
  expect(
    matchingInvestigationScript(door, 2, visits, flags, flags, knownItems)?.id,
  ).toBe("later");
  expect(
    matchingInvestigationScript(door, 1, visits, flags, flags, new Set())?.id,
  ).toBe("later");

  const copied = structuredClone(items);
  regenerateInvestigationIds(copied);
  expect(copied[0].id).not.toBe(letter.id);
  expect(copied[1].interactions[0].conditions[0].targetId).toBe(copied[0].id);
  expect(copied[1].interactions[0].conditions[1].targetId).toBe("key");
  expect(copied[1].interactions[0].rows[0].id).not.toBe("line_first");
  expect(normalizeProject(JSON.parse(JSON.stringify(normalized)))).toEqual(
    normalized,
  );
});
