import { readFileSync } from "node:fs";

export function releaseNotes(version) {
  const text = readFileSync("CHANGELOG.md", "utf8");
  const heading = `## ${version}`;
  const start = text.split("\n").indexOf(heading);
  if (start < 0) throw new Error(`Missing changelog section for ${version}`);
  const lines = text.split("\n").slice(start + 1);
  const end = lines.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? lines : lines.slice(0, end)).join("\n").trim();
}
