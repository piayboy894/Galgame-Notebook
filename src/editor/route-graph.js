import { flattenRows, stageRootRows } from "../domain/project.js";
import { safeColor } from "../domain/primitives.js";
import {
  $,
  $$,
  C,
  R,
  S,
  attr,
  btn,
  esc,
  ib,
  ico,
  linesOf,
  routeChapters,
  state,
} from "./context.js";
import { go, isUnlocked, mutate, render, ruleTitle } from "./session.js";
import { rulesDialog } from "./dialogs.js";

export function boardGeometry() {
  const w = Math.max(420, state.project.routes.length * 354 + 78),
    h = Math.max(620, ...state.project.chapters.map((c) => c.y + 290));
  return { w, h };
}

export function nodePos(c) {
  return {
    x:
      54 +
      Math.max(
        0,
        state.project.routes.findIndex((r) => r.id === c.routeId),
      ) *
        354,
    y: c.y,
    w: 276,
    h: 136,
  };
}

export function ruleEdges() {
  const edges = [];
  for (const c of state.project.chapters) {
    for (const r of c.unlock.rules) {
      let from =
        r.type === "chapter"
          ? C(r.targetId)
          : r.type === "stage"
            ? S(r.targetId)?.chapter
            : null;
      if (from)
        edges.push({ from: from.id, to: c.id, ruleId: r.id, type: r.type });
    }
    for (const s of c.stages)
      for (const row of flattenRows(stageRootRows(s)))
        if (row.type === "branch")
          for (const op of row.options) {
            if (op.mode === "jump" && C(op.chapterId) && op.chapterId !== c.id)
              edges.push({
                from: c.id,
                to: op.chapterId,
                type: "choice",
                rowId: row.id,
                stageId: s.id,
                label: op.text,
              });
          }
  }
  return edges;
}

export function nodeRect(c) {
  const el = $(`.chapter-card[data-id="${c.id}"]`, $("#board"));
  if (!el) return nodePos(c);
  return {
    x: el.offsetLeft,
    y: el.offsetTop,
    w: el.offsetWidth,
    h: el.offsetHeight,
  };
}

export // v1.4: obstacle-aware orthogonal edge routing, softly rounded at every bend.
// The planner sees the actual card rectangles and routes already placed.
function edgeSides(a, b, same) {
  if (same) return { from: "right", to: "top" };
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) > Math.max(90, Math.min(a.w, b.w) * 0.4))
    return dx >= 0
      ? { from: "right", to: "left" }
      : { from: "left", to: "right" };
  return dy >= 0
    ? { from: "bottom", to: "top" }
    : { from: "top", to: "bottom" };
}

export function portPoint(rect, side, shift, escape = false) {
  const d = escape ? 20 : 3;
  if (side === "left") return { x: rect.x - d, y: rect.y + rect.h / 2 + shift };
  if (side === "right")
    return { x: rect.x + rect.w + d, y: rect.y + rect.h / 2 + shift };
  if (side === "top") return { x: rect.x + rect.w / 2 + shift, y: rect.y - d };
  return { x: rect.x + rect.w / 2 + shift, y: rect.y + rect.h + d };
}

export function samePoint(a, b) {
  return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05;
}

export function compactPoints(raw) {
  const pts = [];
  for (const p of raw) {
    if (!pts.length || !samePoint(pts[pts.length - 1], p)) pts.push(p);
  }
  for (let i = 1; i + 1 < pts.length;) {
    const a = pts[i - 1],
      b = pts[i],
      c = pts[i + 1];
    if (
      (Math.abs(a.x - b.x) < 0.05 && Math.abs(b.x - c.x) < 0.05) ||
      (Math.abs(a.y - b.y) < 0.05 && Math.abs(b.y - c.y) < 0.05)
    )
      pts.splice(i, 1);
    else i++;
  }
  return pts;
}

