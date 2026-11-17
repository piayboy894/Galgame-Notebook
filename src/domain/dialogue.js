export const MAX_DIALOGUE_LINE_LENGTH = 500;
export function normalizeDialogueSettings(value) {
  const n = value?.dialogueLineLength;
  return {
    dialogueLineLength:
      Number.isInteger(n) && n >= 0 && n <= MAX_DIALOGUE_LINE_LENGTH ? n : 0,
    dialogueOverflow: value?.dialogueOverflow === "warn" ? "warn" : "wrap",
  };
}
const segmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
export function characters(text) {
  if (segmenter) return Array.from(segmenter.segment(text), (v) => v.segment);
  const result = [];
  for (const ch of Array.from(text)) {
    if (
      result.length &&
      (/\p{Mark}|[\uFE0E\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/u.test(ch) ||
        result.at(-1).endsWith("\u200D"))
    )
      result[result.length - 1] += ch;
    else result.push(ch);
  }
  return result;
}
export function longestDialogueLine(text) {
  return String(text)
    .split(/\r\n?|\n/)
    .reduce((n, line) => Math.max(n, characters(line).length), 0);
}
export function wrapDialogue(text, limit) {
  if (
    !limit ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_DIALOGUE_LINE_LENGTH
  )
    return text;
  return String(text)
    .split(/\r\n?|\n/)
    .map((line) => {
      const chars = characters(line),
        lines = [];
      for (let i = 0; i < chars.length; i += limit)
        lines.push(chars.slice(i, i + limit).join(""));
      return lines.join("\n");
    })
    .join("\n");
}
export function dialogueWrapChanges(project) {
  const settings = normalizeDialogueSettings(project.settings);
  if (!settings.dialogueLineLength || settings.dialogueOverflow !== "wrap")
    return [];
  const changes = [];
  function visit(rows) {
    for (const row of rows || []) {
      if (row.type === "dialogue") {
        const text = wrapDialogue(row.text, settings.dialogueLineLength);
        if (text !== row.text) changes.push({ row, text });
      }
      visit(row.rows);
      for (const option of row.options || []) visit(option.rows);
    }
  }
  for (const chapter of project.chapters)
    for (const stage of chapter.stages) {
      visit(stage.rows);
      for (const item of stage.objects || []) visit(item.rows);
    }
  return changes;
}
