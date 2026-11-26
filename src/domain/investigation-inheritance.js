import { clone, uid } from "./primitives.js";

export function investigationIndex(project) {
  const placements = new Map();
  const stages = new Map();
  for (const chapter of project.chapters)
    for (const stage of chapter.stages) {
      if (stage.kind !== "investigation") continue;
      stages.set(stage.id, { stage, chapter });
      for (const item of stage.objects)
        placements.set(item.id, { item, stage, chapter });
    }
  return { placements, stages };
}

export function investigationIdentity(item) {
  return {
    name: item.name,
    characterId: item.characterId || "",
    ...(item.temporaryCharacter ? { temporaryCharacter: true } : {}),
  };
}

// Legacy cards keep their placement IDs, scripts and coordinates. Linked project
// characters can be matched by ID. Objects and temporary NPCs need an explicit match.
export function ensureInvestigationPool(project) {
  const pool = new Map(project.investigationPool.map((entry) => [entry.id, entry]));
  const characters = new Map(project.investigationPool.filter((entry) => entry.characterId)
    .map((entry) => [entry.characterId, entry]));
  for (const chapter of project.chapters)
    for (const stage of chapter.stages)
      for (const item of stage.objects || []) {
        let entry = pool.get(item.poolId) || characters.get(item.characterId);
        if (!entry) {
          entry = { id: uid("investigation"), ...investigationIdentity(item) };
          project.investigationPool.push(entry);
          pool.set(entry.id, entry);
          if (entry.characterId) characters.set(entry.characterId, entry);
        }
        item.poolId = entry.id;
        item.name = entry.name;
        item.characterId = entry.characterId;
        if (entry.temporaryCharacter) item.temporaryCharacter = true;
        else delete item.temporaryCharacter;
      }
}

export function setInvestigationIdentity(project, item, identity) {
  const entry = project.investigationPool.find((entry) => entry.id === item.poolId);
  Object.assign(item, identity);
  if (!identity.temporaryCharacter) delete item.temporaryCharacter;
  if (entry) {
    Object.assign(entry, identity);
    if (!identity.temporaryCharacter) delete entry.temporaryCharacter;
  }
}

export function canInheritInvestigation(index, targetId, sourceId) {
  const target = index.placements.get(targetId);
  let source = index.placements.get(sourceId);
  if (!source || target?.stage === source.stage) return false;
  const visited = new Set([targetId]);
  while (source) {
    if (visited.has(source.item.id)) return false;
    visited.add(source.item.id);
    source = index.placements.get(source.item.inheritance?.sourceId);
  }
  return true;
}

function scriptOf(item) {
  return { rows: item.rows, interactions: item.interactions,
    fallbackEnabled: item.fallbackEnabled, outcomes: item.outcomes };
}

function projectScript(index, item, source, targetStage, rowIds) {
  const script = clone(scriptOf(source));
  const targetId = (id) => {
    if (id === source.id) return item.id;
    const placement = index.placements.get(id);
    if (!placement) return id;
    if (targetStage.objects.some((card) => card.id === id)) return id;
    const matches = targetStage.objects.filter((card) => card.poolId === placement.item.poolId);
    return matches.length === 1 ? matches[0].id : id;
  };
  function remap(record) {
    if (!rowIds.has(record.id)) rowIds.set(record.id, uid("inherited"));
    record.id = rowIds.get(record.id);
    if (record.speakerId) record.speakerId = targetId(record.speakerId);
    for (const condition of record.conditions || [])
      if (condition.type === "investigated") condition.targetId = targetId(condition.targetId);
    for (const key of ["rows", "interactions", "options"])
      record[key]?.forEach(remap);
  }
  script.rows.forEach(remap);
  script.interactions.forEach(remap);
  return script;
}

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const record = (value) => value && typeof value === "object" && !Array.isArray(value);

function keyedOrder(primary, secondary, ids) {
  const order = primary.filter((id) => ids.has(id));
  let position = 0;
  for (const id of secondary) {
    const at = order.indexOf(id);
    if (at >= 0) position = at + 1;
    else if (ids.has(id)) order.splice(position++, 0, id);
  }
  return order;
}

// Three-way field merge on the previous source, the author's placement and the new
// source. Only arrays of records with IDs are merged by item; rule predicates and
// encyclopedia spans are edited as a unit.
function mergeScript(base, local, next, overrides, path = "") {
  if (overrides.has(path)) return local;
  const isPinned = () => overrides.size && (!path ||
    [...overrides].some((key) => key.startsWith(path + ".")));
  if (same(base, local) && !isPinned()) return next;
  if (same(base, next)) return local;
  const childPath = (key) => path ? path + "." + key : key;
  if ([base, local, next].every(record)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(next)]);
    return Object.fromEntries([...keys].flatMap((key) => {
      const value = key === "encyclopediaLinks" && (base.text !== local.text || overrides.has(childPath("text")))
        ? local[key]
        : mergeScript(base[key], local[key], next[key], overrides, childPath(key));
      return value === undefined ? [] : [[key, value]];
    }));
  }
  if ([base, local, next].every((value) =>
    Array.isArray(value) && value.every((entry) => typeof entry?.id === "string"))) {
    const maps = [base, local, next].map((items) => new Map(items.map((entry) => [entry.id, entry])));
    const resolved = new Map();
    for (const id of new Set(maps.flatMap((items) => [...items.keys()]))) {
      const [previous, written, inherited] = maps.map((items) => items.get(id));
      const entry = mergeScript(previous, written, inherited, overrides, childPath(id));
      if (entry !== undefined) resolved.set(id, entry);
    }
    const [baseOrder, localOrder, nextOrder] = maps.map((items) => [...items.keys()]);
    const common = new Set(baseOrder.filter((id) => maps[1].has(id)));
    const reordered = !same(baseOrder.filter((id) => common.has(id)), localOrder.filter((id) => common.has(id)));
    const order = reordered ? keyedOrder(localOrder, nextOrder, resolved) : keyedOrder(nextOrder, localOrder, resolved);
    return order.map((id) => resolved.get(id));
  }
  if (path && base !== undefined) overrides.add(path);
  return local;
}

