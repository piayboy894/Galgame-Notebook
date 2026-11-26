import { investigationScripts } from "./investigation.js";

function numberedRows(chunks) {
  return chunks.map((chunk, index) => {
    const prefix = `${index + 1}. `;
    const indent = " ".repeat(prefix.length);
    return prefix + chunk.replace(/\n(?=.)/g, "\n" + indent);
  }).join("\n\n");
}

const anchor = (number) => "investigation-script-" + number;
const link = (number) => `[调查脚本 ${number}](#${anchor(number)})`;

function reference(number, start, count) {
  const range = count === 1 ? String(start + 1) : `${start + 1}–${start + count}`;
  return `沿用 ${link(number)} 第 ${range} 条`;
}

function findRepeatedRows(target, source, number) {
  const indexes = new Map();
  source.forEach((chunk, index) => {
    if (!indexes.has(chunk)) indexes.set(chunk, []);
    indexes.get(chunk).push(index);
  });
  const result = [];
  for (let at = 0; at < target.length;) {
    let best = 0;
    let start = 0;
    for (const candidate of indexes.get(target[at]) || []) {
      let count = 1;
      while (at + count < target.length && target[at + count] === source[candidate + count])
        count++;
      if (count > best) {
        best = count;
        start = candidate;
      }
      if (at + best === target.length) break;
    }
    const command = reference(number, start, best);
    const literal = target.slice(at, at + best).join("\n\n");
    if (best && literal.length > command.length + 2) {
      result.push(command);
      at += best;
    } else {
      result.push(target[at]);
      at++;
    }
  }
  return result;
}

/** Keep reusable scripts in the document as complete numbered blocks. A later
 * placement can reuse ranges in its exact order, with edited rows written inline. */
export function planReadableInvestigation(stages, renderRows) {
  const entries = [];
  const byCard = new Map();
  for (const stage of stages) {
    for (const item of stage.objects) {
      const scripts = new Map();
      for (const script of investigationScripts(item)) {
        const entry = {
          item, script, chunks: script.rows.map(renderRows),
          number: 0, condensed: null,
        };
        entries.push(entry);
        scripts.set(script.id, entry);
      }
      byCard.set(item.id, scripts);
    }
  }
  const earliest = new Map();
  let count = 0;
  for (const entry of entries) {
    const { item, script, chunks } = entry;
    const key = JSON.stringify([item.poolId || item.id, script === item ? null : script.name]);
    let candidate = earliest.get(key);
    if (!candidate) earliest.set(key, entry);
    if (entry.number || !chunks.length) continue;

    // Prefer the deepest available source in this export. Missing source chapters
    // are handled by writing the current effective script in full.
    let prior = entry;
    const seen = new Set([item.id]);
    while (prior.item.inheritance) {
      const { sourceId, rowIds } = prior.item.inheritance;
      if (seen.has(sourceId)) break;
      seen.add(sourceId);
      const sourceScriptId = prior.script === prior.item ? sourceId
        : rowIds.find(([, currentId]) => currentId === prior.script.id)?.[0];
      const source = byCard.get(sourceId)?.get(sourceScriptId);
      if (!source) break;
      if (!source.condensed) candidate = source;
      prior = source;
    }
    if (!candidate || candidate === entry || candidate.condensed || !candidate.chunks.length) continue;
    const number = candidate.number || count + 1;
    const condensed = findRepeatedRows(chunks, candidate.chunks, number);
    const initialCost = candidate.number ? 0
      : numberedRows(candidate.chunks).length - candidate.chunks.join("\n\n").length + 64;
    if (chunks.join("\n\n").length <= condensed.join("\n\n").length + initialCost) continue;
    if (!candidate.number) candidate.number = ++count;
    entry.condensed = condensed;
  }

  return {
    hasReferences: count > 0,
    render(item, script) {
      const entry = byCard.get(item.id).get(script.id);
      if (entry.number)
        return `<a id="${anchor(entry.number)}"></a>\n\n**调查脚本 ${entry.number}**\n\n${numberedRows(entry.chunks)}`;
      return (entry.condensed || entry.chunks).join("\n\n");
    },
  };
}
