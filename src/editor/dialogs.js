import { wrapDialogue, normalizeDialogueSettings } from "../domain/dialogue.js";
import { projectSettingsDialog } from "./dialogue-settings.js";
import { findRow } from "../domain/scenes.js";
import { investigationItems, investigationScripts } from "../domain/investigation.js";
import { revealInvestigationElement, revealInvestigationPosition } from "./investigation-canvas.js";
import { describeInvestigationRule, describeInvestigationOutcomes } from "./investigation-editor.js";
import { touchActions } from "./mobile-presentation.js";
import { showTouchMenu } from "./touch-menu.js";
import { locationDialog } from "./scenes.js";
import { effectiveLocation, LOCATION_FIELDS } from "../domain/scenes.js";
import {
  normalizeProject,
  newProject,
  chapter,
  regenRowIds,
  stageRootRows,
  newCharacter,
  regenerateInvestigationIds,
  flattenRows,
  stage,
  branchRowCount,
} from "../domain/project.js";
import { clone, PALETTE, uid } from "../domain/primitives.js";
import { DEMO } from "../domain/demo.js";
import { showUpdates } from "../ui/update-dialog";
import { isNative, isAndroid } from "../platform/runtime";
import { version as VERSION } from "../../package.json";
import {
  $,
  $$,
  BACKUPS,
  BRIDGE,
  C,
  F,
  P,
  R,
  S,
  attr,
  btn,
  currentChapter,
  currentStage,
  esc,
  ib,
  ico,
  inspectLocation,
  inspectName,
  linesOf,
  option,
  routeChapters,
  state,
} from "./context.js";
import {
  backup,
  edit,
  go,
  mutate,
  reconcileSimulation,
  redo,
  render,
  selectInvestigationItem,
  toast,
  undo,
  validateView,
} from "./session.js";
import {
  adopt,
  bridgeCall,
  downloadSource,
  exportMarkdown,
  importLegacyProjects,
  importSourceAction,
  newHubDialog,
  saveSource,
  revealSource,
  showProjectLibrary,
} from "./project-files.js";
import { freeY } from "./route-graph.js";

export function closeMenu() {
  const root = $("#menu-root");
  root.innerHTML = "";
  root.touchMenuBack = null;
  const cleanup = root.touchMenuCleanup;
  root.touchMenuCleanup = null;
  cleanup?.();
}

export function menu(anchor, items) {
  closeMenu();
  if (touchActions()) return showTouchMenu(anchor, items, closeMenu);
  const root = $("#menu-root");
  const removeAfter = (depth) => {
    for (const popup of root.querySelectorAll(".menu"))
      if (Number(popup.dataset.depth) > depth) popup.remove();
  };
  function show(entries, rectangle, depth = 0, parentButton = null) {
    removeAfter(depth - 1);
    const popup = document.createElement("div");
    popup.className = "menu";
    popup.dataset.depth = depth;
    popup.setAttribute("role", "menu");
    for (const item of entries) {
      if (!item) {
        const separator = document.createElement("div");
        separator.className = "menu-sep";
        popup.append(separator);
        continue;
      }
      const button = document.createElement("button");
      button.className = "menu-item" + (item.danger ? " danger" : "");
      button.disabled = !!item.disabled;
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", item.label);
      if (item.shortcut)
        button.setAttribute(
          "aria-keyshortcuts",
          item.shortcut.replaceAll("Ctrl", "Control").replaceAll(" ", "+"),
        );
      button.innerHTML =
        (item.icon ? ico(item.icon) : "") +
        `<span>${esc(item.label)}</span>` +
        (item.children
          ? ico("next")
          : item.shortcut
            ? `<span class="shortcut">${esc(item.shortcut)}</span>`
            : "");
      const expand = () => {
        if (button.disabled) return;
        removeAfter(depth);
        if (item.children)
          show(
            item.children,
            button.getBoundingClientRect(),
            depth + 1,
            button,
          );
      };
      button.onmouseenter = expand;
      button.onclick = (event) => {
        event.stopPropagation();
        if (item.children) {
          expand();
          root
            .querySelector(`[data-depth="${depth + 1}"] button:not(:disabled)`)
            ?.focus();
        } else {
          closeMenu();
          item.click?.();
        }
      };
      if (item.children) button.setAttribute("aria-haspopup", "menu");
      popup.append(button);
    }
    root.append(popup);
    const bounds = popup.getBoundingClientRect();
    let left = depth ? rectangle.right + 3 : rectangle.right - bounds.width;
    if (left + bounds.width > innerWidth - 8)
      left = depth
        ? rectangle.left - bounds.width - 3
        : innerWidth - bounds.width - 8;
    popup.style.left = Math.max(8, left) + "px";
    popup.style.top =
      Math.max(
        8,
        Math.min(
          innerHeight - bounds.height - 8,
          depth ? rectangle.top : rectangle.bottom + 7,
        ),
      ) + "px";
    popup.onkeydown = (event) => {
      const buttons = [...popup.querySelectorAll("button:not(:disabled)")],
        index = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        buttons[
          (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      } else if (
        event.key === "ArrowRight" &&
        document.activeElement?.getAttribute("aria-haspopup")
      ) {
        event.preventDefault();
        document.activeElement.click();
      } else if (event.key === "ArrowLeft" && parentButton) {
        event.preventDefault();
        removeAfter(depth - 1);
        parentButton.focus();
      }
    };
    return popup;
  }
  const popup = show(
    items,
    anchor?.getBoundingClientRect?.() || { right: innerWidth - 24, bottom: 64 },
  );
  popup.querySelector("button:not(:disabled)")?.focus();
}

export function modal(title, body, foot = "", wide = false, onClose = null) {
  closeMenu();
  if (!$("#modal-root").firstChild)
    state.previousFocus = document.activeElement;
  state.modalClose = onClose;
  $("#modal-root").innerHTML =
    `<div class="overlay"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${attr(title)}"><div class="modal-head"><h2>${esc(title)}</h2>${ib("close", "modal-close", "关闭")}</div><div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ""}</section></div>`;
  $(".overlay").addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("overlay")) closeModal();
  });
  requestAnimationFrame(() => {
    (
      $("[autofocus]", $("#modal-root")) ||
      $(".modal-head button", $("#modal-root"))
    )?.focus();
  });
}

export function closeModal() {
  if (state.syncBusy) return;
  const fn = state.modalClose;
  state.modalClose = null;
  $("#modal-root").innerHTML = "";
  if (state.previousFocus?.isConnected)
    state.previousFocus.focus({ preventScroll: true });
  state.previousFocus = null;
  if (fn) fn();
}

