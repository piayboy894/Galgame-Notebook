import { uid } from "./primitives.js";

export function normalizeEncyclopediaLinks(links, text, entries = null) {
  if (!Array.isArray(links)) return [];
  const valid = links.filter((link) =>
    Number.isSafeInteger(link?.start) && Number.isSafeInteger(link?.end) &&
    link.start >= 0 && link.end > link.start && link.end <= text.length &&
    typeof link.entryId === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(link.entryId) &&
    (!entries || entries.has(link.entryId)),
  ).sort((a, b) => a.start - b.start || a.end - b.end);
  const result = [];
  for (const { start, end, entryId } of valid)
    if (!result.length || start >= result.at(-1).end)
      result.push({ start, end, entryId });
  return result;
}

export function setEncyclopediaLinks(row, links) {
  if (links.length) row.encyclopediaLinks = links;
  else delete row.encyclopediaLinks;
}

export function remapEncyclopediaLinks(links, previous, next, selection) {
  if (!links?.length || previous === next) return links || [];
  const delta = next.length - previous.length;
  let { start, end, inputType } = selection || {};
  if (start === end && delta < 0) {
    if (inputType?.endsWith("Backward")) start += delta;
    if (inputType?.endsWith("Forward")) end -= delta;
  }
  // Use the user's edit range when the unchanged text on both sides agrees.
  // This distinguishes edits to repeated occurrences of the same phrase.
  if (start === undefined || start < 0 || end + delta < start ||
      !next.startsWith(previous.slice(0, start)) ||
      next.slice(end + delta) !== previous.slice(end)) {
    start = 0;
    const common = Math.min(previous.length, next.length);
    while (start < common && previous[start] === next[start]) start++;
    end = previous.length;
    while (end > start && end + delta > start &&
        previous[end - 1] === next[end + delta - 1]) end--;
  }
  return links.flatMap((link) => {
    if (link.end <= start) return [link];
    if (link.start >= end)
      return [{ ...link, start: link.start + delta, end: link.end + delta }];
    return [];
  });
}

export function wrappedEncyclopediaLinks(links, previous, wrapped) {
  if (!links?.length || previous === wrapped) return links || [];
  const starts = [], ends = [];
  let cursor = 0;
  for (let offset = 0; offset <= previous.length; offset++) {
    const ch = previous[offset];
    ends[offset] = cursor;
    // The wrapper inserts a line break between graphemes and normalizes CRLF.
    if (wrapped[cursor] === "\n" && ch !== "\n" && ch !== "\r") cursor++;
    starts[offset] = cursor;
    if (ch !== "\r" || previous[offset + 1] !== "\n") cursor++;
  }
  return links.map((link) => ({
    ...link, start: starts[link.start], end: ends[link.end],
  }));
}

export function copiedEncyclopediaEntries(project, rows) {
  const ids = new Set(rows.flatMap((row) => (row.encyclopediaLinks || []).map((link) => link.entryId)));
  return project.encyclopedia.filter((entry) => ids.has(entry.id));
}

export function remapCopiedEncyclopediaLinks(project, rows, entries, sourceProjectId) {
  const known = new Map(project.encyclopedia.map((entry) => [entry.id, entry]));
  const source = new Map((Array.isArray(entries) ? entries : [])
    .filter((entry) => typeof entry?.title === "string" && typeof entry.body === "string")
    .map((entry) => [entry.id, entry]));
  const mapped = new Map();
  for (const row of rows) {
    if (!row.encyclopediaLinks?.length) continue;
    setEncyclopediaLinks(row, row.encyclopediaLinks.flatMap((link) => {
      const id = link.entryId;
      if (sourceProjectId === project.id && known.has(id)) return [link];
      if (!mapped.has(id) && source.has(id)) {
        const { title, body } = source.get(id);
        let target = project.encyclopedia.find((entry) => entry.title === title && entry.body === body);
        if (!target) {
          let name = title;
          let suffix = 2;
          while (project.encyclopedia.some((entry) => entry.title === name))
            name = title + " (" + suffix++ + ")";
          target = { id: uid("entry"), title: name, body };
          project.encyclopedia.push(target);
        }
        mapped.set(id, target.id);
      }
      return mapped.has(id) ? [{ ...link, entryId: mapped.get(id) }] : [];
    }));
  }
}

export function encyclopediaParts(text, links = []) {
  const parts = [];
  let cursor = 0;
  for (const { start, end, entryId } of links) {
    if (cursor < start) parts.push({ text: text.slice(cursor, start) });
    parts.push({ text: text.slice(start, end), entryId });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
