import {
  INVESTIGATION_CARD,
  isInvestigationPerson,
  investigationScripts,
} from "../domain/investigation.js";
import { flattenRows } from "../domain/project.js";
import { isAndroid } from "../platform/runtime";
import {
  $,
  $$,
  attr,
  esc,
  ib,
  ico,
  inspectLocation,
  inspectName,
  state,
} from "./context.js";
import { mutate } from "./session.js";
import { syncRowSelection } from "./row-operations.js";

const { width, height, gap } = INVESTIGATION_CARD;

export function investigationToolbar(stage, navigation = "") {
  return `<div class="investigation-toolbar" role="group" aria-label="调查工具">
    ${navigation}
    <div class="investigation-tools investigation-actions">
      <button class="btn primary" data-act="inspect-create" title="新建卡片" aria-label="新建卡片">${ico("plus")}<span>新建卡片</span></button>
      <button class="btn ghost" data-act="inspect-pool" title="调查卡池" aria-label="调查卡池">${ico("layers")}<span>卡池</span></button>
      <button class="btn ghost" data-act="inspect-rehearse" title="演练" aria-label="演练">${ico("play")}<span>演练</span></button>
      ${stage.objects.some((item) => state.expandedInvestigationItems.has(item.id)) ? ib("up", "inspect-collapse-all", "收起全部脚本") : ""}
      ${isAndroid ? ib("dots", "inspect-stage-menu", "调查阶段操作") : ""}
    </div>
    <div class="investigation-tools investigation-zoom">
      <button type="button" aria-label="缩小画布" title="缩小画布" data-investigation-zoom="out">${ico("minus")}</button>
      <button type="button" aria-label="重置缩放" title="重置缩放" data-investigation-zoom="reset">100%</button>
      <button type="button" aria-label="放大画布" title="放大画布" data-investigation-zoom="in">${ico("plus")}</button>
      <button type="button" aria-label="适应全部卡片" title="适应全部卡片" data-investigation-zoom="fit">${ico("fit")}</button>
    </div>
  </div>`;
}

export function investigationCanvas(stage, active, renderScript, toolbar) {
  const cards = stage.objects
    .map((item) => {
      const person = isInvestigationPerson(item);
      const type = item.temporaryCharacter ? "临时 NPC" : person ? "人物" : "物品";
      const name = inspectName(item);
      const location = inspectLocation(item);
      const count = investigationScripts(item)
        .flatMap((script) => flattenRows(script.rows))
        .filter((row) => row.type !== "group").length;
      const expanded = state.expandedInvestigationItems.has(item.id);
      return `<article class="investigation-card ${person ? "is-character" : ""} ${item.id === active?.id ? "is-selected" : ""} ${state.selectedInvestigationCardIds.has(item.id) ? "is-card-picked" : ""}" data-investigation-card="${attr(item.id)}" style="left:${item.position.x}px;top:${item.position.y}px">
      <div class="investigation-card-head">
        <button class="inspect-open" data-act="inspect-select" data-id="${attr(item.id)}" title="${expanded ? "定位脚本" : "展开脚本"}">
          <span class="investigation-card-icon">${ico(person ? "users" : "box")}</span>
          <span class="investigation-card-name"><small>${type}</small><strong>${esc(name)}</strong><span class="investigation-card-meta">${location ? ico("pin") + "<span>" + esc(location) + "</span>" : count + " 行脚本"}</span></span>
        </button>
        ${ib(expanded ? "up" : "down", "inspect-fold", expanded ? "收起脚本" : "展开脚本", `data-id="${attr(item.id)}" aria-expanded="${expanded}"`)}
        ${ib("dots", "inspect-menu", type + "操作", `data-id="${attr(item.id)}"`)}
      </div>
      ${expanded ? renderScript(stage, item) : ""}
    </article>`;
    })
    .join("");
  return `<section class="investigation-canvas" aria-label="调查画布">
    ${toolbar}
    <div class="investigation-viewport" data-investigation-stage="${attr(stage.id)}" aria-label="调查画布背景" tabindex="0">
      <div class="investigation-world" style="--card-width:${width}px;--card-height:${height}px">${cards}</div>
      ${cards ? "" : '<p class="investigation-empty">新建一张物品或人物卡片，开始编排调查。</p>'}
      <div class="investigation-selection-box" hidden aria-hidden="true"></div>
    </div>
    <div class="selection-toolbar" id="selection-toolbar" hidden></div>
  </section>`;
}