export function confirmBox(title, message, fn, danger = false) {
  modal(
    title,
    `<div class="help"><p>${esc(message)}</p></div>`,
    btn("取消", null, "modal-close") +
      `<button class="btn ${danger ? "danger" : "primary"}" id="confirm-yes">${danger ? "删除" : "继续"}</button>`,
  );
  $("#confirm-yes").onclick = () => {
    closeModal();
    fn();
  };
}

export function guardReplace(fn) {
  if (state.dirty) {
    modal(
      "替换当前剧本",
      `<div class="help"><p>当前改动尚未保存到源文件。继续后，可从“最近备份”找回本地副本。</p></div>`,
      btn("取消", null, "modal-close") +
        '<button class="btn" id="replace-discard">继续</button><button class="btn primary" id="replace-save">保存并继续</button>',
    );
    $("#replace-discard").onclick = () => {
      closeModal();
      backup();
      fn();
    };
    $("#replace-save").onclick = async () => {
      const ok = await saveSource();
      if (ok) {
        closeModal();
        backup();
        fn();
      }
    };
  } else {
    backup();
    fn();
  }
}

export function topMenu(anchor) {
  menu(anchor, [
    { label: "项目列表", icon: "folder", click: showProjectLibrary },
    ...(isNative
      ? [
          ...(!isAndroid
            ? [
                {
                  label: "打开源文件所在文件夹",
                  icon: "folder",
                  click: revealSource,
                },
              ]
            : []),
        ]
      : []),
    { label: "项目设置", icon: "settings", click: projectSettingsDialog },
    { label: "地点预设", icon: "map", click: () => go("locations") },
    {
      label: "新建剧本",
      icon: "file",
      click: () => (BRIDGE ? newHubDialog() : newDialog()),
    },
    {
      label: "另存源文件",
      icon: "save",
      shortcut: "Ctrl Shift S",
      click: () => saveSource(true),
    },
    { label: "下载源文件副本", icon: "download", click: downloadSource },
    { label: "导入源文件", icon: "folder", click: importSourceAction },
    { label: "导出可读剧本", icon: "note", click: exportMarkdown },
    null,
    {
      label: "撤销",
      icon: "undo",
      shortcut: "Ctrl Z",
      disabled: !state.history.length,
      click: undo,
    },
    {
      label: "重做",
      icon: "redo",
      shortcut: "Ctrl Shift Z",
      disabled: !state.future.length,
      click: redo,
    },
    { label: "检查剧情关系", icon: "audit", click: auditDialog },
    { label: "最近备份", icon: "reset", click: backupDialog },
    null,
    {
      label: "载入示例",
      icon: "map",
      click: () =>
        guardReplace(() =>
          adopt(normalizeProject(clone(DEMO)), "", null, true),
        ),
    },
    { label: "使用说明", icon: "help", click: helpDialog },
    { label: "检测 GitHub 更新", icon: "download", click: showUpdates },
    ...(isNative
      ? [
          {
            label: "导入旧版项目文件夹",
            icon: "folder",
            click: importLegacyProjects,
          },
        ]
      : []),
    { label: "关于 / 开源许可", icon: "file", click: aboutDialog },
    ...(BRIDGE
      ? [
          null,
          {
            label: "退出叙线",
            icon: "close",
            click: async () => {
              if (await requestDesktopClose()) await bridgeCall("shutdown");
            },
          },
        ]
      : []),
  ]);
}

export async function requestDesktopClose() {
  if (state.syncBusy) {
    toast("同步进行中，请完成后再关闭");
    return false;
  }
  if (!state.dirty) return true;
  return new Promise((resolve) => {
    let answered = false;
    modal(
      "保存当前剧本？",
      '<div class="help"><p>当前改动尚未写回文件。</p></div>',
      btn("取消", null, "modal-close") +
        '<button class="btn" id="exit-discard">放弃并退出</button><button class="btn primary" id="exit-save">保存并退出</button>',
      false,
      () => {
        if (!answered) resolve(false);
      },
    );
    $("#exit-discard").onclick = () => {
      answered = true;
      state.suppressUnload = true;
      closeModal();
      resolve(true);
    };
    $("#exit-save").onclick = async () => {
      answered = true;
      const ok = await saveSource();
      if (ok) {
        state.suppressUnload = true;
        closeModal();
      }
      resolve(ok);
    };
  });
}

export function boardMenu(anchor) {
  menu(anchor, [
    { label: "新增路线", icon: "plus", click: () => routeDialog() },
    { label: "管理条件", icon: "flag", click: () => flagsDialog(false) },
    { label: "整理画布", icon: "layers", click: arrangeBoard },
    { label: "检查剧情关系", icon: "audit", click: auditDialog },
  ]);
}

export function routeMenu(id, anchor) {
  const idx = state.project.routes.findIndex((r) => r.id === id);
  menu(anchor, [
    { label: "编辑路线", icon: "edit", click: () => routeDialog(id) },
    {
      label: "向左移动",
      icon: "back",
      disabled: idx <= 0,
      click: () =>
        mutate(() =>
          state.project.routes.splice(
            idx - 1,
            0,
            state.project.routes.splice(idx, 1)[0],
          ),
        ),
    },
    {
      label: "向右移动",
      icon: "next",
      disabled: idx >= state.project.routes.length - 1,
      click: () =>
        mutate(() =>
          state.project.routes.splice(
            idx + 1,
            0,
            state.project.routes.splice(idx, 1)[0],
          ),
        ),
    },
    null,
    {
      label: "删除路线",
      icon: "trash",
      danger: true,
      click: () => {
        if (state.project.chapters.some((c) => c.routeId === id))
          return toast("先将此路线的章节移到其他路线，或删除章节");
        if (state.project.routes.length <= 1) return toast("至少保留一条路线");
        confirmBox(
          "删除路线",
          R(id).name,
          () =>
            mutate(
              () =>
                (state.project.routes = state.project.routes.filter(
                  (r) => r.id !== id,
                )),
            ),
          true,
        );
      },
    },
  ]);
}

