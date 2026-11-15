import {
  effectiveLocation,
  LOCATION_FIELDS,
  normalizeProperties,
  selectedRoots,
} from "../domain/scenes.js";
import { groupDialog } from "./scenes.js";
import { isAndroid } from "../platform/runtime";
import { clone, uid, safeColor, PALETTE } from "../domain/primitives.js";
import { flattenRows, regenRowIds, line } from "../domain/project.js";
import {
  currentInvestigationItem,
  currentRows,
  go,
  mutate,
  rowLocation,
  selectableRows,
  toast,
} from "./session.js";
import {
  $,
  $$,
  C,
  P,
  R,
  btn,
  currentStage,
  esc,
  ico,
  option,
  state,
} from "./context.js";
import {
  closeModal,
  confirmBox,
  inspectObjectDialog,
  menu,
  modal,
  readStage,
  stageDialog,
} from "./dialogs.js";

export // Clicking the line number selects the complete row. Shift selects an interval;
// Ctrl/Cmd toggles one row without discarding the other selected rows.
function selectedRows() {
  return selectableRows().filter((row) => state.selectedRowIds.has(row.id));
}

export function syncRowSelection() {
  if (state.view.type !== "stage") return;
  const valid = new Set(selectableRows().map((r) => r.id));
  for (const id of [...state.selectedRowIds])
    if (!valid.has(id)) state.selectedRowIds.delete(id);
  $$(".script-row,.branch-script-row").forEach((el) => {
    const active = state.selectedRowIds.has(
      el.dataset.branchRow || el.dataset.row,
    );
    el.classList.toggle("selected", active);
    const select = $(".row-select", el);
    if (select) select.setAttribute("aria-pressed", String(active));
  });
  const bar = $("#selection-toolbar");
  if (!bar) return;
  const count = state.selectedRowIds.size;
  bar.hidden = !count;
  bar.innerHTML = count
    ? `<span class="selected-count">${count} 项</span><button class="selection-action" data-act="group-selected" title="建立场景组 · Ctrl G">${ico("layers")}<span>建组</span></button><button class="selection-action" data-act="copy-rows" title="复制所选行 · Ctrl C">${ico("copy")}<span>复制</span></button><button class="selection-action" data-act="paste-rows" title="粘贴到所选行之后 · Ctrl V">${ico("layers")}<span>粘贴</span></button><button class="selection-action delete-action" data-act="delete-selected" title="删除所选行 · Delete">${ico("trash")}<span>删除</span></button><button class="selection-clear" data-act="clear-rows" title="清除选择" aria-label="清除选择">${ico("close")}</button>`
    : "";
  document.dispatchEvent(new Event("editor:selection"));
}

export function selectRow(id, { shift = false, toggle = false } = {}) {
  const ids = selectableRows().map((r) => r.id),
    index = ids.indexOf(id);
  if (index < 0) return;
  if (shift) {
    let start = ids.indexOf(state.selectionAnchor);
    if (start < 0) start = index;
    if (!toggle) state.selectedRowIds.clear();
    for (let n = Math.min(start, index); n <= Math.max(start, index); n++)
      state.selectedRowIds.add(ids[n]);
  } else if (toggle) {
    if (state.selectedRowIds.has(id)) state.selectedRowIds.delete(id);
    else state.selectedRowIds.add(id);
    state.selectionAnchor = id;
  } else {
    state.selectedRowIds = new Set([id]);
    state.selectionAnchor = id;
  }
  syncRowSelection();
}

export function deleteSelectedRows() {
  if (state.view.type !== "stage" || !state.selectedRowIds.size) return;
  const picked = new Set(state.selectedRowIds),
    rows = currentRows();
  if (!rows) return;
  mutate(() => {
    for (const loc of selectedRoots(rows, picked)) {
      const index = loc.rows.indexOf(loc.row);
      if (index >= 0) loc.rows.splice(index, 1);
    }
    state.selectedRowIds.clear();
    state.selectionAnchor = null;
  });
  toast("已删除选中行 · Ctrl Z 可撤销");
}

