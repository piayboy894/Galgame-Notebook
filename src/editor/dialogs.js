import {
  normalizeProject,
  newProject,
  chapter,
  regenRowIds,
  stageRootRows,
  investigationObject,
  flattenRows,
  stage,
  branchRowCount,
} from "../domain/project.js";
import { clone, PALETTE, uid } from "../domain/primitives.js";
import { DEMO } from "../domain/demo.js";
import { showUpdates } from "../ui/update-dialog";
import { isDesktop } from "../platform/desktop";
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
  showProjectLibrary,
} from "./project-files.js";
import { freeY } from "./route-graph.js";

export function closeMenu() {
  $("#menu-root").innerHTML = "";
}

export function menu(anchor, items) {
  closeMenu();
  const r = anchor?.getBoundingClientRect?.() || {
    right: innerWidth - 24,
    bottom: 64,
  };
  const m = document.createElement("div");
  m.className = "menu";
  m.setAttribute("role", "menu");
  for (const item of items) {
    if (!item) {
      const sep = document.createElement("div");
      sep.className = "menu-sep";
      m.append(sep);
      continue;
    }
    const b = document.createElement("button");
    b.className = "menu-item" + (item.danger ? " danger" : "");
    b.disabled = !!item.disabled;
    b.innerHTML =
      (item.icon ? ico(item.icon) : "") +
      `<span>${esc(item.label)}</span>` +
      (item.shortcut
        ? `<span class="shortcut">${esc(item.shortcut)}</span>`
        : "");
    b.onclick = (e) => {
      e.stopPropagation();
      closeMenu();
      item.click();
    };
    m.append(b);
  }
  $("#menu-root").append(m);
  const mr = m.getBoundingClientRect();
  m.style.left =
    Math.max(8, Math.min(innerWidth - mr.width - 8, r.right - mr.width)) + "px";
  m.style.top =
    Math.max(8, Math.min(innerHeight - mr.height - 8, r.bottom + 7)) + "px";
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
    $("[autofocus]", $("#modal-root"))?.focus();
  });
}

