import { describe, expect, it } from "vitest";
import {
  dialogueMarkdown,
  dialogueWrapChanges,
  longestDialogueLine,
  normalizeDialogueSettings,
  wrapDialogue,
} from "../src/domain/dialogue.js";
import { newProject, normalizeProject } from "../src/domain/project.js";
describe("project dialogue line limits", () => {
  it("preserves Unicode graphemes and every original character", () => {
    const text = "你好👨‍👩‍👧‍👦e\u0301!😊世界";
    expect(longestDialogueLine(text)).toBe(8);
    const wrapped = wrapDialogue(text, 3);
    expect(wrapped).toBe("你好👨‍👩‍👧‍👦\ne\u0301!😊\n世界");
    expect(wrapped.replaceAll("\n", "")).toBe(text);
  });
  it("keeps manual blank lines, counts punctuation, and adds no trailing newline", () => {
    expect(wrapDialogue("abcd\n\n你好，世界！\n", 3)).toBe(
      "abc\nd\n\n你好，\n世界！\n",
    );
    expect(wrapDialogue("abc", 3)).toBe("abc");
    expect(wrapDialogue("abcdef", 0)).toBe("abcdef");
  });
  it("keeps each project independent and retains settings through JSON", () => {
    const a: any = newProject(),
      b: any = newProject();
    a.settings = { dialogueLineLength: 20, dialogueOverflow: "warn" };
    expect(b.settings.dialogueLineLength).toBe(0);
    expect(normalizeProject(JSON.parse(JSON.stringify(a))).settings).toEqual({
      dialogueLineLength: 20,
    });
    delete b.settings;
    expect(normalizeProject(b).settings.dialogueLineLength).toBe(0);
    expect(
      normalizeDialogueSettings({ dialogueLineLength: -2 }).dialogueLineLength,
    ).toBe(0);
  });
  it("formats nested group, branch and investigation dialogue without touching notes or effects", () => {
    const p: any = newProject();
    p.settings.dialogueLineLength = 2;
    p.chapters[0].stages[0].rows = [
      {
        type: "group",
        rows: [
          { type: "dialogue", text: "甲乙丙" },
          { type: "effect", text: "甲乙丙" },
          {
            type: "branch",
            text: "甲乙丙",
            options: [{ rows: [{ type: "dialogue", text: "一二三" }] }],
          },
        ],
      },
    ];
    p.chapters[0].stages[0].objects = [
      {
        rows: [
          { type: "dialogue", text: "四五六" },
          { type: "note", text: "四五六" },
        ],
        interactions: [{ rows: [{ type: "dialogue", text: "七八九" }] }],
      },
    ];
    expect(dialogueWrapChanges(p).map((v) => v.text)).toEqual([
      "甲乙\n丙",
      "一二\n三",
      "四五\n六",
      "七八\n九",
    ]);
    expect(dialogueMarkdown("甲乙丙丁戊", 2, "    ")).toBe(
      "    甲乙  \n    丙丁  \n    戊",
    );
  });
});