export function rowText(rows, characters, locations = []) {
  return rows
    .map((row) => {
      if (row.type === "group") {
        const location = effectiveLocation(row, locations);
        return (
          "〔场景组〕" +
          row.title +
          (location.name ? " · " + location.name : "") +
          (row.notes ? "\n" + row.notes : "") +
          "\n" +
          rowText(row.rows, characters, locations)
        );
      }
      const name =
        characters.find((p) => p.id === row.speakerId)?.name || "旁白";
      if (row.type === "note") return "〔笔记〕" + row.text;
      if (row.type === "effect") return "〔演出〕" + row.text;
      if (row.type === "branch")
        return (
          "〔选项〕" +
          row.text +
          "\n" +
          row.options
            .map(
              (o) =>
                "　- " +
                o.text +
                (o.mode === "jump" ? " → 跳转" : " → 合流") +
                "\n" +
                rowText(o.rows || [], characters, locations)
                  .split("\n")
                  .map((x) => "　　 " + x)
                  .join("\n"),
            )
            .join("\n")
        );
      return (
        `${name}：${row.text}` +
        ([row.expression, row.action].some(Boolean)
          ? " 〔" +
            [row.expression, row.action].filter(Boolean).join(" · ") +
            "〕"
          : "")
      );
    })
    .join("\n");
}

export function collectRows() {
  const rows = clone(
    selectedRoots(currentRows() || [], state.selectedRowIds).map(
      (loc) => loc.row,
    ),
  );
  if (!rows.length) return null;
  const chars = clone(
    state.project.characters.filter((p) =>
      flattenRows(rows).some((row) => row.speakerId === p.id),
    ),
  );
  return {
    format: "xuxian.rows.v2",
    locations: clone(
      state.project.locations.filter((location) =>
        flattenRows(rows).some(
          (row) => row.type === "group" && row.locationId === location.id,
        ),
      ),
    ),
    projectId: state.project.id,
    rows,
    characters: chars,
  };
}

export function rememberRows(bundle) {
  if (!bundle) return null;
  const plain = rowText(
    bundle.rows,
    bundle.characters || [],
    bundle.locations || [],
  );
  state.rowClipboard = { ...bundle, text: plain };
  return state.rowClipboard;
}

export function copyRowsButton() {
  const payload = rememberRows(collectRows());
  if (!payload) return toast("请先选择对白行");
  // The system clipboard is for external apps, the internal typed clipboard keeps full metadata.
  if (navigator.clipboard?.writeText)
    navigator.clipboard.writeText(payload.text).catch(() => {});
  toast("已复制 " + payload.rows.length + " 行");
}

export function parseRows(raw) {
  try {
    const data = JSON.parse(raw);
    return ["xuxian.rows.v1", "xuxian.rows.v2"].includes(data?.format) &&
      Array.isArray(data.rows)
      ? data
      : null;
  } catch {
    return null;
  }
}