export function routeDialog(id = null) {
  const r = id
    ? R(id)
    : {
        name: "路线 " + String.fromCharCode(65 + state.project.routes.length),
        color: PALETTE[state.project.routes.length % PALETTE.length],
      };
  let color = r.color;
  modal(
    id ? "编辑路线" : "新路线",
    `<div class="field"><label>名称</label><input class="input" id="route-name" value="${attr(r.name)}" maxlength="200" autofocus></div><div class="field"><label>颜色</label>${colorHTML(color)}</div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="route-save">保存</button>',
  );
  bindColors((c) => (color = c));
  $("#route-save").onclick = () => {
    const name = $("#route-name").value.trim();
    if (!name) return toast("请输入路线名称");
    mutate(() => {
      if (id) {
        r.name = name;
        r.color = color;
      } else state.project.routes.push({ id: uid("route"), name, color });
    });
    closeModal();
  };
}

export function colorHTML(c) {
  return `<div class="color-picker">${PALETTE.map((x) => `<button class="color-dot ${c === x ? "selected" : ""}" style="background:${x}" data-color="${x}" title="${x}" aria-label="颜色 ${x}"></button>`).join("")}</div>`;
}

export function bindColors(fn) {
  $$("[data-color]", $("#modal-root")).forEach(
    (b) =>
      (b.onclick = () => {
        $$("[data-color]", $("#modal-root")).forEach((x) =>
          x.classList.toggle("selected", x === b),
        );
        fn(b.dataset.color);
      }),
  );
}

export function arrangeBoard() {
  mutate(() =>
    state.project.routes.forEach((r) =>
      routeChapters(r.id).forEach((c, i) => (c.y = 112 + i * 218)),
    ),
  );
  toast("已按当前顺序整理");
}

export function newDialog() {
  modal(
    "新剧本",
    `<div class="field"><label>名称</label><input class="input" id="new-title" value="未命名剧本" maxlength="200" autofocus></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="new-create">创建</button>',
  );
  $("#new-create").onclick = () => {
    const name = $("#new-title").value.trim() || "未命名剧本";
    closeModal();
    guardReplace(() => adopt(newProject(name), "", null, true));
  };
}

export function chapterMenu(id, anchor) {
  const c = C(id);
  menu(anchor, [
    { label: "打开阶段", icon: "layers", click: () => go("chapter", id) },
    { label: "章节设置", icon: "settings", click: () => chapterDialog(id) },
    { label: "解锁条件", icon: "link", click: () => rulesDialog(id) },
    {
      label: "章节笔记",
      icon: "note",
      click: () => notesDialog("chapter", id),
    },
    {
      label: "接续新章节",
      icon: "plus",
      click: () => addChapterDialog(c.routeId, id),
    },
    { label: "复制章节", icon: "copy", click: () => duplicateChapter(id) },
    null,
    {
      label: "删除章节",
      icon: "trash",
      danger: true,
      click: () => deleteChapter(id),
    },
  ]);
}

export function chapterDialog(id) {
  const c = C(id);
  modal(
    "章节设置",
    `<div class="field"><label>标题</label><input class="input" id="ch-title" value="${attr(c.title)}" maxlength="300" autofocus></div><div class="field-row"><div class="field"><label>路线</label><select class="input" id="ch-route">${state.project.routes.map((r) => option(r.id, r.name, c.routeId)).join("")}</select></div><div class="field"><label>章节收束</label><select class="input" id="ch-ending">${option("continue", "继续", c.ending)}${option("pause", "未完待续", c.ending)}${option("end", "路线结局", c.ending)}</select></div></div><div class="field"><label>章节笔记</label><textarea class="input" id="ch-summary" rows="4">${esc(c.summary)}</textarea></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="ch-save">保存</button>',
  );
  $("#ch-save").onclick = () => {
    const title = $("#ch-title").value.trim();
    if (!title) return toast("请输入章节标题");
    const rid = $("#ch-route").value,
      end = $("#ch-ending").value,
      note = $("#ch-summary").value;
    mutate(() => {
      if (rid !== c.routeId) c.y = freeY(rid, c.y, c.id);
      c.title = title;
      c.routeId = rid;
      c.ending = end;
      c.summary = note;
    });
    closeModal();
  };
}

export function addChapterDialog(routeId = null, prevId = null) {
  routeId = routeId || state.project.routes[0].id;
  prevId = prevId || routeChapters(routeId).at(-1)?.id || "";
  modal(
    "新章节",
    `<div class="field"><label>标题</label><input class="input" id="new-ch-title" value="新章节" maxlength="300" autofocus></div><div class="field-row"><div class="field"><label>路线</label><select class="input" id="new-ch-route">${state.project.routes.map((r) => option(r.id, r.name, routeId)).join("")}</select></div><div class="field"><label>接续章节</label><select class="input" id="new-ch-prev"></select></div></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="new-ch-save">创建</button>',
  );
  const fill = (rid, prev) => {
    $("#new-ch-prev").innerHTML =
      option("", "无前置条件", prev) +
      routeChapters(rid)
        .map((c) => option(c.id, c.title, prev))
        .join("");
  };
  fill(routeId, prevId);
  $("#new-ch-route").onchange = (e) =>
    fill(e.target.value, routeChapters(e.target.value).at(-1)?.id || "");
  $("#new-ch-save").onclick = () => {
    const name = $("#new-ch-title").value.trim();
    if (!name) return toast("请输入章节标题");
    const rid = $("#new-ch-route").value,
      prev = $("#new-ch-prev").value;
    const c = chapter(rid, name, freeY(rid, prev ? C(prev).y + 218 : 112));
    if (prev)
      c.unlock.rules.push({
        id: uid("rule"),
        type: "chapter",
        targetId: prev,
        expected: true,
      });
    mutate(() => state.project.chapters.push(c));
    closeModal();
    go("chapter", c.id);
  };
}

export function duplicateChapter(id) {
  const old = C(id),
    c = clone(old),
    stageMap = new Map();
  c.id = uid("chapter");
  c.title += " · 副本";
  c.y = freeY(c.routeId, c.y + 180);
  c.stages.forEach((s) => {
    const oldId = s.id;
    s.id = uid("stage");
    stageMap.set(oldId, s.id);
    s.rows.forEach(regenRowIds);
    regenerateInvestigationIds(s.objects);
  });
  c.unlock.rules.forEach((r) => (r.id = uid("rule")));
  c.stages.forEach((s) =>
    flattenRows(stageRootRows(s)).forEach((row) =>
      (row.options || []).forEach((op) => {
        if (op.chapterId === id) {
          op.chapterId = c.id;
          op.stageId = stageMap.get(op.stageId) || "";
        }
      }),
    ),
  );
  mutate(() => state.project.chapters.push(c));
  toast("已复制章节");
}

export function referencesTo(chapterId, stageIds = []) {
  let rules = 0,
    choices = 0;
  for (const c of state.project.chapters) {
    rules += c.unlock.rules.filter(
      (r) =>
        (r.type === "chapter" && r.targetId === chapterId) ||
        (r.type === "stage" && stageIds.includes(r.targetId)),
    ).length;
    for (const s of c.stages)
      for (const r of flattenRows(stageRootRows(s)))
        for (const op of r.options || [])
          if (
            (chapterId && op.chapterId === chapterId) ||
            stageIds.includes(op.stageId)
          )
            choices++;
  }
  return { rules, choices };
}

