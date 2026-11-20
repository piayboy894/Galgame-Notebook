import { describe, expect, it } from "vitest";
import { applyDialogueWrap, wrapDialogue } from "../src/domain/dialogue.js";
import {
  remapCopiedEncyclopediaLinks,
  remapEncyclopediaLinks,
} from "../src/domain/encyclopedia.js";
import { line, newProject } from "../src/domain/project.js";

describe("dialogue encyclopedia ranges", () => {
  it("keeps the marked occurrence when an identical occurrence is deleted", () => {
    const links = [{ start: 2, end: 4, entryId: "entry" }];
    expect(remapEncyclopediaLinks(links, "港口港口", "港口",
      { start: 0, end: 2, inputType: "deleteContentBackward" }))
      .toEqual([{ start: 0, end: 2, entryId: "entry" }]);
    expect(remapEncyclopediaLinks(links, "港口港口", "港口",
      { start: 2, end: 4, inputType: "deleteContentBackward" })).toEqual([]);
  });

  it("keeps a link across wrap boundaries and existing CRLF", () => {
    const row = { ...line(), text: "😊旧港\r\n北城",
      encyclopediaLinks: [{ start: 2, end: 8, entryId: "entry" }] };
    applyDialogueWrap(row, wrapDialogue(row.text, 1));
    const [link] = row.encyclopediaLinks;
    expect(row.text.slice(link.start, link.end)).toBe("旧\n港\n北\n城");
  });

  it("copies definitions with dialogue and keeps conflicting definitions distinct", () => {
    const target = newProject();
    target.encyclopedia.push({ id: "local", title: "旧港", body: "当地港口" });
    const linked = { ...line(), text: "去旧港", encyclopediaLinks: [{ start: 1, end: 3, entryId: "foreign" }] };
    const entries = [{ id: "foreign", title: "旧港", body: "另一城市的旧港" }];
    remapCopiedEncyclopediaLinks(target, [linked], entries, "other");
    const saved = target.encyclopedia[1];
    expect(saved.title).toBe("旧港 (2)");
    expect(saved.body).toBe(entries[0].body);
    expect(linked.encyclopediaLinks[0].entryId).toBe(saved.id);
  });
});
