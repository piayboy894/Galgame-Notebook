import { INVESTIGATION_CARD } from "./investigation.js";

const stepX = INVESTIGATION_CARD.width + INVESTIGATION_CARD.gap;
const stepY = INVESTIGATION_CARD.height + INVESTIGATION_CARD.gap;

export function snapInvestigationPosition({ x, y }) {
  const snap = (value, step) => {
    const limit = Math.floor(Number.MAX_SAFE_INTEGER / step);
    return Math.max(-limit, Math.min(limit, Math.round(value / step))) * step || 0;
  };
  return { x: snap(x, stepX), y: snap(y, stepY) };
}

export const investigationCellKey = ({ x, y }) => `${x},${y}`;

export function freeInvestigationPosition(origin, occupied, offsets = [{ x: 0, y: 0 }]) {
  const start = snapInvestigationPosition(origin);
  const free = (x, y) => Number.isSafeInteger(x) && Number.isSafeInteger(y) &&
    offsets.every(({ x: dx, y: dy }) =>
      !occupied.has(investigationCellKey({ x: x + dx, y: y + dy })));
  if (free(start.x, start.y)) return start;

  // Search neighboring cells in rings, preferring space to the right and below.
  for (let ring = 1; ; ring++) {
    for (let row = 0; row <= ring; row++) {
      const col = ring - row;
      const dx = col * stepX, dy = row * stepY;
      for (const x of col ? [start.x + dx, start.x - dx] : [start.x]) {
        for (const y of row ? [start.y + dy, start.y - dy] : [start.y]) {
          if (free(x, y)) return { x, y };
        }
      }
    }
  }
}

export function alignInvestigationPositions(items) {
  const occupied = new Set();
  const collisions = [];
  for (const item of items) {
    const position = snapInvestigationPosition(item.position);
    const key = investigationCellKey(position);
    if (occupied.has(key)) collisions.push(item);
    else {
      item.position = position;
      occupied.add(key);
    }
  }
  for (const item of collisions) {
    item.position = freeInvestigationPosition(item.position, occupied);
    occupied.add(investigationCellKey(item.position));
  }
}
