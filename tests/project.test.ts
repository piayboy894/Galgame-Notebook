import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeProject, newProject } from "../src/domain/project.js";

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
    expect(result.version).toBe(3);
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