export function pasteRows(bundle) {
  if (state.view.type !== "stage" || !bundle?.rows?.length) return false;
  const s = currentStage(),
    roots = currentRows();
  if (!roots) return toast("请先添加调查物品");
  const locs = selectedRoots(roots, state.selectedRowIds);
  const sameContainer =
    locs.length > 0 && locs.every((x) => x.rows === locs[0].rows);
  const dest = sameContainer ? locs[0].rows : roots;
  const last = Math.max(
    -1,
    ...dest.map((r, i) => (state.selectedRowIds.has(r.id) ? i : -1)),
  );
  const rows = [];
  const insideOption = sameContainer && !!locs[0].opt;
  const insideGroup =
    sameContainer && locs[0].ancestors.some((row) => row.type === "group");
  let prepared, incomingLocations;
  try {
    prepared = clone(bundle.rows).map((raw) => normalizeCopiedRow(raw));
    incomingLocations = (
      Array.isArray(bundle.locations) ? bundle.locations : []
    ).map((location) => ({
      id: String(location.id || ""),
      name: String(location.name || "未命名地点"),
      background: String(location.background || ""),
      bgm: String(location.bgm || ""),
      ambience: String(location.ambience || ""),
      notes: String(location.notes || ""),
      properties: normalizeProperties(location.properties),
    }));
  } catch (error) {
    toast("无法粘贴：" + error.message, true);
    return false;
  }
  prepared = prepared.filter(
    (row) =>
      !(
        insideOption &&
        flattenRows([row]).some((item) => item.type === "branch")
      ) &&
      !(
        insideGroup && flattenRows([row]).some((item) => item.type === "group")
      ),
  );
  if (!prepared.length) return toast("当前位置不支持嵌套选项或场景组", true);
  const locationRefs = new Map();
  mutate(() => {
    const chars = Array.isArray(bundle.characters) ? bundle.characters : [],
      charRefs = new Map();
    for (const r of prepared) {
      for (const group of flattenRows([r]).filter(
        (row) => row.type === "group" && row.locationId,
      )) {
        if (
          bundle.projectId === state.project.id &&
          state.project.locations.some(
            (location) => location.id === group.locationId,
          )
        )
          continue;
        const source = incomingLocations.find(
          (location) => location.id === group.locationId,
        );
        if (!source) {
          group.locationId = "";
          continue;
        }
        if (!locationRefs.has(source.id)) {
          const { id: oldId, ...properties } = source;
          let found = state.project.locations.find((location) => {
            const { id, ...value } = location;
            return JSON.stringify(value) === JSON.stringify(properties);
          });
          if (!found) {
            let name = source.name;
            let number = 2;
            while (
              state.project.locations.some((location) => location.name === name)
            )
              name = source.name + " (" + number++ + ")";
            found = { ...source, id: uid("location"), name };
            state.project.locations.push(found);
          }
          locationRefs.set(source.id, found.id);
        }
        group.locationId = locationRefs.get(source.id);
      }
      for (const item of flattenRows([r])) {
        if (
          item.speakerId &&
          (bundle.projectId !== state.project.id || !P(item.speakerId))
        ) {
          const old = chars.find((c) => c.id === item.speakerId);
          if (old) {
            let found = state.project.characters.find(
              (c) => c.name === old.name,
            );
            if (!found) {
              found = {
                id: uid("char"),
                name: String(old.name || "未命名角色"),
                color: safeColor(old.color),
                notes: String(old.notes || ""),
                expressions: Array.isArray(old.expressions)
                  ? old.expressions
                  : [],
                actions: Array.isArray(old.actions) ? old.actions : [],
              };
              state.project.characters.push(found);
            }
            charRefs.set(item.speakerId, found.id);
          }
          item.speakerId = charRefs.get(item.speakerId) || "";
        }
      }
      // A local option's dialogue cannot contain another branch container.

      regenRowIds(r);
      for (const item of flattenRows([r]))
        if (item.type === "branch")
          for (const op of item.options) {
            if (!C(op.chapterId)) {
              op.chapterId = "";
              op.stageId = "";
            } else if (
              op.stageId &&
              !C(op.chapterId).stages.some((st) => st.id === op.stageId)
            )
              op.stageId = "";
          }
      rows.push(r);
    }
    if (rows.length) {
      dest.splice(last < 0 ? dest.length : last + 1, 0, ...rows);
      state.selectedRowIds = new Set(rows.map((r) => r.id));
      state.selectionAnchor = rows[0].id;
    }
  });
  if (!rows.length) return toast("选项内部仅支持对白、描述和笔记行");
  requestAnimationFrame(() => {
    $(
      `[data-row="${rows[0].id}"],[data-branch-row="${rows[0].id}"]`,
    )?.scrollIntoView({ block: "nearest" });
  });
  toast("已粘贴 " + rows.length + " 行");
  return true;
}

export function normalizeCopiedRow(
  raw,
  insideOption = false,
  inGroup = false,
  depth = 0,
) {
  if (depth > 12) throw Error("脚本结构嵌套过深");
  const text = (value) => (typeof value === "string" ? value : "");
  if (raw?.type === "group") {
    if (inGroup) throw Error("场景组不支持嵌套");
    const overrides = {};
    for (const field of LOCATION_FIELDS)
      if (Object.hasOwn(raw.overrides || {}, field.key))
        overrides[field.key] = text(raw.overrides[field.key]);
    if (Object.hasOwn(raw.overrides || {}, "properties"))
      overrides.properties = normalizeProperties(raw.overrides.properties);
    return {
      id: uid("group"),
      type: "group",
      title: text(raw.title) || "新场景组",
      locationId: text(raw.locationId),
      notes: text(raw.notes),
      overrides,
      rows: (Array.isArray(raw.rows) ? raw.rows : []).map((row) =>
        normalizeCopiedRow(row, insideOption, true, depth + 1),
      ),
    };
  }
  const rawType = raw?.type;
  let type = ["dialogue", "note", "effect", "branch"].includes(rawType)
    ? rawType
    : ["choice", "localChoice"].includes(rawType)
      ? "branch"
      : "dialogue";
  if (insideOption && type === "branch") throw Error("选项中不能嵌套选项组");
  const row = {
    id: uid("line"),
    type,
    speakerId: text(raw?.speakerId),
    text: text(raw?.text),
    expression: text(raw?.expression),
    action: text(raw?.action),
    options: [],
  };
  if (type === "branch")
    row.options = (Array.isArray(raw.options) ? raw.options : []).map(
      (option) => ({
        id: uid("opt"),
        text: text(option?.text),
        mode:
          rawType === "choice"
            ? "jump"
            : rawType === "localChoice"
              ? "continue"
              : option?.mode === "jump"
                ? "jump"
                : "continue",
        chapterId: text(option?.chapterId),
        stageId: text(option?.stageId),
        rows: (Array.isArray(option?.rows) ? option.rows : []).map((child) =>
          normalizeCopiedRow(child, true, inGroup, depth + 1),
        ),
      }),
    );
  return row;
}

