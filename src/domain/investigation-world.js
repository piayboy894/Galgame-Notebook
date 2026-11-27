import { investigationIdentity, investigationIndex } from "./investigation-inheritance.js";
import { clone, uid } from "./primitives.js";

const placementFields = ["locationId", "notes", "position"];
const worldKey = (item) => item.world?.key || item.id;

export const isInvestigationPresent = (item) =>
  item.world?.presence !== "away" &&
  (!item.world?.unavailable || item.world.presence === "present");

export const presentInvestigationItems = (stage) =>
  (stage?.objects || []).filter(isInvestigationPresent);

export function investigationWorldChain(index, stage) {
  const chain = [];
  const seen = new Set();
  for (let next = stage; next && !seen.has(next.id); next = index.stages.get(next.worldSourceId)?.stage) {
    chain.push(next);
    seen.add(next.id);
  }
  return chain;
}

export function canContinueInvestigationWorld(index, stage, source) {
  return !!source && !investigationWorldChain(index, source).some((entry) => entry.id === stage.id);
}

export function previousInvestigationStage(project, chapter, stage) {
  const stages = project.chapters.filter((entry) => entry.routeId === chapter.routeId)
    .sort((a, b) => a.y - b.y).flatMap((entry) => entry.stages);
  const at = stages.indexOf(stage);
  return stages.slice(0, at < 0 ? stages.length : at).reverse()
    .find((entry) => entry.kind === "investigation");
}

export function investigationVisitKeys(index, stage) {
  const keys = new Map();
  const active = new Map();
  for (const phase of investigationWorldChain(index, stage).reverse()) {
    for (const item of phase.objects) {
      const key = worldKey(item);
      if (!active.has(key) || (item.world?.resetVisits && isInvestigationPresent(item))) active.set(key, item.id);
      keys.set(item.id, key);
    }
  }
  // Predicates imported from any ancestor use the current visit history of that object.
  for (const [id, key] of keys) keys.set(id, active.get(key));
  return keys;
}

function matchPlacement(items, source, sources, claimed, matchNames) {
  const inherited = items.find((item) => !claimed.has(item.id) &&
    (item.world?.from === source.id || worldKey(item) === worldKey(source)));
  if (inherited) return inherited;
  const local = items.filter((item) => !claimed.has(item.id) && !item.world?.from &&
    item.world?.presence !== "away");
  const match = (test) => {
    const same = local.filter(test);
    return same.length === 1 && sources.filter(test).length === 1 ? same[0] : null;
  };
  return match((item) => item.poolId === source.poolId) || (matchNames && match((item) =>
    item.name === source.name && item.characterId === source.characterId &&
    Boolean(item.temporaryCharacter) === Boolean(source.temporaryCharacter)));
}

function detachWorld(stage) {
  delete stage.worldSourceId;
  for (const item of stage.objects) {
    const world = item.world;
    if (!world) continue;
    if (!isInvestigationPresent(item)) world.presence = "away";
    if (world.from && item.inheritance?.sourceId === world.from) delete item.inheritance;
    delete world.from;
    delete world.unavailable;
    delete world.fields;
  }
}

// Materialize each inherited placement once, preserving its ID for predicates and speakers.
// The script merger initializes new links after the source's own script has been updated.
export function refreshInvestigationWorld(project, previous, matchNamesFor = null) {
  const index = investigationIndex(project);
  const pendingScripts = new Map();
  const processed = new Set();
  function update(stage) {
    if (processed.has(stage.id)) return;
    processed.add(stage.id);
    const source = index.stages.get(stage.worldSourceId)?.stage;
    if (!canContinueInvestigationWorld(index, stage, source)) {
      if (stage.worldSourceId || stage.objects.some((item) => item.world?.from)) detachWorld(stage);
      return;
    }
    update(source);
    const sources = presentInvestigationItems(source);
    const claimed = new Set();
    for (const card of sources) {
      let item = matchPlacement(stage.objects, card, sources, claimed, matchNamesFor === stage.id);
      const existing = Boolean(item);
      if (!item) {
        item = {
          id: uid("object"), poolId: card.poolId, ...investigationIdentity(card),
          fallbackEnabled: true, rows: [], interactions: [], outcomes: [],
        };
        stage.objects.push(item);
      }
      claimed.add(item.id);
      const world = item.world ||= {};
      const prior = previous?.placements.get(item.id)?.item;
      const attaching = world.from !== card.id;
      if (attaching) Object.assign(item, investigationIdentity(card), { poolId: card.poolId });
      const fields = new Set(world.fields);
      for (const field of placementFields) {
        const value = JSON.stringify(item[field]);
        if ((attaching && existing && !world.from && value !== JSON.stringify(card[field])) ||
            (prior && value !== JSON.stringify(prior[field]))) fields.add(field);
        if (!fields.has(field) && card[field] !== undefined) item[field] = clone(card[field]);
      }
      if (fields.size) world.fields = [...fields];
      if (prior && ["rows", "interactions", "fallbackEnabled", "outcomes"].some((field) =>
        JSON.stringify(item[field]) !== JSON.stringify(prior[field]))) world.scriptEdited = true;
      world.key = worldKey(card);
      world.from = card.id;
      delete world.unavailable;
      if (attaching && (!item.inheritance || item.inheritance.sourceId === prior?.world?.from)) {
        pendingScripts.set(item.id, { sourceId: card.id, keepChanges: existing });
        if (existing && !prior?.world?.from &&
          (item.rows.length || item.interactions.length || item.outcomes.length || !item.fallbackEnabled))
          world.scriptEdited = true;
      }
    }
    for (const item of stage.objects)
      if (item.world?.from && !claimed.has(item.id)) item.world.unavailable = true;
  }
  for (const { stage } of index.stages.values()) update(stage);
  return pendingScripts;
}