function matchRecords(source, local, ids) {
  const content = (entry) => JSON.stringify(entry, (key, value) => key === "id" ? undefined : value);
  const matched = new Set();
  const localContents = new Map(local.map((entry) => [entry.id, content(entry)]));
  const pairs = source.map((entry) => {
    const text = content(entry);
    const candidate = local.find((value) => !matched.has(value.id) && localContents.get(value.id) === text);
    if (candidate) matched.add(candidate.id);
    return [entry, candidate];
  });
  const remaining = local.filter((entry) => !matched.has(entry.id));
  for (const pair of pairs) {
    const [entry, exact] = pair;
    const at = remaining.findIndex((candidate) =>
      candidate.type === entry.type && candidate.name === entry.name);
    const candidate = exact || (at >= 0 ? remaining.splice(at, 1)[0] : null);
    if (!candidate) continue;
    ids.set(entry.id, candidate.id);
    for (const key of ["rows", "interactions", "options"])
      if (entry[key] && candidate[key]) matchRecords(entry[key], candidate[key], ids);
  }
}

// On first linking an already written card, keep its text and ordering while
// filling slots that only exist in the chosen source.
function combineScripts(source, local) {
  const result = { ...source, ...local };
  for (const key of ["rows", "interactions", "options"]) {
    if (!source[key] || !local[key]) continue;
    const originals = new Map(source[key].map((entry) => [entry.id, entry]));
    const written = new Map(local[key].map((entry) => [entry.id, entry]));
    const order = keyedOrder([...written.keys()], [...originals.keys()],
      new Set([...written.keys(), ...originals.keys()]));
    result[key] = order.map((id) => {
      const base = originals.get(id);
      const edited = written.get(id);
      return base && edited ? combineScripts(base, edited) : edited || base;
    });
  }
  return result;
}

export function inheritedInvestigationScript(index, item) {
  const target = index.placements.get(item.id);
  const source = index.placements.get(item.inheritance?.sourceId);
  if (!target || !source) return null;
  return projectScript(index, item, source.item, target.stage, new Map(item.inheritance.rowIds));
}

export function linkInvestigation(index, stage, item, source, keepChanges = true) {
  const oldSource = keepChanges ? inheritedInvestigationScript(index, item) : null;
  const local = scriptOf(item);
  const overrides = new Set(oldSource ? item.inheritance.overrides : []);
  const rowIds = new Map();
  if (keepChanges) {
    const comparison = oldSource || local;
    matchRecords(source.rows, comparison.rows, rowIds);
    matchRecords(source.interactions, comparison.interactions, rowIds);
  }
  const inherited = projectScript(index, item, source, stage, rowIds);
  const blank = !local.rows.length && !local.interactions.length && !local.outcomes.length && local.fallbackEnabled;
  const script = oldSource
    ? mergeScript(oldSource, local, inherited, overrides)
    : keepChanges && !blank ? combineScripts(inherited, local) : inherited;
  Object.assign(item, script);
  item.inheritance = { sourceId: source.id, rowIds: [...rowIds] };
  if (overrides.size) item.inheritance.overrides = [...overrides];
}

export function previousInvestigationEdit(project, itemId) {
  const index = investigationIndex(project);
  if (![...index.placements.values()].some(({ item }) => item.inheritance?.sourceId === itemId))
    return null;
  // The input handler mutates only the active card. Copy its rows before the edit.
  // Other cards get new script arrays during propagation, so shallow copies suffice.
  for (const entry of index.placements.values())
    entry.item = entry.item.id === itemId ? clone(entry.item) : { ...entry.item };
  return index;
}

export function refreshInvestigationInheritance(project, previous) {
  const index = investigationIndex(project);
  for (const { stage } of index.stages.values())
    if (stage.investigationSourceId && !index.stages.has(stage.investigationSourceId))
      delete stage.investigationSourceId;
  const visited = new Set();
  function update(target) {
    const { item, stage } = target;
    if (visited.has(item.id)) return;
    visited.add(item.id);
    const link = item.inheritance;
    if (!link) return;
    const source = index.placements.get(link.sourceId);
    if (!source || !canInheritInvestigation(index, item.id, link.sourceId)) {
      delete item.inheritance;
      return;
    }
    update(source);
    const prior = previous?.placements.get(item.id);
    const priorSource = previous?.placements.get(link.sourceId);
    if (prior?.item.inheritance?.sourceId !== link.sourceId || !priorSource) return;
    const rowIds = new Map(link.rowIds);
    const base = projectScript(previous, prior.item, priorSource.item, prior.stage, rowIds);
    const next = projectScript(index, item, source.item, stage, rowIds);
    if (!same(base, next)) {
      const overrides = new Set(link.overrides);
      Object.assign(item, mergeScript(base, scriptOf(item), next, overrides));
      if (overrides.size) link.overrides = [...overrides];
    }
    link.rowIds = [...rowIds];
  }
  for (const target of index.placements.values()) update(target);
}
