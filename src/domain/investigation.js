import { uid } from "./primitives.js";

export const INVESTIGATION_CARD = { width: 200, height: 76, gap: 24 };

export function investigationPosition(raw, index) {
  const { width, height, gap } = INVESTIGATION_CARD;
  if (
    Number.isFinite(raw?.x) &&
    Number.isFinite(raw?.y) &&
    Math.abs(raw.x) <= Number.MAX_SAFE_INTEGER &&
    Math.abs(raw.y) <= Number.MAX_SAFE_INTEGER
  )
    return { x: raw.x, y: raw.y };
  return {
    x: (index % 3) * (width + gap),
    y: Math.floor(index / 3) * (height + gap),
  };
}

export function investigationRule() {
  return {
    id: uid("interaction"),
    name: "",
    timing: "any",
    attempt: 1,
    conditionMode: "all",
    conditions: [],
    outcomes: [],
    rows: [],
  };
}

export const isInvestigationPerson = (item) => Boolean(item.characterId || item.temporaryCharacter);

export function investigationScripts(item) {
  return [item, ...(item.interactions || [])];
}

export function investigationItems(project) {
  return project.chapters.flatMap((chapter) =>
    chapter.stages.flatMap((stage) => stage.objects || []),
  );
}

export function matchingInvestigationScript(
  item,
  attempt,
  visits,
  flags,
  knownFlags,
  knownItems,
) {
  return (
    item.interactions.find((rule) => {
      if (rule.timing === "exact" && attempt !== rule.attempt) return false;
      if (rule.timing === "from" && attempt < rule.attempt) return false;
      const matches = ({ type, targetId, expected }) =>
        type === "flag"
          ? knownFlags.has(targetId) && flags.has(targetId) === expected
          : knownItems.has(targetId) && visits.has(targetId) === expected;
      return (
        !rule.conditions.length ||
        (rule.conditionMode === "any"
          ? rule.conditions.some(matches)
          : rule.conditions.every(matches))
      );
    }) || (item.fallbackEnabled ? item : null)
  );
}

export function investigationTiming(rule) {
  if (rule.timing === "any") return "任意次数";
  return `第 ${rule.attempt} 次${rule.timing === "from" ? "及以后" : ""}`;
}

export function investigationConditionText(condition, itemName, flagName) {
  return condition.type === "investigated"
    ? (condition.expected ? "调查过" : "还没调查") +
        (itemName(condition.targetId) || "（缺失卡片）")
    : (condition.expected ? "" : "未达成 ") +
        (flagName(condition.targetId) || "（缺失条件）");
}