function pointInViewport(viewport, x, y) {
  const rect = viewport.getBoundingClientRect();
  return { x: x - rect.left, y: y - rect.top };
}

function canvasPosition(camera, point) {
  return {
    x: Math.round((point.x - camera.x) / camera.scale - width / 2),
    y: Math.round((point.y - camera.y) / camera.scale - height / 2),
  };
}

export function selectInvestigationCards(ids, viewport = $(".investigation-viewport")) {
  state.selectedInvestigationCardIds = new Set(ids);
  if (ids.length && state.selectedRowIds.size) {
    state.selectedRowIds.clear();
    state.selectionAnchor = null;
    syncRowSelection();
  }
  if (viewport)
    $$("[data-investigation-card]", viewport).forEach((card) =>
      card.classList.toggle("is-card-picked", state.selectedInvestigationCardIds.has(card.dataset.investigationCard)),
    );
}

export function suggestInvestigationPosition(stage, origin = null, offsets = [{ x: 0, y: 0 }]) {
  const viewport = $(".investigation-viewport");
  const camera = state.investigationCameras.get(stage.id);
  const start =
    origin ||
    (camera && viewport
      ? canvasPosition(camera, {
          x: viewport.clientWidth / 2,
          y: viewport.clientHeight / 2,
        })
      : { x: 0, y: 0 });
  for (let i = 0; ; i++) {
    const position = {
      x: start.x + (i % 3) * (width + gap),
      y: start.y + Math.floor(i / 3) * (height + gap),
    };
    if (
      !stage.objects.some(({ position: saved }) => offsets.some((offset) =>
        Math.abs(saved.x - position.x - offset.x) < width + gap / 2 &&
        Math.abs(saved.y - position.y - offset.y) < height + gap / 2,
      ))
    )
      return position;
  }
}

export function revealInvestigationPosition(stage, position, positions = [position]) {
  const viewport = $(".investigation-viewport");
  const camera = state.investigationCameras.get(stage.id);
  if (!viewport || !camera || !position) return;
  const right = Math.max(...positions.map(({ x }) => x)) + width;
  const bottom = Math.max(...positions.map(({ y }) => y)) + height;
  const spanX = right - position.x;
  const spanY = bottom - position.y;
  if (positions.length > 1)
    camera.scale = Math.min(camera.scale,
      Math.max(1, viewport.clientWidth - 32) / spanX,
      Math.max(1, viewport.clientHeight - 32) / spanY);
  const x = position.x * camera.scale + camera.x;
  const y = position.y * camera.scale + camera.y;
  if (x < 8 || x + spanX * camera.scale > viewport.clientWidth - 8)
    camera.x = viewport.clientWidth / 2 - (position.x + spanX / 2) * camera.scale;
  if (y < 8 || y + spanY * camera.scale > viewport.clientHeight - 8)
    camera.y = viewport.clientHeight / 2 - (position.y + spanY / 2) * camera.scale;
}

export function revealInvestigationElement(element) {
  const viewport = element?.closest(".investigation-viewport");
  const camera = state.investigationCameras.get(
    viewport?.dataset.investigationStage,
  );
  if (!camera || !viewport.clientHeight) return false;
  const rect = element.getBoundingClientRect();
  const panel =
    element.matches("[data-investigation-card]") &&
    $(".investigation-writing", element);
  const panelRect = panel && panel.getBoundingClientRect();
  const right = Math.max(rect.right, panelRect?.right || rect.right);
  const bottom = Math.max(rect.bottom, panelRect?.bottom || rect.bottom);
  const frame = viewport.getBoundingClientRect();
  const pad = 14;
  if (rect.left < frame.left + pad || right - rect.left > frame.width - pad * 2)
    camera.x += frame.left + pad - rect.left;
  else if (right > frame.right - pad) camera.x += frame.right - pad - right;
  if (rect.top < frame.top + pad || bottom - rect.top > frame.height - pad * 2)
    camera.y += frame.top + pad - rect.top;
  else if (bottom > frame.bottom - pad) camera.y += frame.bottom - pad - bottom;
  viewport.dispatchEvent(new Event("investigation:camera"));
  return true;
}

