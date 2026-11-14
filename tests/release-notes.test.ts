import { describe, expect, it } from "vitest";
import { parseReleaseNotes } from "../scripts/release-notes.mjs";

describe("release notes on Windows and Unix checkouts", () => {
  for (const newline of ["\n", "\r\n"]) {
    it(`extracts only the requested version with ${JSON.stringify(newline)} line endings`, () => {
      const text = [
        "# 更新记录",
        "",
        "## 2.1.0",
        "",
        "- 场景组和地点",
        "",
        "## 2.0.0",
        "",
        "- 桌面版",
        "",
      ].join(newline);
      expect(parseReleaseNotes(text, "2.1.0")).toBe("- 场景组和地点");
      expect(parseReleaseNotes(text, "2.0.0")).toBe("- 桌面版");
    });
  }
  it("stops publication if the requested version is missing", () => {
    expect(() => parseReleaseNotes("## 2.0.0\nold notes", "2.1.0")).toThrow(
      "Missing changelog section for 2.1.0",
    );
  });
});