export function removeReferences(chapterId, stageIds = []) {
  for (const c of state.project.chapters) {
    c.unlock.rules = c.unlock.rules.filter(
      (r) =>
        !(
          (r.type === "chapter" && r.targetId === chapterId) ||
          (r.type === "stage" && stageIds.includes(r.targetId))
        ),
    );
    for (const s of c.stages)
      for (const row of flattenRows(stageRootRows(s)))
        for (const op of row.options || []) {
          if (chapterId && op.chapterId === chapterId) {
            op.chapterId = "";
            op.stageId = "";
          } else if (stageIds.includes(op.stageId)) op.stageId = "";
        }
  }
}

export function deleteChapter(id) {
  const c = C(id),
    ids = c.stages.map((s) => s.id),
    refs = referencesTo(id, ids);
  confirmBox(
    "删除章节",
    `删除“${c.title}”及其 ${c.stages.length} 个阶段、${linesOf(c)} 行脚本，同时移除 ${refs.rules} 条相关解锁依赖、清空 ${refs.choices} 个相关分支指向。受影响章节的解锁条件会变化。`,
    () => {
      mutate(() => {
        state.project.chapters = state.project.chapters.filter(
          (x) => x.id !== id,
        );
        removeReferences(id, ids);
      });
      validateView();
      render();
    },
    true,
  );
}

export function stageMenu(id, anchor) {
  const c = currentChapter(),
    idx = c.stages.findIndex((s) => s.id === id);
  menu(anchor, [
    { label: "编辑阶段", icon: "edit", click: () => stageDialog(id) },
    {
      label: "上移",
      icon: "up",
      disabled: idx <= 0,
      click: () =>
        mutate(() => c.stages.splice(idx - 1, 0, c.stages.splice(idx, 1)[0])),
    },
    {
      label: "下移",
      icon: "down",
      disabled: idx >= c.stages.length - 1,
      click: () =>
        mutate(() => c.stages.splice(idx + 1, 0, c.stages.splice(idx, 1)[0])),
    },
    { label: "复制阶段", icon: "copy", click: () => duplicateStage(id) },
    null,
    {
      label: "删除阶段",
      icon: "trash",
      danger: true,
      click: () => deleteStage(id),
    },
  ]);
}

export function stageDialog(id = null) {
  const c = currentChapter(),
    s = id
      ? c.stages.find((s) => s.id === id)
      : stage("阶段 " + String(c.stages.length + 1).padStart(2, "0"));
  modal(
    id ? "编辑阶段" : "新阶段",
    `<div class="field"><label>名称</label><input class="input" id="st-title" value="${attr(s.title)}" maxlength="300" autofocus></div><div class="field"><label>阶段类型</label><select class="input" id="st-kind">${option("story", "剧情阶段", s.kind || "story")}${option("investigation", "调查阶段", s.kind || "story")}</select></div><div class="field"><label>阶段笔记</label><textarea class="input" id="st-notes" rows="4">${esc(s.notes)}</textarea></div>`,
    btn("取消", null, "modal-close") +
      `<button class="btn primary" id="st-save">${id ? "保存" : "创建"}</button>`,
  );
  $("#st-save").onclick = () => {
    const title = $("#st-title").value.trim();
    if (!title) return toast("请输入阶段名称");
    const notes = $("#st-notes").value,
      kind = $("#st-kind").value;
    if (id && kind !== s.kind && (s.kind === "investigation" ? s.objects.length : s.rows.length))
      return toast("只能更改空白阶段的类型。请先移除该阶段的卡片和脚本。", true);
    mutate(() => {
      s.title = title;
      s.notes = notes;
      s.kind = kind;
      if (!id) c.stages.push(s);
    });
    closeModal();
    if (!id) go("stage", c.id, s.id);
  };
}

export function duplicateStage(id) {
  const c = currentChapter(),
    idx = c.stages.findIndex((s) => s.id === id),
    s = clone(c.stages[idx]);
  s.id = uid("stage");
  s.title += " · 副本";
  s.rows.forEach(regenRowIds);
  regenerateInvestigationIds(s.objects);
  mutate(() => c.stages.splice(idx + 1, 0, s));
}

export function deleteStage(id) {
  const c = currentChapter(),
    s = c.stages.find((s) => s.id === id),
    refs = referencesTo("", [id]);
  confirmBox(
    "删除阶段",
    `删除“${s.title}”及其 ${branchRowCount(s)} 行脚本，同时移除 ${refs.rules} 条阶段解锁依赖、重置 ${refs.choices} 个分支的目标阶段。`,
    () =>
      mutate(() => {
        c.stages = c.stages.filter((x) => x.id !== id);
        removeReferences("", [id]);
      }),
    true,
  );
}