export function pasteRowsButton() {
  if (!state.rowClipboard) return toast("请先复制对白行");
  pasteRows(state.rowClipboard);
}

export function rowsAreEditable(target) {
  return !!target?.closest?.('textarea,input,select,[contenteditable="true"]');
}

export function hasNativeTextSelection(target) {
  if (!rowsAreEditable(target)) return false;
  if (typeof target.selectionStart === "number")
    return target.selectionStart !== target.selectionEnd;
  return !!String(getSelection());
}

export // v1.8 — quiet, pointer/touch-aware row ordering. No HTML5 draggable handles.
function setupRowDrag() {
  const sc = $(".script-scroll");
  if (!sc) return;
  let session = null,
    animationFrame = 0;
  const reduced = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const isRow = (e) => e?.closest?.(".branch-script-row,.script-row");
  const isEditableControl = (target) => {
    const control = target.closest(
      'input,textarea,select,option,a,[contenteditable="true"],[role="textbox"],label,[data-act]',
    );
    // Short click selects a line; holding its number can still start a drag.
    if (target.closest(".row-select,.drag-handle")) return false;
    return !!control || !!target.closest("button");
  };
  function eligible(target) {
    if (
      state.view.type !== "stage" ||
      $("#modal-root").firstChild ||
      isEditableControl(target)
    )
      return null;
    const el = isRow(target);
    if (!el || !sc.contains(el)) return null;
    const id = el.dataset.branchRow || el.dataset.row,
      loc = rowLocation(id);
    return loc?.rows &&
      Array.from(el.parentElement.children).filter((x) =>
        x.matches(".script-row,.branch-script-row"),
      ).length > 0
      ? { el, id, loc }
      : null;
  }
  function clean() {
    if (!session) return;
    clearTimeout(session.holdTimer);
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    window.removeEventListener("pointermove", pointerMove, true);
    window.removeEventListener("pointerup", pointerUp, true);
    window.removeEventListener("pointercancel", pointerCancel, true);
    window.removeEventListener("touchmove", touchMove, true);
    window.removeEventListener("touchend", touchEnd, true);
    window.removeEventListener("touchcancel", touchCancel, true);
    window.removeEventListener("keydown", dragKey, true);
    document.body.classList.remove("row-sort-active");
    session.el.classList.remove("drag-pending", "drag-origin");
    if (session.ghost?.isConnected) session.ghost.remove();
    session = null;
  }
  function beginDrag() {
    const s = session;
    if (!s || s.active || !s.el.isConnected) return;
    s.active = true;
    s.el.classList.remove("drag-pending");
    s.el.classList.add("drag-origin");
    document.body.classList.add("row-sort-active");
    window.addEventListener("keydown", dragKey, true);
    const row = s.loc.row,
      speaker = P(row.speakerId)?.name || "旁白";
    const symbol =
      row.type === "effect" ? "◌" : row.type === "branch" ? "◇" : "•";
    let sample = String(row.type === "group" ? row.title : row.text || "")
      .trim()
      .replace(/\s+/g, " ");
    if (row.type === "branch" && !sample)
      sample = (row.options || [])
        .map((op) => op.text)
        .filter(Boolean)
        .join(" / ");
    if (!sample) sample = "···";
    s.ghost = document.createElement("div");
    s.ghost.className = "row-drag-ghost";
    s.ghost.innerHTML = `<span class="row-drag-mark">${symbol}</span><span class="row-drag-content"><span class="row-drag-label">${esc(row.type === "effect" ? "演出" : row.type === "branch" ? "选项" : row.type === "note" ? "笔记" : row.type === "group" ? "场景组" : speaker)}</span><span class="row-drag-excerpt">${esc(sample.slice(0, 100))}</span></span>`;
    s.ghost.style.width =
      Math.min(
        490,
        Math.max(230, s.el.getBoundingClientRect().width * 0.65),
        window.innerWidth - 24,
      ) + "px";
    document.body.append(s.ghost);
    placeGhost(s);
    if (s.touch && navigator.vibrate)
      try {
        navigator.vibrate(9);
      } catch (_) {
        /* Optional subtle touch feedback. */
      }
    scheduleAutoScroll();
  }
  function placeGhost(s) {
    if (!s.ghost) return;
    const w = s.ghost.offsetWidth || 300,
      h = s.ghost.offsetHeight || 62;
    s.ghost.style.left =
      Math.min(window.innerWidth - w - 12, Math.max(12, s.x + 16)) + "px";
    s.ghost.style.top =
      Math.min(window.innerHeight - h - 10, Math.max(10, s.y - 22)) + "px";
  }
  function flipArrange(next) {
    const s = session;
    if (!s || !s.active) return;
    const siblings = Array.from(s.container.children).filter((el) =>
      el.matches(".script-row,.branch-script-row"),
    );
    const bounds = sc.getBoundingClientRect();
    const old = new Map();
    for (const el of siblings) {
      const r = el.getBoundingClientRect();
      if (r.bottom >= bounds.top - 180 && r.top <= bounds.bottom + 180)
        old.set(el, r);
    }
    if (next) s.container.insertBefore(s.el, next);
    else s.container.append(s.el);
    if (reduced) return;
    for (const [el, prev] of old) {
      const now = el.getBoundingClientRect(),
        dy = prev.top - now.top;
      if (Math.abs(dy) > 1 && Math.abs(dy) < 900) {
        try {
          el.animate(
            [
              { transform: `translateY(${dy}px)` },
              { transform: "translateY(0)" },
            ],
            { duration: 185, easing: "cubic-bezier(.22,.68,.27,1)" },
          );
        } catch (_) {}
      }
    }
  }
  function arrangeAt(y) {
    const s = session;
    if (!s?.active) return;
    const siblings = Array.from(s.container.children).filter(
      (el) => el !== s.el && el.matches(".script-row,.branch-script-row"),
    );
    if (!siblings.length) return;
    let lo = 0,
      hi = siblings.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1,
        r = siblings[mid].getBoundingClientRect();
      if (y < r.top + r.height * 0.5) hi = mid;
      else lo = mid + 1;
    }
    const before = siblings[lo] || null;
    if (
      before === s.el.nextElementSibling ||
      (!before && s.el === siblings[siblings.length - 1].nextElementSibling)
    )
      return;
    // A single moving placeholder makes insert position immediately clear.
    if (before !== s.el.nextElementSibling) flipArrange(before);
  }
  function move(x, y) {
    const s = session;
    if (!s) return;
    s.x = x;
    s.y = y;
    if (!s.active) {
      const dist = Math.hypot(x - s.startX, y - s.startY);
      if (s.touch) {
        if (dist > 9) cancelDrag();
      } else if (dist > 8) {
        beginDrag();
      }
      return;
    }
    placeGhost(s);
    arrangeAt(y);
  }
  function scheduleAutoScroll() {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    const tick = () => {
      const s = session;
      if (!s?.active) {
        animationFrame = 0;
        return;
      }
      const r = sc.getBoundingClientRect(),
        zone = 56;
      let speed = 0;
      if (s.y < r.top + zone && s.y >= r.top - 32)
        speed = -Math.min(17, (r.top + zone - s.y) * 0.29);
      else if (s.y > r.bottom - zone && s.y <= r.bottom + 32)
        speed = Math.min(17, (s.y - (r.bottom - zone)) * 0.29);
      if (speed && sc.scrollHeight > sc.clientHeight) {
        const before = sc.scrollTop;
        sc.scrollTop += speed;
        if (before !== sc.scrollTop) arrangeAt(s.y);
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
  }
  function start(rowInfo, x, y, touch) {
    if (session) clean();
    const { el, id, loc } = rowInfo;
    session = {
      el,
      id,
      loc,
      container: el.parentElement,
      originIndex: loc.rows.indexOf(loc.row),
      startX: x,
      startY: y,
      x,
      y,
      touch,
      active: false,
      ghost: null,
      holdTimer: 0,
    };
    // Calm, delayed feedback prevents accidental reorders while selecting.
    session.holdTimer = setTimeout(
      () => {
        if (session?.id === id) beginDrag();
      },
      touch ? 280 : 190,
    );
    if (!touch) {
      window.addEventListener("pointermove", pointerMove, true);
      window.addEventListener("pointerup", pointerUp, true);
      window.addEventListener("pointercancel", pointerCancel, true);
    } else {
      window.addEventListener("touchmove", touchMove, {
        capture: true,
        passive: false,
      });
      window.addEventListener("touchend", touchEnd, true);
      window.addEventListener("touchcancel", touchCancel, true);
    }
  }
  function endDrag(cancel = false) {
    const s = session;
    if (!s) return;
    if (!s.active) {
      clean();
      return;
    }
    state.dragSuppressUntil = Date.now() + 360;
    state.dragSource = "row";
    const newIndex = Array.from(s.container.children)
      .filter((el) => el.matches(".script-row,.branch-script-row"))
      .indexOf(s.el);
    const oldIndex = s.originIndex,
      id = s.id;
    // Avoid reordering on loss of focus, Escape, pointer cancellation or failed drop.
    if (cancel || newIndex < 0 || newIndex === oldIndex) {
      if (newIndex !== oldIndex) {
        const other = Array.from(s.container.children).filter((el) =>
          el.matches(".script-row,.branch-script-row"),
        );
        s.container.insertBefore(s.el, other[oldIndex] || null);
      }
      clean();
      return;
    }
    const ghost = s.ghost,
      loc = s.loc,
      sourceEl = s.el;
    session = null;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    window.removeEventListener("pointermove", pointerMove, true);
    window.removeEventListener("pointerup", pointerUp, true);
    window.removeEventListener("pointercancel", pointerCancel, true);
    window.removeEventListener("touchmove", touchMove, true);
    window.removeEventListener("touchend", touchEnd, true);
    window.removeEventListener("touchcancel", touchCancel, true);
    document.body.classList.remove("row-sort-active");
    window.removeEventListener("keydown", dragKey, true);
    sourceEl.classList.remove("drag-origin", "drag-pending");
    if (ghost) {
      if (!reduced) {
        ghost.style.opacity = "0";
        ghost.style.transform = "translateY(5px) scale(.97)";
        setTimeout(() => ghost.remove(), 190);
      } else ghost.remove();
    }
    mutate(() => {
      const index = loc.rows.indexOf(loc.row);
      if (index < 0) return;
      const [item] = loc.rows.splice(index, 1);
      loc.rows.splice(newIndex, 0, item);
    });
    const next = document.querySelector(
      `[data-row="${CSS.escape(id)}"],[data-branch-row="${CSS.escape(id)}"]`,
    );
    if (next) {
      next.classList.add("row-dropped");
      setTimeout(() => next.classList.remove("row-dropped"), 380);
    }
  }
  function cancelDrag() {
    endDrag(true);
  }
  function pointerMove(e) {
    if (!session || session.touch) return;
    move(e.clientX, e.clientY);
    if (session?.active) e.preventDefault();
  }
  function pointerUp(e) {
    if (!session || session.touch) return;
    endDrag();
  }
  function pointerCancel() {
    if (session && !session.touch) cancelDrag();
  }
  function touchMove(e) {
    if (!session?.touch) return;
    const t = [...e.changedTouches].find(
      (t) => t.identifier === session.touchId,
    );
    if (!t) return;
    move(t.clientX, t.clientY);
    if (session?.active && e.cancelable) e.preventDefault();
  }
  function touchEnd(e) {
    if (!session?.touch) return;
    if ([...e.changedTouches].some((t) => t.identifier === session.touchId)) {
      if (session.active && e.cancelable) e.preventDefault();
      endDrag();
    }
  }
  function touchCancel(e) {
    if (session?.touch) cancelDrag();
  }
  function dragKey(e) {
    if (e.key === "Escape" && session?.active) {
      e.preventDefault();
      e.stopPropagation();
      cancelDrag();
    }
  }
  sc.addEventListener("pointerdown", (e) => {
    if (
      e.pointerType === "touch" ||
      e.button !== 0 ||
      e.ctrlKey ||
      e.shiftKey ||
      e.metaKey
    )
      return;
    const rowInfo = eligible(e.target);
    if (rowInfo) start(rowInfo, e.clientX, e.clientY, false);
  });
  sc.addEventListener(
    "touchstart",
    (e) => {
      if (isAndroid || e.touches.length !== 1) return; // Touch scrolls; mouse keeps drag ordering.
      const rowInfo = eligible(e.target);
      if (rowInfo) {
        const t = e.changedTouches[0];
        start(rowInfo, t.clientX, t.clientY, true);
        session.touchId = t.identifier;
      }
    },
    { passive: true },
  );
  sc.addEventListener("dragstart", (e) => {
    if (e.target.closest(".drag-handle")) e.preventDefault();
  });
}

export function insertRowAt(id, type = "dialogue", position = "below") {
  const loc = rowLocation(id);
  if (!loc) return;
  const row = line(type);
  if (type === "dialogue" && loc.row.type === "dialogue") {
    row.speakerId = loc.row.speakerId;
    row.expression = loc.row.expression;
  }
  mutate(() =>
    loc.rows.splice(
      loc.rows.indexOf(loc.row) + (position === "above" ? 0 : 1),
      0,
      row,
    ),
  );
  focusRow(row.id);
}
export function addRow(type = "dialogue", afterId = null) {
  if (afterId) return insertRowAt(afterId, type);
  const rows = currentRows();
  if (!rows) return toast("请先添加调查物品");
  const row = line(type),
    last = rows.at(-1);
  if (type === "dialogue" && last?.type === "dialogue") {
    row.speakerId = last.speakerId;
    row.expression = last.expression;
  }
  mutate(() => rows.push(row));
  focusRow(row.id);
}
export function focusRow(id) {
  requestAnimationFrame(() => {
    const intent = new CustomEvent("editor:focus-row", {
      detail: { id },
      cancelable: true,
    });
    if (!document.dispatchEvent(intent)) return;
    const element = $(`[data-row="${id}"],[data-branch-row="${id}"]`);
    if (!element) return;
    element.scrollIntoView({ block: "nearest" });
    (
      element.querySelector(
        '[data-row-field="text"],[data-branch-field="text"]',
      ) || element.querySelector("button")
    )?.focus();
  });
}
export function rowInsertionItems(id) {
  const insertion = (position) =>
    ["dialogue", "effect"].map((type) => ({
      label: type === "dialogue" ? "对白" : "描述",
      icon: type === "dialogue" ? "plus" : "note",
      click: () => insertRowAt(id, type, position),
    }));
  return [
    { label: "在上方插入", icon: "up", children: insertion("above") },
    { label: "在下方插入", icon: "down", children: insertion("below") },
  ];
}
export function rowMenu(id, anchor) {
  const loc = rowLocation(id);
  if (!loc) return;
  const { row, rows } = loc,
    index = rows.indexOf(row);
  menu(anchor, [
    ...rowInsertionItems(id),
    null,
    {
      label: "将选中行建立为场景组",
      icon: "layers",
      shortcut: "Ctrl G",
      click: () => groupDialog(),
    },
    {
      label: "复制此行",
      icon: "copy",
      click: () => {
        const copied = regenRowIds(clone(row));
        mutate(() => rows.splice(index + 1, 0, copied));
        focusRow(copied.id);
      },
    },
    {
      label: "上移",
      icon: "up",
      disabled: index === 0,
      click: () =>
        mutate(() => rows.splice(index - 1, 0, rows.splice(index, 1)[0])),
    },
    {
      label: "下移",
      icon: "down",
      disabled: index === rows.length - 1,
      click: () =>
        mutate(() => rows.splice(index + 1, 0, rows.splice(index, 1)[0])),
    },
    { label: "移至其他阶段", icon: "layers", click: () => moveRowDialog(id) },
    null,
    {
      label: "删除此行",
      icon: "trash",
      danger: true,
      click: () => mutate(() => rows.splice(rows.indexOf(row), 1)),
    },
  ]);
}
export function branchRowMenu(id, anchor) {
  rowMenu(id, anchor);
}

export function localOptionMenu(parentId, optId, anchor) {
  const parent = rowLocation(parentId)?.row,
    opts = parent?.options || [],
    idx = opts.findIndex((o) => o.id === optId),
    op = opts[idx];
  if (!op) return;
  menu(anchor, [
    {
      label: "复制选项",
      icon: "copy",
      click: () => {
        const c = clone(op);
        c.id = uid("opt");
        c.rows.forEach(regenRowIds);
        mutate(() => opts.splice(idx + 1, 0, c));
      },
    },
    {
      label: "上移",
      icon: "up",
      disabled: idx === 0,
      click: () =>
        mutate(() => opts.splice(idx - 1, 0, opts.splice(idx, 1)[0])),
    },
    {
      label: "下移",
      icon: "down",
      disabled: idx >= opts.length - 1,
      click: () =>
        mutate(() => opts.splice(idx + 1, 0, opts.splice(idx, 1)[0])),
    },
    {
      label: "添加描述",
      icon: "note",
      click: () => {
        const r = line("effect");
        mutate(() => op.rows.push(r));
        focusRow(r.id);
      },
    },
    {
      label: "添加笔记",
      icon: "note",
      click: () => {
        const r = line("note");
        mutate(() => op.rows.push(r));
        focusRow(r.id);
      },
    },
    null,
    {
      label: "删除选项",
      icon: "trash",
      danger: true,
      disabled: opts.length <= 1,
      click: () => {
        const del = () => mutate(() => opts.splice(idx, 1));
        if (op.rows.some((r) => r.text.trim()))
          confirmBox(
            "删除选项",
            `删除选项“${op.text || "未命名"}”及其中 ${op.rows.length} 行脚本？`,
            del,
            true,
          );
        else del();
      },
    },
  ]);
}

export function moveRowDialog(id) {
  const location = rowLocation(id);
  if (!location) return;
  const from = currentStage(),
    source = currentInvestigationItem();
  const choices = state.project.chapters.flatMap((c) =>
    c.stages.flatMap((st) =>
      st.kind === "investigation"
        ? (st.objects || [])
            .filter((o) => !(st.id === from.id && o.id === source?.id))
            .map((o) => ({
              id: o.id,
              label: `${R(c.routeId)?.name} / ${c.title} / ${st.title} / ${o.name}`,
              rows: o.rows,
            }))
        : st.id === from.id
          ? []
          : [
              {
                id: st.id,
                label: `${R(c.routeId)?.name} / ${c.title} / ${st.title}`,
                rows: st.rows,
              },
            ],
    ),
  );
  if (!choices.length) return toast("没有其他目标");
  modal(
    "移动脚本行",
    `<div class="field"><label>目标阶段 / 物品</label><select class="input" id="move-row-target">${choices.map((x) => option(x.id, x.label, null)).join("")}</select></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="move-row-go">移动</button>',
  );
  $("#move-row-go").onclick = () => {
    const dest = choices.find((x) => x.id === $("#move-row-target").value);
    if (!dest) return;
    mutate(() => {
      const idx = location.rows.indexOf(location.row);
      dest.rows.push(location.rows.splice(idx, 1)[0]);
    });
    closeModal();
  };
}

export function scriptMenu(anchor) {
  menu(anchor, [
    ...(currentStage().kind === "investigation"
      ? [
          {
            label: "新建调查物品",
            icon: "plus",
            click: () => inspectObjectDialog(),
          },
        ]
      : []),
    {
      label: "选中行建立场景组",
      icon: "layers",
      shortcut: "Ctrl G",
      click: () => groupDialog(),
    },
    { label: "添加选项组", icon: "branch", click: () => addRow("branch") },
    { label: "添加画面描述", icon: "note", click: () => addRow("effect") },
    { label: "添加笔记行", icon: "note", click: () => addRow("note") },
    { label: "批量录入对白", icon: "file", click: bulkDialog },
    {
      label: "复制所选行",
      icon: "copy",
      shortcut: "Ctrl C",
      disabled: !selectedRows().length,
      click: copyRowsButton,
    },
    {
      label: "粘贴对白行",
      icon: "layers",
      shortcut: "Ctrl V",
      disabled: !state.rowClipboard,
      click: pasteRowsButton,
    },
    null,
    {
      label: "阶段设置",
      icon: "settings",
      click: () => stageDialog(currentStage().id),
    },
    { label: "阅读本阶段", icon: "eye", click: readStage },
    {
      label: "返回阶段卡片",
      icon: "layers",
      click: () => go("chapter", state.view.chapterId),
    },
  ]);
}

export function bulkDialog() {
  modal(
    "批量录入",
    `<div class="field"><textarea class="input" id="bulk-text" rows="12" placeholder="角色名：对白\n角色名：下一句对白\n没有角色名的行会作为旁白。" autofocus></textarea></div><label class="tiny" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="bulk-create" checked>为新姓名创建角色</label>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="bulk-import">插入</button>',
    true,
  );
  $("#bulk-import").onclick = () => {
    const list = $("#bulk-text")
        .value.split(/\r?\n/)
        .filter((x) => x.trim()),
      create = $("#bulk-create").checked,
      rows = currentRows();
    if (!rows) return toast("请先添加调查物品");
    if (!list.length) return toast("请粘贴对白");
    mutate(() => {
      for (const str of list) {
        const m = str.match(/^\s*([^:：\n]{1,40})[:：]\s*(.*)$/),
          r = line();
        if (m) {
          const name = m[1].trim();
          let p = state.project.characters.find((x) => x.name === name);
          if (!p && create && !["旁白", "叙述"].includes(name)) {
            p = {
              id: uid("char"),
              name,
              color: PALETTE[state.project.characters.length % PALETTE.length],
              expressions: ["平静", "微笑", "疑惑"],
              actions: [],
              notes: "",
            };
            state.project.characters.push(p);
          }
          if (p || ["旁白", "叙述"].includes(name)) {
            r.speakerId = p?.id || "";
            r.text = m[2];
          } else r.text = str;
        } else r.text = str;
        rows.push(r);
      }
    });
    closeModal();
    toast("已插入 " + list.length + " 行");
  };
}
