import { readFileSync } from "node:fs";

export function releaseNotes(version) {
  return parseReleaseNotes(readFileSync("CHANGELOG.md", "utf8"), version);
}

export function parseReleaseNotes(text, version) {
  const lines = text.split(/\r?\n/);
  const heading = `## ${version}`;
  const start = lines.indexOf(heading);
  if (start < 0) throw new Error(`Missing changelog section for ${version}`);
  const body = lines.slice(start + 1);
  const end = body.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? body : body.slice(0, end)).join("\n").trim();
}