export function notesDialog(type, id) {
  const obj = type === "chapter" ? C(id) : S(id)?.stage,
    key = type === "chapter" ? "summary" : "notes";
  if (!obj) return;
  modal(
    type === "chapter" ? "章节笔记" : "阶段笔记",
    `<div class="field"><textarea class="input" id="notes-text" rows="10" autofocus>${esc(obj[key])}</textarea></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="notes-save">保存</button>',
  );
  $("#notes-save").onclick = () => {
    const val = $("#notes-text").value;
    mutate(() => (obj[key] = val));
    closeModal();
  };
}

export function characterDialog(id = null, onCreated = null) {
  const p = id ? P(id) : newCharacter("", state.project.characters.length);
  if (!p) return;
  let color = p.color;
  modal(
    id ? "编辑角色" : "新角色",
    `<div class="field"><label>姓名</label><input class="input" id="char-name" value="${attr(p.name)}" maxlength="120" autofocus></div><div class="field"><label>颜色</label>${colorHTML(color)}</div><div class="field"><label>常用表情 <span class="tiny">· 逗号分隔</span></label><input class="input" id="char-expressions" value="${attr(p.expressions.join("，"))}"></div><div class="field"><label>常用动作 <span class="tiny">· 逗号分隔</span></label><input class="input" id="char-actions" value="${attr(p.actions.join("，"))}"></div><div class="field"><label>角色笔记</label><textarea class="input char-note" id="char-notes" rows="3">${esc(p.notes)}</textarea></div>${id ? '<div class="danger-zone"><span></span><button class="btn danger small" id="char-delete">删除角色</button></div>' : ""}`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="char-save">保存</button>',
  );
  bindColors((c) => (color = c));
  $("#char-save").onclick = () => {
    const name = $("#char-name").value.trim();
    if (!name) return toast("请输入角色姓名");
    if (state.project.characters.some((c) => c.id !== id && c.name === name))
      return toast("已有同名角色");
    const expr = [
        ...new Set(
          $("#char-expressions")
            .value.split(/[,，\n]/)
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ],
      actions = [
        ...new Set(
          $("#char-actions")
            .value.split(/[,，\n]/)
            .map((x) => x.trim())
            .filter(Boolean),
        ),
      ],
      notes = $("#char-notes").value;
    mutate(() => {
      Object.assign(p, { name, color, expressions: expr, actions, notes });
      if (!id) state.project.characters.push(p);
      if (onCreated) onCreated(p.id);
    });
    closeModal();
  };
  if (id)
    $("#char-delete").onclick = () => {
      if (investigationItems(state.project).some((item) => item.characterId === id))
        return toast("调查画布仍有卡片引用该角色，请先修改或移除相关卡片", true);
      let n = 0;
      for (const c of state.project.chapters)
        for (const s of c.stages)
          for (const r of flattenRows(stageRootRows(s)))
            if (r.speakerId === id) n++;
      confirmBox(
        "删除角色",
        `“${p.name}”被 ${n} 行对白引用。删除后，这些行的说话人会变为旁白，文字、动作和表情保留。`,
        () =>
          mutate(() => {
            state.project.characters = state.project.characters.filter(
              (c) => c.id !== id,
            );
            for (const c of state.project.chapters)
              for (const s of c.stages)
                for (const r of flattenRows(stageRootRows(s)))
                  if (r.speakerId === id) r.speakerId = "";
          }),
        true,
      );
    };
}

export function rulesDialog(id) {
  const c = C(id);
  if (!c) return;
  let draft = clone(c.unlock),
    newFlags = [];
  function targets(type, current) {
    let opts = [];
    if (type === "chapter")
      opts = state.project.chapters
        .filter((x) => x.id !== id)
        .map((x) => [x.id, `${R(x.routeId)?.name} / ${x.title}`]);
    if (type === "stage")
      opts = state.project.chapters
        .filter((x) => x.id !== id)
        .flatMap((x) => x.stages.map((s) => [s.id, `${x.title} / ${s.title}`]));
    if (type === "flag")
      opts = [...state.project.flags, ...newFlags].map((x) => [x.id, x.name]);
    return (
      option("", "选择目标", current) +
      opts.map(([v, t]) => option(v, t, current)).join("")
    );
  }
  function draw() {
    modal(
      "解锁 · " + c.title,
      `<div class="rule-mode"><button data-mode="all" class="${draft.mode === "all" ? "selected" : ""}" title="所有条件均满足时解锁">全部满足</button><button data-mode="any" class="${draft.mode === "any" ? "selected" : ""}" title="任意一个条件满足时解锁">任一满足</button></div><div id="rule-list">${draft.rules.length ? draft.rules.map((r, i) => `<div class="rule-row" data-rule-index="${i}"><select class="input" data-rule-field="type" aria-label="条件类型">${option("chapter", "章节", r.type)}${option("stage", "阶段", r.type)}${option("flag", "自定条件", r.type)}</select><select class="input" data-rule-field="targetId" aria-label="条件目标">${targets(r.type, r.targetId)}</select>${r.type === "flag" ? `<select class="input expected-select" data-rule-field="expected" aria-label="条件取值">${option("true", "已达成", String(r.expected !== false))}${option("false", "未达成", String(r.expected !== false))}</select>` : '<span class="rule-state">已完成</span>'}<button class="icon-btn" data-rule-delete="${i}" title="移除此条件">${ico("close")}</button></div>`).join("") : `<div class="rule-empty">${ico("play")}<span>无前置条件</span></div>`}</div><div style="display:flex;gap:8px;margin-top:19px"><button class="btn small" id="rule-add">${ico("plus")}条件</button><button class="btn ghost small" id="rule-new-flag">${ico("flag")}新建自定条件</button></div><div id="new-rule-flag" class="hidden"><div class="field-row"><div class="field"><input class="input" id="local-flag-name" placeholder="条件名称" aria-label="新条件名称" maxlength="200"></div><div class="field" style="flex:0;justify-content:center"><button class="btn" id="local-flag-add">创建</button></div></div></div>`,
      btn("取消", null, "modal-close") +
        '<button class="btn primary" id="rules-apply">保存</button>',
      true,
    );
    $$("[data-mode]").forEach(
      (b) =>
        (b.onclick = () => {
          draft.mode = b.dataset.mode;
          draw();
        }),
    );
    $$("[data-rule-field]").forEach(
      (el) =>
        (el.onchange = () => {
          const row = el.closest("[data-rule-index]"),
            rule = draft.rules[+row.dataset.ruleIndex],
            key = el.dataset.ruleField;
          if (key === "type") {
            rule.type = el.value;
            rule.targetId = "";
            rule.expected = true;
            draw();
          } else if (key === "expected") rule.expected = el.value === "true";
          else rule.targetId = el.value;
        }),
    );
    $$("[data-rule-delete]").forEach(
      (b) =>
        (b.onclick = () => {
          draft.rules.splice(+b.dataset.ruleDelete, 1);
          draw();
        }),
    );
    $("#rule-add").onclick = () => {
      draft.rules.push({
        id: uid("rule"),
        type: "chapter",
        targetId: "",
        expected: true,
      });
      draw();
    };
    $("#rule-new-flag").onclick = () => {
      $("#new-rule-flag").classList.remove("hidden");
      $("#local-flag-name").focus();
    };
    $("#local-flag-add").onclick = () => {
      const name = $("#local-flag-name").value.trim();
      if (!name) return toast("请输入条件名称");
      let f = [...state.project.flags, ...newFlags].find(
        (x) => x.name === name,
      );
      if (!f) {
        f = { id: uid("flag"), name, notes: "" };
        newFlags.push(f);
      }
      draft.rules.push({
        id: uid("rule"),
        type: "flag",
        targetId: f.id,
        expected: true,
      });
      draw();
    };
    $("#rules-apply").onclick = () => {
      if (draft.rules.some((r) => !r.targetId))
        return toast("请为每条条件选择目标");
      const seen = new Set();
      draft.rules = draft.rules.filter((r) => {
        const key = r.type + ":" + r.targetId + ":" + r.expected;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      mutate(() => {
        c.unlock = draft;
        state.project.flags.push(...newFlags);
      });
      closeModal();
    };
  }
  draw();
}

export function addConnection(targetId) {
  if (!C(state.connectFrom)) return toast("先点击前置章节的下方圆点");
  if (state.connectFrom === targetId) return toast("不能将章节本身作为前置");
  const c = C(targetId),
    from = state.connectFrom;
  if (c.unlock.rules.some((r) => r.type === "chapter" && r.targetId === from)) {
    state.connectFrom = null;
    render();
    return toast("这条依赖已经存在");
  }
  mutate(() =>
    c.unlock.rules.push({
      id: uid("rule"),
      type: "chapter",
      targetId: from,
      expected: true,
    }),
  );
  state.connectFrom = null;
  render();
  toast("已连接 · " + (c.unlock.mode === "all" ? "全部满足" : "任一满足"));
}

export function flagsDialog(forSimulation = false) {
  modal(
    forSimulation ? "演练条件" : "自定条件",
    `<div id="flag-list">${state.project.flags.map((f) => `<div class="flag-row" data-flag="${attr(f.id)}">${forSimulation ? `<button class="toggle ${state.sim.flags.has(f.id) ? "on" : ""}" data-flag-toggle="${attr(f.id)}" role="switch" aria-checked="${state.sim.flags.has(f.id)}" aria-label="${attr(f.name)}"></button><span class="flag-title">${esc(f.name)}</span>` : `<input class="cell flag-title" data-flag-name="${attr(f.id)}" value="${attr(f.name)}" aria-label="条件名称" maxlength="200">`}<button class="icon-btn" data-flag-delete="${attr(f.id)}" title="删除条件" aria-label="删除条件">${ico("trash")}</button></div>`).join("")}</div><div class="field-row" style="margin-top:12px"><div class="field"><input class="input" id="flag-new-name" placeholder="条件名称" aria-label="新增条件名称" maxlength="200"></div><div class="field" style="flex:0;justify-content:center"><button class="btn" id="flag-create">${ico("plus")}</button></div></div>`,
    btn("完成", null, "modal-close", "primary"),
  );
  $$("[data-flag-toggle]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.flagToggle;
        state.sim.flags.has(id)
          ? state.sim.flags.delete(id)
          : state.sim.flags.add(id);
        reconcileSimulation();
        render();
        flagsDialog(true);
      }),
  );
  $$("[data-flag-name]").forEach(
    (inp) =>
      (inp.oninput = () => {
        edit(
          "flag:" + inp.dataset.flagName,
          () => (F(inp.dataset.flagName).name = inp.value),
        );
      }),
  );
  $$("[data-flag-delete]").forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.flagDelete;
        if (investigationItems(state.project).some((item) =>
          investigationScripts(item).some((script) => script.outcomes.includes(id) ||
            script.conditions?.some((condition) => condition.type === "flag" && condition.targetId === id))))
          return toast("调查交互仍在使用该条件，请先修改相关规则", true);
        const
          f = F(id),
          n = state.project.chapters.reduce(
            (a, c) =>
              a +
              c.unlock.rules.filter(
                (r) => r.type === "flag" && r.targetId === id,
              ).length,
            0,
          );
        confirmBox(
          "删除条件",
          `删除“${f.name}”，同时移除 ${n} 条解锁依赖。受影响章节的解锁条件会变化。`,
          () => {
            mutate(() => {
              state.project.flags = state.project.flags.filter(
                (x) => x.id !== id,
              );
              state.project.chapters.forEach(
                (c) =>
                  (c.unlock.rules = c.unlock.rules.filter(
                    (r) => !(r.type === "flag" && r.targetId === id),
                  )),
              );
            });
            flagsDialog(forSimulation);
          },
          true,
        );
      }),
  );
  $("#flag-create").onclick = () => {
    const name = $("#flag-new-name").value.trim();
    if (!name) return toast("请输入条件名称");
    if (state.project.flags.some((f) => f.name === name))
      return toast("已有同名条件");
    mutate(() =>
      state.project.flags.push({ id: uid("flag"), name, notes: "" }),
    );
    flagsDialog(forSimulation);
  };
}

export function previewRow(r) {
  if (r.type === "group") {
    const location = effectiveLocation(r, state.project.locations);
    return `<section class="read-scene-group"><h3>${esc(r.title)}</h3><p>${esc(location.name)} ${LOCATION_FIELDS.filter(
      (field) => location[field.key],
    )
      .map((field) => esc(field.label + "：" + location[field.key]))
      .join(
        " · ",
      )}</p>${location.properties.map((property) => "<p>" + esc(property.name) + "：" + esc(property.value) + "</p>").join("")}${r.notes ? "<p>" + esc(r.notes) + "</p>" : ""}${r.rows.map(previewRow).join("")}</section>`;
  }
  if (r.type === "note")
    return `<div class="preview-note">${esc(r.text)}</div>`;
  if (r.type === "effect")
    return `<div class="preview-effect">${esc(r.text)}</div>`;
  if (r.type === "branch")
    return `<div class="preview-dialogue"><strong>选项</strong><p>${esc(r.text)}</p><div class="read-local-options">${r.options.map((o, i) => `<div class="read-local-option"><strong>${String.fromCharCode(65 + i)} · ${esc(o.text)}</strong>${(o.rows || []).map(previewRow).join("")}<small>${o.mode === "jump" ? "↳ 跳转至 " + esc(C(o.chapterId)?.title || "未设置章节") + (o.stageId ? " / " + esc(S(o.stageId)?.stage.title || "未设置阶段") : "") : "↳ 返回下一行"}</small></div>`).join("")}</div></div>`;
  return `<div class="preview-dialogue"><strong>${esc(P(r.speakerId)?.name || "旁白")}</strong>${r.expression || r.action ? `<small> &nbsp; ${esc([r.expression, r.action].filter(Boolean).join(" · "))}</small>` : ""}<p>${esc(wrapDialogue(r.text, normalizeDialogueSettings(state.project.settings).dialogueLineLength))}</p></div>`;
}

export function readStage() {
  const st = currentStage();
  const html =
    st.kind === "investigation"
      ? st.objects
          .map((item) => {
            const location = inspectLocation(item);
            return `<section class="read-scene-group"><h3>${esc(inspectName(item))}</h3>${location ? `<p>地点 · ${esc(location)}</p>` : ""}
              ${item.notes ? `<p>${esc(item.notes)}</p>` : ""}${investigationScripts(item).map((script) => {
                const title = script === item ? (item.fallbackEnabled ? "默认脚本" : "默认脚本（已停用）") : script.name;
                const outcome = describeInvestigationOutcomes(script);
                return `<h4>${esc(title)}</h4>${script !== item ? `<p>${esc(describeInvestigationRule(st, script))}</p>` : ""}
                  ${outcome ? `<p>完成后达成 · ${esc(outcome)}</p>` : ""}${script.rows.map(previewRow).join("")}`;
              }).join("")}</section>`;
          })
          .join("")
      : st.rows.map(previewRow).join("");
  modal(
    st.title,
    `<div class="readable-preview">${html || '<div class="empty-centered">暂无脚本</div>'}</div>`,
    btn("关闭", null, "modal-close"),
    true,
  );
}

export function searchDialog() {
  modal(
    "搜索",
    `<input id="search-input" class="search-input" placeholder="章节、阶段、对白、角色、地点…" aria-label="搜索剧情" autofocus><div id="search-results" class="search-results"></div>`,
    "",
    true,
  );
  $("#search-input").oninput = () => {
    const q = $("#search-input").value.trim().toLowerCase(),
      found = [];
    if (!q) {
      $("#search-results").innerHTML = "";
      return;
    }
    const match = (t) =>
      String(t || "")
        .toLowerCase()
        .includes(q);
    for (const c of state.project.chapters) {
      if (match(c.title) || match(c.summary))
        found.push({
          title: c.title,
          path: R(c.routeId)?.name || "",
          text: c.summary,
          chapterId: c.id,
        });
      for (const s of c.stages) {
        const path = `${R(c.routeId)?.name} / ${c.title} / ${s.title}`;
        if (match(s.title) || match(s.notes))
          found.push({
            title: s.title,
            path,
            text: s.notes,
            chapterId: c.id,
            stageId: s.id,
          });
        if (s.kind === "investigation") {
          for (const item of s.objects) {
            if ([inspectName(item), inspectLocation(item), item.notes].some(match))
              found.push({
                title: inspectName(item),
                path,
                text: inspectLocation(item) || item.notes,
                chapterId: c.id,
                stageId: s.id,
                itemId: item.id,
              });
            for (const rule of item.interactions) {
              const summary = describeInvestigationRule(s, rule);
              if ([rule.name, summary, describeInvestigationOutcomes(rule)].some(match))
                found.push({ title: rule.name, path: path + " / " + inspectName(item), text: summary, chapterId: c.id, stageId: s.id, itemId: item.id, interactionId: rule.id });
            }
          }
        }
        for (const r of flattenRows(stageRootRows(s))) {
          if (
            [
              r.text,
              r.type === "group" ? r.title : "",
              r.type === "group" ? r.notes : "",
              r.type === "group"
                ? effectiveLocation(r, state.project.locations).name
                : "",
              r.action,
              r.expression,
              P(r.speakerId)?.name,
              ...(r.options || []).map((o) => o.text),
            ].some(match)
          )
            found.push({
              title:
                (r.type === "group" ? r.title : P(r.speakerId)?.name) ||
                (r.type === "branch"
                  ? "选项组"
                  : r.type === "effect"
                    ? "画面描述"
                    : r.type === "note"
                      ? "笔记"
                      : "旁白"),
              path,
              text:
                r.type === "group"
                  ? r.notes
                  : r.text || r.action || r.expression,
              chapterId: c.id,
              stageId: s.id,
              rowId: r.id,
            });
        }
      }
    }
    for (const p of state.project.characters)
      if (match(p.name) || match(p.notes))
        found.push({
          title: p.name,
          path: "角色",
          text: p.notes,
          characterId: p.id,
        });
    for (const location of state.project.locations)
      if (
        [
          location.name,
          location.notes,
          location.bgm,
          location.background,
          location.ambience,
          ...location.properties.map(
            (property) => property.name + " " + property.value,
          ),
        ].some(match)
      )
        found.push({
          title: location.name,
          path: "地点预设",
          text: location.notes,
          locationId: location.id,
        });
    const results = found.slice(0, 150);
    $("#search-results").innerHTML =
      results
        .map(
          (r, i) =>
            `<button class="search-item" data-result="${i}"><small>${esc(r.path)}</small><strong>${esc(r.title)}</strong><span>${esc(String(r.text).slice(0, 170))}</span></button>`,
        )
        .join("") || '<div class="empty-centered">没有匹配结果</div>';
    $$("[data-result]").forEach(
      (b) =>
        (b.onclick = () => {
          const r = results[+b.dataset.result];
          closeModal();
          if (r.locationId) {
            go("locations");
            locationDialog(r.locationId);
          } else if (r.characterId) {
            go("characters");
            characterDialog(r.characterId);
          } else {
            go(r.stageId ? "stage" : "chapter", r.chapterId, r.stageId || null);
            if (r.rowId || r.itemId) {
              const stage = S(r.stageId)?.stage;
              let location = r.rowId ? findRow(stage?.rows || [], r.rowId) : null;
              if (stage?.kind === "investigation") {
                for (const item of stage.objects) {
                  if (item.id === r.itemId) {
                    selectInvestigationItem(item.id, r.interactionId || null);
                    state.expandedInvestigationItems.add(item.id);
                    revealInvestigationPosition(stage, item.position);
                    break;
                  }
                  if (!r.rowId) continue;
                  for (const script of investigationScripts(item)) {
                    const candidate = findRow(script.rows, r.rowId);
                    if (!candidate) continue;
                    selectInvestigationItem(item.id, script === item ? null : script.id);
                    state.expandedInvestigationItems.add(item.id);
                    revealInvestigationPosition(stage, item.position);
                    location = candidate;
                    break;
                  }
                  if (location) break;
                }
              }
              if (!r.rowId) {
                render();
                revealInvestigationElement($(`[data-investigation-card="${r.itemId}"]`));
                return;
              }
              state.collapsedGroupIds.delete(r.rowId);
              for (const parent of location?.ancestors || [])
                state.collapsedGroupIds.delete(parent.id);
              if (location?.opt)
                state.collapsedOptionIds.delete(location.opt.id);
              render();
              requestAnimationFrame(() => {
                const row = $(
                  `[data-row="${r.rowId}"],[data-branch-row="${r.rowId}"]`,
                );
                if (!revealInvestigationElement(row)) row?.scrollIntoView({ block: "center" });
                row?.classList.add("flash-row");
              });
            }
          }
        }),
    );
  };
}

export function auditProject() {
  const issues = [];
  for (const c of state.project.chapters) {
    for (const r of c.unlock.rules) {
      if (
        (r.type === "chapter" && !C(r.targetId)) ||
        (r.type === "stage" && !S(r.targetId)) ||
        (r.type === "flag" && !F(r.targetId))
      )
        issues.push({ id: c.id, msg: "存在已缺失的解锁目标", kind: "引用" });
      if (
        (r.type === "chapter" && r.targetId === c.id) ||
        (r.type === "stage" && S(r.targetId)?.chapter.id === c.id)
      )
        issues.push({
          id: c.id,
          msg: "依赖本章或本章内部阶段，无法首次进入",
          kind: "自依赖",
        });
    }
    if (c.unlock.mode === "all") {
      const flags = new Map();
      for (const r of c.unlock.rules)
        if (r.type === "flag") {
          if (
            flags.has(r.targetId) &&
            flags.get(r.targetId) !== (r.expected !== false)
          )
            issues.push({
              id: c.id,
              msg: "同一条件同时要求已达成与未达成",
              kind: "冲突",
            });
          flags.set(r.targetId, r.expected !== false);
        }
    }
    for (const s of c.stages)
      for (const r of flattenRows(stageRootRows(s))) {
        if (r.type === "dialogue" && r.speakerId && !P(r.speakerId))
          issues.push({
            id: c.id,
            stageId: s.id,
            msg: "对白引用了不存在的角色",
            kind: "角色",
          });
        if (r.type === "branch")
          for (const op of r.options || []) {
            if (op.mode !== "jump") continue;
            if (!op.chapterId || !C(op.chapterId))
              issues.push({
                id: c.id,
                stageId: s.id,
                msg: "分支选项“" + (op.text || "未命名") + "”尚未设置有效章节",
                kind: "分支",
              });
            else if (
              op.stageId &&
              !C(op.chapterId).stages.some((x) => x.id === op.stageId)
            )
              issues.push({
                id: c.id,
                stageId: s.id,
                msg: "分支选项的目标阶段不属于目标章节",
                kind: "分支",
              });
          }
      }
  }
  const reachable = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of state.project.chapters) {
      if (reachable.has(c.id)) continue;
      const rs = c.unlock.rules,
        possible = (r) =>
          r.type === "flag"
            ? !!F(r.targetId)
            : r.type === "chapter"
              ? reachable.has(r.targetId)
              : !!S(r.targetId) && reachable.has(S(r.targetId).chapter.id);
      if (
        !rs.length ||
        (c.unlock.mode === "any" ? rs.some(possible) : rs.every(possible))
      ) {
        reachable.add(c.id);
        changed = true;
      }
    }
  }
  for (const c of state.project.chapters)
    if (!reachable.has(c.id))
      issues.push({
        id: c.id,
        msg: "从现有起点不可达，请检查闭环或缺失前置",
        kind: "不可达",
      });
  return issues;
}

export function auditDialog() {
  const issues = auditProject();
  modal(
    "剧情关系检查",
    issues.length
      ? issues
          .map(
            (x, i) =>
              `<div class="diagnostic"><span class="kind">${esc(x.kind)}</span><button data-audit="${i}">${esc(C(x.id)?.title || "")} ${ico("next")}</button><div>${esc(x.msg)}</div></div>`,
          )
          .join("")
      : '<div class="empty-centered">未发现引用缺失或前置不可达</div>',
    btn("关闭", null, "modal-close"),
  );
  $$("[data-audit]").forEach(
    (b) =>
      (b.onclick = () => {
        const x = issues[+b.dataset.audit];
        closeModal();
        go(x.stageId ? "stage" : "chapter", x.id, x.stageId || null);
      }),
  );
}

export function backupDialog() {
  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem(BACKUPS) || "[]");
  } catch (e) {}
  modal(
    "最近备份",
    arr.length
      ? arr
          .map(
            (b, i) =>
              `<button class="search-item" data-backup="${i}"><strong>${esc(b.title)}</strong><small>${esc(new Date(b.at).toLocaleString("zh-CN"))}</small></button>`,
          )
          .join("")
      : '<div class="empty-centered">暂无切换前的本地备份</div>',
    btn("关闭", null, "modal-close"),
  );
  $$("[data-backup]").forEach(
    (b) =>
      (b.onclick = () => {
        let p;
        try {
          p = normalizeProject(arr[+b.dataset.backup].project);
        } catch (e) {
          return toast(e.message, true);
        }
        closeModal();
        guardReplace(() => {
          adopt(p, "", null, true);
          toast("已恢复备份");
        });
      }),
  );
}

export function helpDialog() {
  modal(
    "使用说明",
    `<div class="help"><h3>项目和文件</h3><p>${isAndroid ? "项目保存在应用私有目录；系统自动回收进程后可恢复最近草稿。卸载会删除本机数据，请先存到云端或导出备份。保存写入本机项目库；另存会创建新副本；导入、导出通过系统文件选择器选择位置。" : "项目保存在系统「文档/叙线/剧本项目」。Ctrl+S 保存当前源文件；另存会创建并切换到新副本。「打开源文件所在文件夹」定位当前 JSON；「下载源文件副本」可自行选择导出位置。"}</p><h3>路线图触屏操作</h3><p>滑动屏幕浏览路线图。短按章节打开，长按约半秒出现拖动提示后再移动，松手放置；鼠标仍可直接拖动。移动前滑动、多指操作或取消不会改变章节位置。</p><h3>章节与脚本</h3><p>路线 → 章节 → 剧情阶段 / 调查阶段。调查阶段可双击画布空白处新建物品或人物，拖动平移，滚轮或双指缩放。点击卡片展开脚本，使用卡片箭头收起。每张卡片可按调查次数和文字条件匹配交互，点击「演练」可验证。对白可编辑角色、表情和动作；描述用于记录画面、音效和转场。Enter 换行，Alt+Enter 新增对白。</p><h3>行与场景组</h3><p>点击行号选中，触屏连续点行号可多选；键盘使用 Shift 连续多选，Ctrl/⌘ 增减选择。右键行号或空白处，可在上方、下方插入对白或描述。Ctrl/⌘+G 将同一段脚本内的连续行建立为场景组。组可备注地点、折叠、复制、移动和取消分组；取消分组保留全部内容。首版使用单层组。</p><h3>地点预设</h3><p>在路线图点击「地点」管理背景、BGM、环境音和自定义属性。场景组引用地点后默认沿用预设，也可单独覆盖属性；这些设置作为剧本演出元数据保存。</p><h3>复制和撤销</h3><p>Ctrl/⌘+C/V 复制和粘贴选中行，支持整组、跨阶段和跨项目。跨项目复制会携带所引用的地点与角色。Delete 删除选中内容；Ctrl/⌘+Z 撤销，Ctrl/⌘+Shift+Z 重做。鼠标可按住行空白区域拖动排序；Android 触屏通过行菜单移动，避免滚动时误排序。</p><h3>全局云存档</h3><p>在项目库打开「云存档」。每个存档包含全部项目，由你手动新建、覆盖、读取或删除；不会自动判断同步方向。读档会直接替换整个项目库及未保存改动，不会先保存或保留读档备份。单个项目没有同步按钮。</p><h3>文件兼容</h3><p>JSON v5 保存调查画布、地点和交互规则，兼容读取 v1–v4。本机项目库在保存时保留自动备份。</p></div>`,
    btn("关闭", null, "modal-close"),
    true,
  );
}

export function aboutDialog() {
  modal(
    "叙线",
    `<div class="help"><p>轻量 AVG 剧情编辑器 · ${VERSION}</p><p>${isAndroid ? "Android 应用" : "独立桌面应用"} · 本地优先 · MIT 开源许可</p><h3>MIT License</h3><p>Copyright (c) 2026</p><p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p><p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p><p>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p></div>`,
    btn("关闭", null, "modal-close"),
    true,
  );
}