export function closeModal() {
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
    ...(isDesktop
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
    if (s.kind === "investigation")
      for (const o of s.objects) {
        o.id = uid("object");
        o.rows.forEach(regenRowIds);
      }
  });
  c.unlock.rules.forEach((r) => (r.id = uid("rule")));
  c.stages.forEach((s) =>
    stageRootRows(s).forEach((row) =>
      row.options.forEach((op) => {
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
      for (const r of stageRootRows(s))
        for (const op of r.options)
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
      for (const row of stageRootRows(s))
        for (const op of row.options) {
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

export function inspectObjectDialog(id = null) {
  const st = currentStage();
  if (!st || st.kind !== "investigation") return;
  const obj = id
    ? (st.objects || []).find((o) => o.id === id)
    : investigationObject();
  if (!obj) return;
  modal(
    id ? "编辑调查物品" : "新调查物品",
    `<div class="field"><label>物品名称</label><input class="input" id="inspect-name" value="${attr(obj.name)}" maxlength="160" autofocus></div><div class="field"><label>备注</label><textarea class="input" id="inspect-notes" rows="3">${esc(obj.notes || "")}</textarea></div>`,
    btn("取消", null, "modal-close") +
      `<button class="btn primary" id="inspect-save">${id ? "保存" : "创建"}</button>`,
  );
  $("#inspect-save").onclick = () => {
    const name = $("#inspect-name").value.trim();
    if (!name) return toast("请输入调查物品名称");
    const notes = $("#inspect-notes").value;
    mutate(() => {
      obj.name = name;
      obj.notes = notes;
      if (!id) st.objects.push(obj);
      state.activeInspectObjectId = obj.id;
      state.selectedRowIds.clear();
      state.selectionAnchor = null;
    });
    closeModal();
  };
}

export function inspectObjectMenu(id, anchor) {
  const st = currentStage(),
    idx = st?.objects.findIndex((x) => x.id === id) ?? -1,
    obj = st?.objects[idx];
  if (!obj) return;
  menu(anchor, [
    { label: "编辑物品", icon: "edit", click: () => inspectObjectDialog(id) },
    {
      label: "复制物品",
      icon: "copy",
      click: () => {
        const c = clone(obj);
        c.id = uid("object");
        c.name += " · 副本";
        c.rows.forEach(regenRowIds);
        mutate(() => {
          st.objects.splice(idx + 1, 0, c);
          state.activeInspectObjectId = c.id;
          state.selectedRowIds.clear();
          state.selectionAnchor = null;
        });
      },
    },
    {
      label: "上移",
      icon: "up",
      disabled: idx === 0,
      click: () =>
        mutate(() =>
          st.objects.splice(idx - 1, 0, st.objects.splice(idx, 1)[0]),
        ),
    },
    {
      label: "下移",
      icon: "down",
      disabled: idx === st.objects.length - 1,
      click: () =>
        mutate(() =>
          st.objects.splice(idx + 1, 0, st.objects.splice(idx, 1)[0]),
        ),
    },
    null,
    {
      label: "删除物品",
      icon: "trash",
      danger: true,
      click: () => {
        const remove = () =>
          mutate(() => {
            st.objects.splice(idx, 1);
            state.activeInspectObjectId = st.objects[0]?.id || null;
            state.selectedRowIds.clear();
            state.selectionAnchor = null;
          });
        if (obj.rows.length)
          confirmBox(
            "删除调查物品",
            `删除“${obj.name}”及其中 ${flattenRows(obj.rows).length} 行脚本？`,
            remove,
            true,
          );
        else remove();
      },
    },
  ]);
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
    if (id && kind !== s.kind && branchRowCount(s) > 0)
      return toast("阶段已有脚本。请先复制阶段，再修改空白阶段的类型。", true);
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
  if (s.kind === "investigation")
    for (const o of s.objects) {
      o.id = uid("object");
      o.rows.forEach(regenRowIds);
    }
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
  const p = id
    ? P(id)
    : {
        id: uid("char"),
        name: "",
        color: PALETTE[state.project.characters.length % PALETTE.length],
        notes: "",
        expressions: ["平静", "微笑", "疑惑", "惊讶", "严肃"],
        actions: [],
      };
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
        const id = b.dataset.flagDelete,
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
  if (r.type === "note")
    return `<div class="preview-note">${esc(r.text)}</div>`;
  if (r.type === "effect")
    return `<div class="preview-effect">${esc(r.text)}</div>`;
  if (r.type === "branch")
    return `<div class="preview-dialogue"><strong>选项</strong><p>${esc(r.text)}</p><div class="read-local-options">${r.options.map((o, i) => `<div class="read-local-option"><strong>${String.fromCharCode(65 + i)} · ${esc(o.text)}</strong>${(o.rows || []).map(previewRow).join("")}<small>${o.mode === "jump" ? "↳ 跳转至 " + esc(C(o.chapterId)?.title || "未设置章节") + (o.stageId ? " / " + esc(S(o.stageId)?.stage.title || "未设置阶段") : "") : "↳ 返回下一行"}</small></div>`).join("")}</div></div>`;
  return `<div class="preview-dialogue"><strong>${esc(P(r.speakerId)?.name || "旁白")}</strong>${r.expression || r.action ? `<small> &nbsp; ${esc([r.expression, r.action].filter(Boolean).join(" · "))}</small>` : ""}<p>${esc(r.text)}</p></div>`;
}

export function readStage() {
  const st = currentStage();
  const html =
    st.kind === "investigation"
      ? (st.objects || [])
          .map(
            (o) => `<h3>${esc(o.name)}</h3>${o.rows.map(previewRow).join("")}`,
          )
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
    `<input id="search-input" class="search-input" placeholder="章节、阶段、对白、角色…" aria-label="搜索剧情" autofocus><div id="search-results" class="search-results"></div>`,
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
        if (s.kind === "investigation")
          for (const o of s.objects || [])
            if (match(o.name) || match(o.notes))
              found.push({
                title: o.name,
                path,
                text: o.notes,
                chapterId: c.id,
                stageId: s.id,
              });
        for (const r of flattenRows(stageRootRows(s))) {
          if (
            [
              r.text,
              r.action,
              r.expression,
              P(r.speakerId)?.name,
              ...(r.options || []).map((o) => o.text),
            ].some(match)
          )
            found.push({
              title:
                P(r.speakerId)?.name ||
                (r.type === "branch"
                  ? "选项组"
                  : r.type === "effect"
                    ? "画面描述"
                    : r.type === "note"
                      ? "笔记"
                      : "旁白"),
              path,
              text: r.text || r.action || r.expression,
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
          if (r.characterId) {
            go("characters");
            characterDialog(r.characterId);
          } else {
            go(r.stageId ? "stage" : "chapter", r.chapterId, r.stageId || null);
            if (r.rowId)
              requestAnimationFrame(() => {
                const row = $(
                  `[data-row="${r.rowId}"],[data-branch-row="${r.rowId}"]`,
                );
                row?.scrollIntoView({ block: "center" });
                row?.classList.add("flash-row");
              });
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
          for (const op of r.options) {
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
    `<div class="help"><h3>项目</h3><p>启动器扫描「剧本项目」文件夹。一份 JSON 对应一个项目，自动列出可新建、复制、重命名、删除的项目。Ctrl+S 保存回原文件；删除项目会先移至回收站。</p><h3>脚本</h3><p>路线 → 章节 → 剧情阶段 / 调查阶段。调查阶段可创建调查物品，每个物品下独立编排脚本；点击物品卡片展开相应对白。每行对白可设置说话人、对白、表情、动作。Enter 在同一句中换行，Alt+Enter 添加对白。「＋描述」添加没有序号的独立演出描述行，适合镜头、画面、音效与转场。</p><p>选项组内可创建多个选项、分别编写对白与描述。每个选项独立设置「合流」或「跳转」，跳转可指定目标章节与阶段；只有跳转到其他章节的分支在路线图上形成虚线。旧版的「局部选项」和「章节跳转」打开后都会自动升级为选项组。</p><h3>行操作</h3><p>点击行号可选中整行，描述行点击左侧小圆点；Shift 连选，Ctrl/⌘ 单选。选择后按 Delete 删除整行，可以 Ctrl/⌘ Z 撤销；在输入框中按 Delete 则正常删字。Ctrl/⌘ C/V 复制粘贴选中行，也支持跨章节、跨阶段。文字框本身保持普通文字复制。</p><h3>路线</h3><p>在路线图管理章节位置和解锁条件。阶段可以分别设置剧情或调查类型、标题、笔记、顺序；有脚本内容的阶段不可直接更换类型，以避免误丢失内容。解锁可依赖完成其他章节、完成某阶段或自定义条件。「演练」用于检查解锁关系，不影响剧本数据。</p><h3>保存</h3><p>Windows：用「启动叙线.cmd」打开。支持本地扫描项目和直接 JSON 写回。单独打开 HTML 时浏览器访问本地磁盘受到权限限制；Chrome/Edge 可在授权后写回，其他浏览器可下载文件副本。升级前请备份项目 JSON。v1.7 使用 JSON v3 格式，支持读取旧 v1–v2 文件，旧版编辑器不支持新的选项与描述结构。</p></div>`,
    btn("关闭", null, "modal-close"),
    true,
  );
}

export function aboutDialog() {
  modal(
    "叙线",
    `<div class="help"><p>轻量 AVG 剧情编辑器 · ${VERSION}</p><p>独立桌面应用 · 本地优先 · MIT 开源许可</p><h3>MIT License</h3><p>Copyright (c) 2026</p><p>Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:</p><p>The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.</p><p>THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.</p></div>`,
    btn("关闭", null, "modal-close"),
    true,
  );
}