export function roundedEdgePath(points) {
  const p = compactPoints(points),
    fmt = (n) => (Math.round(n * 10) / 10).toString();
  if (p.length < 2) return "";
  let d = `M ${fmt(p[0].x)} ${fmt(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1],
      b = p[i],
      c = p[i + 1];
    const u = Math.hypot(b.x - a.x, b.y - a.y),
      v = Math.hypot(c.x - b.x, c.y - b.y);
    if (u < 0.01 || v < 0.01) continue;
    const radius = Math.min(17, u * 0.43, v * 0.43);
    const pre = {
      x: b.x - ((b.x - a.x) / u) * radius,
      y: b.y - ((b.y - a.y) / u) * radius,
    };
    const post = {
      x: b.x + ((c.x - b.x) / v) * radius,
      y: b.y + ((c.y - b.y) / v) * radius,
    };
    d += ` L ${fmt(pre.x)} ${fmt(pre.y)} Q ${fmt(b.x)} ${fmt(b.y)} ${fmt(post.x)} ${fmt(post.y)}`;
  }
  const last = p[p.length - 1];
  return d + ` L ${fmt(last.x)} ${fmt(last.y)}`;
}

export function edgeSegments(points) {
  const pts = compactPoints(points);
  return pts.slice(1).map((b, i) => ({ a: pts[i], b }));
}

export function segmentPenalty(a, b, routed) {
  const horiz = Math.abs(a.y - b.y) < 0.05;
  const lo1 = horiz ? Math.min(a.x, b.x) : Math.min(a.y, b.y),
    hi1 = horiz ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
  let penalty = 0;
  for (const route of routed)
    for (const line of route) {
      const c = line.a,
        d = line.b,
        otherHorizontal = Math.abs(c.y - d.y) < 0.05;
      if (horiz === otherHorizontal) {
        const sep = horiz ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x);
        if (sep >= 17) continue;
        const lo2 = horiz ? Math.min(c.x, d.x) : Math.min(c.y, d.y),
          hi2 = horiz ? Math.max(c.x, d.x) : Math.max(c.y, d.y);
        const overlap = Math.min(hi1, hi2) - Math.max(lo1, lo2);
        if (overlap > 0)
          penalty +=
            overlap * (sep < 3 ? 3.8 : sep < 9 ? 2.2 : 0.7) +
            (sep < 3 ? 32 : 5);
      } else {
        const hx = horiz ? a : c,
          hy = horiz ? a.y : c.y;
        const x = horiz ? c.x : a.x,
          y = horiz ? a.y : c.y;
        const hmin = horiz ? Math.min(a.x, b.x) : Math.min(c.x, d.x),
          hmax = horiz ? Math.max(a.x, b.x) : Math.max(c.x, d.x);
        const vmin = horiz ? Math.min(c.y, d.y) : Math.min(a.y, b.y),
          vmax = horiz ? Math.max(c.y, d.y) : Math.max(a.y, b.y);
        if (
          x >= hmin - 0.001 &&
          x <= hmax + 0.001 &&
          y >= vmin - 0.001 &&
          y <= vmax + 0.001
        )
          penalty += 53;
      }
    }
  return penalty;
}

export function planGrid(start, end, rects, routed, W, H) {
  const inset = 14,
    xs = [12, W - 12, start.x, end.x, (start.x + end.x) / 2],
    ys = [78, H - 20, start.y, end.y, (start.y + end.y) / 2];
  const rect = rects.map((r) => ({
    l: r.x - inset,
    t: r.y - inset,
    r: r.x + r.w + inset,
    b: r.y + r.h + inset,
  }));
  rect.forEach((r) => {
    xs.push(r.l, r.r);
    ys.push(r.t, r.b);
  });
  // Dedicated channels through gutters and between chapter rows.
  for (let i = 0; i < state.project.routes.length - 1; i++)
    xs.push(54 + i * 354 + 276 + 39);
  const X = [
    ...new Set(
      xs
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= W)
        .map((n) => Math.round(n * 10) / 10),
    ),
  ].sort((a, b) => a - b);
  const Y = [
    ...new Set(
      ys
        .filter((n) => Number.isFinite(n) && n >= 0 && n <= H)
        .map((n) => Math.round(n * 10) / 10),
    ),
  ].sort((a, b) => a - b);
  const nx = X.length,
    ny = Y.length;
  const sx = X.indexOf(Math.round(start.x * 10) / 10),
    sy = Y.indexOf(Math.round(start.y * 10) / 10),
    tx = X.indexOf(Math.round(end.x * 10) / 10),
    ty = Y.indexOf(Math.round(end.y * 10) / 10);
  if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null;
  const pointOk = (x, y) =>
    !rect.some(
      (r) =>
        x > r.l + 0.05 && x < r.r - 0.05 && y > r.t + 0.05 && y < r.b - 0.05,
    );
  const isFree = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++)
    for (let x = 0; x < nx; x++)
      isFree[y * nx + x] = pointOk(X[x], Y[y]) ? 1 : 0;
  const clear = (ax, ay, bx, by) => {
    if (Math.abs(ay - by) < 0.001) {
      const l = Math.min(ax, bx),
        h = Math.max(ax, bx);
      return !rect.some(
        (r) =>
          ay > r.t + 0.05 &&
          ay < r.b - 0.05 &&
          l < r.r - 0.05 &&
          h > r.l + 0.05,
      );
    }
    const l = Math.min(ay, by),
      h = Math.max(ay, by);
    return !rect.some(
      (r) =>
        ax > r.l + 0.05 && ax < r.r - 0.05 && l < r.b - 0.05 && h > r.t + 0.05,
    );
  };
  const length = nx * ny * 5,
    dist = new Float64Array(length).fill(Infinity),
    prev = new Int32Array(length).fill(-1);
  const startKey = (sy * nx + sx) * 5 + 4;
  dist[startKey] = 0;
  const heap = [];
  const put = (key, score) => {
    const p = { key, score };
    heap.push(p);
    let i = heap.length - 1;
    while (i) {
      const j = (i - 1) >> 1;
      if (heap[j].score <= p.score) break;
      heap[i] = heap[j];
      i = j;
    }
    heap[i] = p;
  };
  const take = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        const l = i * 2 + 1,
          r = l + 1;
        if (l >= heap.length) break;
        let j = r < heap.length && heap[r].score < heap[l].score ? r : l;
        if (heap[j].score >= last.score) break;
        heap[i] = heap[j];
        i = j;
      }
      heap[i] = last;
    }
    return top;
  };
  const heuristic = (ix, iy) =>
    Math.abs(X[ix] - end.x) + Math.abs(Y[iy] - end.y);
  put(startKey, heuristic(sx, sy));
  const steps = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let reached = -1,
    iter = 0;
  while (heap.length && iter++ < 240000) {
    const h = take(),
      key = h.key,
      d = key % 5,
      loc = (key - d) / 5,
      ix = loc % nx,
      iy = Math.floor(loc / nx);
    if (h.score > dist[key] + heuristic(ix, iy) + 0.01) continue;
    if (ix === tx && iy === ty) {
      reached = key;
      break;
    }
    for (let k = 0; k < 4; k++) {
      const x = ix + steps[k][0],
        y = iy + steps[k][1];
      if (x < 0 || y < 0 || x >= nx || y >= ny || !isFree[y * nx + x]) continue;
      if (!clear(X[ix], Y[iy], X[x], Y[y])) continue;
      const p = { x: X[ix], y: Y[iy] },
        q = { x: X[x], y: Y[y] };
      const base = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      const turn = d === 4 || d === k ? 0 : 23;
      const bias =
        d !== 4 &&
        ((d === 0 && k === 1) ||
          (d === 1 && k === 0) ||
          (d === 2 && k === 3) ||
          (d === 3 && k === 2))
          ? 120
          : 0;
      const cost =
        dist[key] + base + turn + bias + segmentPenalty(p, q, routed);
      const next = (y * nx + x) * 5 + k;
      if (cost + 1e-7 < dist[next]) {
        dist[next] = cost;
        prev[next] = key;
        put(next, cost + heuristic(x, y));
      }
    }
  }
  if (reached < 0) return null;
  const pts = [];
  for (let k = reached; k >= 0; k = prev[k]) {
    const idx = Math.floor(k / 5);
    pts.push({ x: X[idx % nx], y: Y[Math.floor(idx / nx)] });
    if (k === startKey) break;
  }
  return compactPoints(pts.reverse());
}

export function edgeVisibilityFallback(start, end, rects, W, H) {
  // A deterministic fail-safe if a draft has illegally overlapping cards.
  return compactPoints([
    start,
    { x: start.x, y: 78 },
    { x: end.x, y: 78 },
    end,
  ]);
}

export function edgesHTML() {
  const arrows = `<defs>
  <marker id="arrow-flow" viewBox="0 0 12 12" refX="10.5" refY="6" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto"><path d="M1.2 2.2 L10.5 6 L1.2 9.8 Z" fill="#9bb5bf" stroke="none"/></marker>
  <marker id="arrow-choice" viewBox="0 0 12 12" refX="10.5" refY="6" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto"><path d="M1.2 2.2 L10.5 6 L1.2 9.8 Z" fill="#86a9a8" stroke="none"/></marker>
 </defs>`;
  const all = ruleEdges().filter((e) => C(e.from) && C(e.to));
  if (!all.length) return arrows;
  const rectangles = new Map(
    state.project.chapters.map((c) => [c.id, nodeRect(c)]),
  );
  const obstacles = [...rectangles.values()];
  // Lane add-buttons are also excluded, otherwise a connection vanishes behind them.
  $$(".lane-add", $("#board")).forEach((el) =>
    obstacles.push({
      x: el.offsetLeft,
      y: el.offsetTop,
      w: el.offsetWidth,
      h: el.offsetHeight,
    }),
  );
  const w = boardGeometry().w,
    h = boardGeometry().h;
  for (const e of all) {
    e.sides = edgeSides(
      rectangles.get(e.from),
      rectangles.get(e.to),
      e.from === e.to,
    );
    e.offsetStart = 0;
    e.offsetEnd = 0;
  }
  // Separate both source and destination ports. Sorting gives stable, non-jittery placement.
  const grouped = new Map();
  for (const e of all)
    for (const end of ["from", "to"]) {
      const key = e[end] + ":" + e.sides[end] + ":" + end;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ e, end });
    }
  for (const arr of grouped.values()) {
    arr.sort((a, b) => {
      const r1 = rectangles.get(a.end === "from" ? a.e.to : a.e.from),
        r2 = rectangles.get(b.end === "from" ? b.e.to : b.e.from);
      const side = a.e.sides[a.end];
      const v1 =
        side === "left" || side === "right" ? r1.y + r1.h / 2 : r1.x + r1.w / 2;
      const v2 =
        side === "left" || side === "right" ? r2.y + r2.h / 2 : r2.x + r2.w / 2;
      return (
        v1 - v2 ||
        String(a.e.ruleId || a.e.rowId || "").localeCompare(
          String(b.e.ruleId || b.e.rowId || ""),
        )
      );
    });
    const spacing = Math.min(23, 90 / Math.max(1, arr.length - 1));
    arr.forEach(
      (x, i) =>
        (x.e[x.end === "from" ? "offsetStart" : "offsetEnd"] =
          (i - (arr.length - 1) / 2) * spacing),
    );
  }
  // Short/local connections reserve their preferred channels first. Long bypasses
  // then find alternate corridors instead of sitting directly atop earlier links.
  all.sort((a, b) => {
    const A = rectangles.get(a.from),
      B = rectangles.get(a.to),
      C0 = rectangles.get(b.from),
      D = rectangles.get(b.to);
    const d1 = Math.hypot(A.x - B.x, A.y - B.y),
      d2 = Math.hypot(C0.x - D.x, C0.y - D.y);
    return (
      d1 - d2 ||
      String(a.ruleId || a.rowId || "").localeCompare(
        String(b.ruleId || b.rowId || ""),
      )
    );
  });
  const reserved = [];
  const html = all.map((e) => {
    const a = rectangles.get(e.from),
      b = rectangles.get(e.to),
      from = e.sides.from,
      to = e.sides.to;
    const p = portPoint(a, from, e.offsetStart),
      q = portPoint(b, to, e.offsetEnd),
      start = portPoint(a, from, e.offsetStart, true),
      end = portPoint(b, to, e.offsetEnd, true);
    let core = planGrid(start, end, obstacles, reserved, w, h);
    if (!core) core = edgeVisibilityFallback(start, end, obstacles, w, h);
    const pts = compactPoints([p, start, ...core, end, q]);
    const d = roundedEdgePath(pts),
      choice = e.type === "choice";
    // Only the main grid route participates in congestion detection: the fixed
    // 17px terminal port-stubs may meet by design at a shared node.
    reserved.push(edgeSegments(core));
    return `<g class="edge-group" data-edge-to="${attr(e.to)}" data-edge-from="${attr(e.from)}" data-edge-type="${e.type}" data-stage="${attr(e.stageId || "")}"><title>${esc(choice ? "分支：" + (e.label || "未命名选项") : "完成 " + (C(e.from)?.title || "") + " → " + (C(e.to)?.title || ""))}</title><path class="edge-hit" d="${d}"/><path class="edge-line ${choice ? "branch" : ""}" marker-end="url(#${choice ? "arrow-choice" : "arrow-flow"})" d="${d}"/></g>`;
  });
  return arrows + html.join("");
}

export function updateEdges() {
  const svg = $("#edges");
  if (!svg) return;
  svg.innerHTML = edgesHTML();
  $$(".edge-group", svg).forEach((g) =>
    g.addEventListener("click", () => {
      if (g.dataset.edgeType === "choice")
        go("stage", g.dataset.edgeFrom, g.dataset.stage);
      else rulesDialog(g.dataset.edgeTo);
    }),
  );
}

export function scheduleEdges() {
  if (state.edgeFrame) return;
  state.edgeFrame = requestAnimationFrame(() => {
    state.edgeFrame = 0;
    updateEdges();
  });
}

export function renderBoard(e) {
  const { w, h } = boardGeometry();
  e.innerHTML = `<div class="view-head"><div class="view-title"><h1>路线图</h1><span class="count">${state.project.routes.length} 条路线 · ${state.project.chapters.length} 章</span></div><div class="view-actions">${state.sim.active ? `<span class="sim-indicator desktop-only">演练中</span><div class="sim-controls">${btn("条件", "flag", "sim-flags", "ghost small")}${ib("reset", "sim-reset", "重置演练")}</div>` : ""}${btn("角色", "users", "characters", "ghost")}${btn("地点", "map", "locations", "ghost")}${btn(state.sim.active ? "结束" : "演练", state.sim.active ? "stop" : "play", "sim-toggle", state.sim.active ? "active" : "ghost")}${btn("章节", "plus", "add-chapter", "primary")}${ib("dots", "board-menu", "路线设置")}</div></div><div id="graph-viewport" class="graph-viewport ${state.connectFrom ? "connecting" : ""}"><div class="board-wrap" id="board-wrap" style="width:${w * state.zoom}px;height:${h * state.zoom}px"><div id="board" class="board" style="width:${w}px;height:${h}px;transform:scale(${state.zoom})">${state.project.routes
    .map((r, i) => {
      const x = 54 + i * 354,
        last = Math.max(112, ...routeChapters(r.id).map((c) => c.y)) + 173;
      return `<div class="route-lane" style="left:${x - 15}px;height:${h - 48}px"></div><div class="lane-head" style="left:${x}px"><i class="route-dot" style="background:${safeColor(r.color)}"></i><span class="lane-name">${esc(r.name)}</span>${ib("dots", "route-menu", "管理路线", `data-id="${attr(r.id)}"`)}</div><button class="lane-add" data-act="lane-add" data-id="${attr(r.id)}" style="left:${x}px;top:${last}px" title="沿此路线添加章节">${ico("plus")}</button>`;
    })
    .join(
      "",
    )}<svg class="edge-layer" id="edges" viewBox="0 0 ${w} ${h}" style="width:${w}px;height:${h}px"></svg>${state.project.chapters.map((c) => cardHTML(c)).join("")}</div></div></div><div class="board-tools">${ib("minus", "zoom-out", "缩小")}<button class="zoom-value" data-act="zoom-reset" title="恢复 100%">${Math.round(state.zoom * 100)}%</button>${ib("plus", "zoom-in", "放大")}<span class="divider"></span>${ib("fit", "fit-board", "适应画布")}${ib("link", "connection-toggle", state.connectFrom ? "取消连线" : "点击章节下方圆点，再点击目标章节上方圆点")}${state.connectFrom ? btn("取消", null, "cancel-connect", "ghost small") : ""}</div>`;
  const vp = $("#graph-viewport");
  vp.scrollLeft = state.boardScroll.x;
  vp.scrollTop = state.boardScroll.y;
  centerBoard();
  vp.addEventListener(
    "wheel",
    (ev) => {
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        setZoom(state.zoom * (ev.deltaY > 0 ? 0.9 : 1.1));
      }
    },
    { passive: false },
  );
  $$(".chapter-card").forEach((card) => attachCardDrag(card));
  updateEdges();
}

export function cardHTML(c) {
  const p = nodePos(c),
    rt = R(c.routeId),
    cnt = routeChapters(c.routeId).findIndex((x) => x.id === c.id) + 1;
  const count = c.unlock.rules.length,
    locked = state.sim.active && !isUnlocked(c),
    done = state.sim.active && state.sim.chapters.has(c.id);
  const rs = count
    ? (c.unlock.mode === "all" ? "全部" : "任一") + " · " + count
    : "起点";
  return `<article class="chapter-card ${done ? "completed" : ""} ${locked ? "blocked" : ""}" data-id="${attr(c.id)}" style="left:${p.x}px;top:${p.y}px" tabindex="0" aria-label="${attr(c.title)}"><button class="port in" data-act="port-in" data-id="${attr(c.id)}" title="连接前置章节" aria-label="连接到 ${attr(c.title)}"></button><div class="card-top">${state.sim.active ? `<button class="sim-check ${done ? "done" : ""} ${locked ? "locked" : ""}" data-act="complete-chapter" data-id="${attr(c.id)}" title="${locked ? "尚未解锁" : done ? "取消完成" : "标记完成"}">${locked ? ico("lock") : done ? ico("check") : ""}</button>` : `<span style="color:${safeColor(rt?.color)}">${String(cnt).padStart(2, "0")}</span>`}<span>${c.ending === "pause" ? '<span class="pause-pill">待续</span>' : c.ending === "end" ? '<span class="pause-pill end-pill">终章</span>' : ""}</span>${ib("dots", "chapter-menu", "章节操作", `data-id="${attr(c.id)}"`)}</div><div class="card-title" data-act="open-chapter" data-id="${attr(c.id)}" title="${attr(c.title)}">${esc(c.title)}</div><div class="card-footer"><span>${c.stages.length} 阶段</span><span>·</span><span>${linesOf(c)} 行</span><button class="rule-chip" data-act="rules" data-id="${attr(c.id)}" title="${attr(count ? c.unlock.rules.map(ruleTitle).join("\n") : "无前置条件")}">${ico(count ? "link" : "play")}${rs}</button></div><button class="port out ${state.connectFrom === c.id ? "armed" : ""}" data-act="port-out" data-id="${attr(c.id)}" title="从此章节连接到下一章" aria-label="从 ${attr(c.title)} 连接"></button></article>`;
}

export function centerBoard() {
  const vp = $("#graph-viewport"),
    b = $("#board");
  if (vp && b)
    b.style.left =
      Math.max(0, (vp.clientWidth - boardGeometry().w * state.zoom) / 2) + "px";
}

export function setZoom(z) {
  const vp = $("#graph-viewport");
  if (vp) state.boardScroll = { x: vp.scrollLeft, y: vp.scrollTop };
  const old = state.zoom;
  state.zoom = Math.max(0.35, Math.min(1.6, z));
  state.boardScroll = {
    x: (state.boardScroll.x * state.zoom) / old,
    y: (state.boardScroll.y * state.zoom) / old,
  };
  state.skipBoardCapture = true;
  render();
}

export function fitBoard() {
  const vp = $("#graph-viewport");
  if (!vp) return;
  const { w, h } = boardGeometry();
  state.zoom = Math.max(
    0.35,
    Math.min(1, (vp.clientWidth - 24) / w, (vp.clientHeight - 16) / h),
  );
  state.boardScroll = { x: 0, y: 0 };
  state.skipBoardCapture = true;
  render();
}

export function attachCardDrag(el) {
  el.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0 || ev.target.closest("button")) return;
    const c = C(el.dataset.id);
    if (!c) return;
    const orig = {
        x: ev.clientX,
        y: ev.clientY,
        routeId: c.routeId,
        yPos: c.y,
      },
      pos = nodePos(c);
    let moved = false,
      dx = 0,
      dy = 0;
    el.setPointerCapture(ev.pointerId);
    const move = (e) => {
      dx = (e.clientX - orig.x) / state.zoom;
      dy = (e.clientY - orig.y) / state.zoom;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 7) {
        moved = true;
        el.classList.add("dragging");
      }
      if (moved) {
        el.style.left = pos.x + dx + "px";
        el.style.top = Math.max(100, pos.y + dy) + "px";
        scheduleEdges();
      }
    };
    const finish = (e) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", cancel);
      if (el.hasPointerCapture(e.pointerId))
        el.releasePointerCapture(e.pointerId);
      state.dragSuppressUntil = Date.now() + 250;
      state.dragSource = "chapter";
      if (moved) {
        const ri = Math.max(
            0,
            Math.min(
              state.project.routes.length - 1,
              Math.round((pos.x + dx - 54) / 354),
            ),
          ),
          routeId = state.project.routes[ri].id;
        let y = Math.max(
          112,
          Math.round((orig.yPos + dy - 112) / 20) * 20 + 112,
        );
        y = freeY(routeId, y, c.id);
        mutate(() => {
          c.routeId = routeId;
          c.y = y;
        });
      } else go("chapter", c.id);
    };
    const cancel = (e) => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", finish);
      el.removeEventListener("pointercancel", cancel);
      render();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", cancel);
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target === el) {
      ev.preventDefault();
      go("chapter", el.dataset.id);
    }
  });
}

export function freeY(routeId, y, exclude = "") {
  let n = 0;
  while (
    state.project.chapters.some(
      (c) =>
        c.id !== exclude && c.routeId === routeId && Math.abs(c.y - y) < 165,
    ) &&
    n++ < state.project.chapters.length + 2
  )
    y += 180;
  return y;
}