export function setupInvestigationCanvas(root, stage, openAddMenu, openContextMenu) {
  const viewport = $(".investigation-viewport", root);
  const world = $(".investigation-world", viewport);
  const selectionBox = $(".investigation-selection-box", viewport);
  const zoomLabel = $('[data-investigation-zoom="reset"]', root);
  const items = new Map(stage.objects.map((item) => [item.id, item]));
  const camera = state.investigationCameras.get(stage.id) || {
    x: 0,
    y: 0,
    scale: 1,
  };
  function paint() {
    world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    const pitch = Math.max(12, 24 * camera.scale);
    viewport.style.backgroundSize = `${pitch}px ${pitch}px`;
    viewport.style.backgroundPosition = `${camera.x % pitch}px ${camera.y % pitch}px`;
    const percent = camera.scale * 100;
    zoomLabel.textContent = percent < 1 ? "<1%" : Math.round(percent) + "%";
  }
  viewport.addEventListener("investigation:camera", paint);
  const center = () => ({
    x: viewport.clientWidth / 2,
    y: viewport.clientHeight / 2,
  });
  function fit() {
    const middle = center();
    if (stage.objects.length) {
      let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;
      for (const card of world.children) {
        const { x, y } = items.get(card.dataset.investigationCard).position;
        const editor = $(".investigation-writing", card);
        left = Math.min(left, x);
        right = Math.max(right, x + (editor?.offsetWidth || width));
        top = Math.min(top, y);
        bottom = Math.max(
          bottom,
          y + (editor ? editor.offsetTop + editor.offsetHeight : height),
        );
      }
      camera.scale = Math.min(
        1,
        Math.max(1, viewport.clientWidth - 48) / (right - left),
        Math.max(1, viewport.clientHeight - 60) / (bottom - top),
      );
      camera.x = middle.x - (left + (right - left) / 2) * camera.scale;
      camera.y = middle.y - (top + (bottom - top) / 2) * camera.scale;
    } else {
      Object.assign(camera, { x: middle.x, y: middle.y, scale: 1 });
    }
    paint();
  }
  if (state.investigationCameras.has(stage.id)) paint();
  else {
    state.investigationCameras.set(stage.id, camera);
    fit();
  }

  function zoom(scale, point, base = camera, start = point) {
    scale = Math.min(2.5, Math.max(Math.min(0.15, base.scale), scale));
    const factor = scale / base.scale;
    Object.assign(camera, {
      x: point.x - (start.x - base.x) * factor,
      y: point.y - (start.y - base.y) * factor,
      scale,
    });
    paint();
  }

  function anchorAt(point) {
    const rect = viewport.getBoundingClientRect();
    return {
      getBoundingClientRect: () => ({
        right: rect.left + point.x,
        bottom: rect.top + point.y,
      }),
    };
  }
  function openAt(point) {
    openAddMenu(anchorAt(point), canvasPosition(camera, point));
  }
  root
    .querySelector(".investigation-zoom")
    .addEventListener("click", (event) => {
      const action = event.target.closest("[data-investigation-zoom]")?.dataset
        .investigationZoom;
      if (action === "fit") fit();
      else if (action)
        zoom(
          action === "reset"
            ? 1
            : camera.scale * (action === "in" ? 1.25 : 0.8),
          center(),
        );
    });
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1);
      zoom(
        camera.scale * Math.exp(-delta * 0.0018),
        pointInViewport(viewport, event.clientX, event.clientY),
      );
    },
    { passive: false },
  );
  viewport.addEventListener("keydown", (event) => {
    if (
      event.target !== viewport ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    if (event.key === "Enter" || event.key === " ") openAt(center());
    else if (event.key === "+" || event.key === "=")
      zoom(camera.scale * 1.25, center());
    else if (event.key === "-") zoom(camera.scale * 0.8, center());
    else if (event.key === "0") fit();
    else {
      const movement = {
        ArrowLeft: [56, 0],
        ArrowRight: [-56, 0],
        ArrowUp: [0, 56],
        ArrowDown: [0, -56],
      }[event.key];
      if (!movement) return;
      camera.x += movement[0];
      camera.y += movement[1];
      paint();
    }
    event.preventDefault();
  });
  viewport.addEventListener("focusin", (event) => {
    const card = event.target.closest("[data-investigation-card]");
    if (!card || !event.target.matches(":focus-visible")) return;
    revealInvestigationElement(event.target);
  });

  let selection;
  viewport.addEventListener("contextmenu", (event) => {
    if (!event.target.closest(".investigation-writing")) event.preventDefault();
  });
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 2 || event.target.closest(".investigation-writing")) return;
    const card = event.target.closest("[data-investigation-card]");
    selection = {
      pointerId: event.pointerId,
      start: pointInViewport(viewport, event.clientX, event.clientY),
      cardId: card?.dataset.investigationCard,
      previous: [...state.selectedInvestigationCardIds],
      moved: false,
    };
    event.preventDefault();
    viewport.focus({ preventScroll: true });
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (selection?.pointerId !== event.pointerId) return;
    const point = pointInViewport(viewport, event.clientX, event.clientY);
    const { start } = selection;
    if (!selection.moved && Math.hypot(point.x - start.x, point.y - start.y) < 5) return;
    selection.moved = true;
    const left = Math.max(0, Math.min(start.x, point.x));
    const top = Math.max(0, Math.min(start.y, point.y));
    const right = Math.min(viewport.clientWidth, Math.max(start.x, point.x));
    const bottom = Math.min(viewport.clientHeight, Math.max(start.y, point.y));
    Object.assign(selectionBox.style, {
      left: left + "px", top: top + "px",
      width: right - left + "px", height: bottom - top + "px",
    });
    selectionBox.hidden = false;
    const frame = viewport.getBoundingClientRect();
    const hits = $$("[data-investigation-card]", world).filter((card) => {
      const rect = card.getBoundingClientRect();
      return rect.left < frame.left + right && rect.right > frame.left + left &&
        rect.top < frame.top + bottom && rect.bottom > frame.top + top;
    });
    selectInvestigationCards(hits.map((card) => card.dataset.investigationCard), viewport);
  });
  function endSelection(event) {
    if (selection?.pointerId !== event.pointerId) return;
    const { moved, cardId, previous } = selection;
    selection = null;
    selectionBox.hidden = true;
    if (event.type !== "pointerup") {
      selectInvestigationCards(previous, viewport);
      return;
    }
    if (moved) return;
    const point = pointInViewport(viewport, event.clientX, event.clientY);
    if (cardId && !state.selectedInvestigationCardIds.has(cardId))
      selectInvestigationCards([cardId], viewport);
    openContextMenu(anchorAt(point), canvasPosition(camera, point), cardId);
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    viewport.addEventListener(type, endSelection);

  const pointers = new Map();
  let gesture,
    pinch,
    lastTap,
    pendingTouchMenu,
    lastTouchMenu = -Infinity,
    suppressClick = false;
  const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const setCardPosition = (card, position) => {
    card.style.left = position.x + "px";
    card.style.top = position.y + "px";
  };

  viewport.addEventListener("dblclick", (event) => {
    if (
      !event.target.closest("[data-investigation-card]") &&
      performance.now() - lastTouchMenu > 450
    )
      openAt(pointInViewport(viewport, event.clientX, event.clientY));
  });
  viewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 0 && !pointers.size) {
      const card = event.target.closest(".investigation-card-head")?.closest("[data-investigation-card]");
      if (!event.target.closest('[data-act="inspect-menu"]'))
        selectInvestigationCards(card ? [card.dataset.investigationCard] : [], viewport);
    }
    if (!pointers.size) {
      suppressClick = false;
      pendingTouchMenu = null;
    }
    const button = event.target.closest("button");
    const writing = event.target.closest(".investigation-writing");
    const editing =
      event.button !== 1 &&
      (writing || (button && !button.matches(".inspect-open")));
    if (editing && event.pointerType !== "touch") return;
    const point = pointInViewport(viewport, event.clientX, event.clientY);
    pointers.set(event.pointerId, point);
    if (!editing) (button || viewport).setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      const hit = event.target.closest("[data-investigation-card]");
      const card = event.button === 0 && !editing ? hit : null;
      const item = card && items.get(card.dataset.investigationCard);
      gesture = {
        point,
        origin: item?.position || { x: camera.x, y: camera.y },
        card,
        item,
        blank: !hit,
        moved: false,
        editing,
      };
    } else if (pointers.size === 2) {
      if (gesture.card) {
        setCardPosition(gesture.card, gesture.origin);
        gesture.card.classList.remove("is-dragging");
      }
      const [a, b] = pointers.values();
      pinch = {
        camera: { ...camera },
        point: midpoint(a, b),
        distance: Math.max(1, distance(a, b)),
      };
      lastTap = null;
      suppressClick = true;
    }
    if (event.button === 1) event.preventDefault();
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    const point = pointInViewport(viewport, event.clientX, event.clientY);
    pointers.set(event.pointerId, point);
    if (pinch) {
      const [a, b] = pointers.values();
      zoom(
        (pinch.camera.scale * distance(a, b)) / pinch.distance,
        midpoint(a, b),
        pinch.camera,
        pinch.point,
      );
      return;
    }
    if (gesture.editing) return;
    const dx = point.x - gesture.point.x,
      dy = point.y - gesture.point.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
    gesture.moved = true;
    suppressClick = true;
    lastTap = null;
    if (gesture.item) {
      gesture.card.classList.add("is-dragging");
      gesture.position = {
        x: Math.round(gesture.origin.x + dx / camera.scale),
        y: Math.round(gesture.origin.y + dy / camera.scale),
      };
      setCardPosition(gesture.card, gesture.position);
    } else {
      viewport.classList.add("is-panning");
      camera.x = gesture.origin.x + dx;
      camera.y = gesture.origin.y + dy;
      paint();
    }
  });
  function finish(event) {
    if (!pointers.delete(event.pointerId)) return;
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        gesture = {
          point: pointers.values().next().value,
          origin: { x: camera.x, y: camera.y },
          moved: true,
        };
      }
      return;
    }
    viewport.classList.remove("is-panning");
    if (gesture.card) {
      gesture.card.classList.remove("is-dragging");
      const position = gesture.position;
      if (
        event.type === "pointerup" &&
        position &&
        (position.x !== gesture.origin.x || position.y !== gesture.origin.y)
      ) {
        mutate(() => (gesture.item.position = position), false);
      } else setCardPosition(gesture.card, gesture.origin);
    }
    if (
      gesture.blank &&
      !gesture.moved &&
      event.type === "pointerup" &&
      event.pointerType === "touch"
    ) {
      const now = performance.now();
      if (
        lastTap &&
        now - lastTap.time < 350 &&
        distance(lastTap.point, gesture.point) < 24
      ) {
        lastTap = null;
        // Wait for the synthesized click before inserting the menu backdrop.
        pendingTouchMenu = gesture.point;
      } else lastTap = { time: now, point: gesture.point };
    }
  }
  viewport.addEventListener("pointerup", finish);
  viewport.addEventListener("pointercancel", finish);
  viewport.addEventListener("lostpointercapture", finish);
  viewport.addEventListener(
    "click",
    (event) => {
      if (pendingTouchMenu && event.detail) {
        const point = pendingTouchMenu;
        pendingTouchMenu = null;
        lastTouchMenu = performance.now();
        event.stopPropagation();
        event.preventDefault();
        openAt(point);
        return;
      }
      if (suppressClick && event.detail) {
        event.stopPropagation();
        event.preventDefault();
      }
    },
    true,
  );
}
