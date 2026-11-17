import { dialogueWrapChanges } from "../domain/dialogue.js";
import { findRow } from "../domain/scenes.js";
import { renderMobileSettings } from "./mobile-presentation.js";
import { renderLocations } from "./scenes.js";
import {
  flattenRows,
  branchRowCount,
  normalizeProject,
  newProject,
} from "../domain/project.js";
import { clone, now } from "../domain/primitives.js";
import {
  isNative,
  isAndroid,
  readMobileDraft,
  writeMobileDraft,
} from "../platform/runtime";
import {
  $,
  $$,
  BACKUPS,
  C,
  F,
  R,
  S,
  STORAGE,
  currentStage,
  state,
  textCount,
} from "./context.js";
import { closeMenu } from "./dialogs.js";
import { renderBoard } from "./route-graph.js";
import {
  autoSize,
  renderChapter,
  renderCharacters,
  renderStage,
} from "./script-view.js";
import {
  bridgeCall,
  restoreHandle,
  showProjectLibrary,
} from "./project-files.js";

export function rowLocation(id) {
  return findRow(currentRows() || [], id);
}
export function selectableRows() {
  const result = [];
  const visit = (rows) => {
    for (const row of rows) {
      result.push(row);
      if (row.type === "group" && !state.collapsedGroupIds.has(row.id))
        visit(row.rows);
      if (row.type === "branch")
        for (const option of row.options)
          if (!state.collapsedOptionIds.has(option.id)) visit(option.rows);
    }
  };
  visit(currentRows() || []);
  return result;
}

export function currentInvestigationItem() {
  const s = currentStage();
  if (s?.kind !== "investigation") return null;
  const o =
    (s.objects || []).find((x) => x.id === state.activeInspectObjectId) ||
    s.objects?.[0] ||
    null;
  if (o) state.activeInspectObjectId = o.id;
  return o;
}

export function currentRows() {
  const s = currentStage();
  if (!s) return null;
  return s.kind === "investigation"
    ? currentInvestigationItem()?.rows || null
    : s.rows;
}

export function toast(msg, error = false) {
  const e = $("#toast");
  e.textContent = msg;
  e.classList.toggle("error", error);
  e.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => e.classList.remove("show"), 3200);
}

export function pushHistory() {
  state.history.push(clone(state.project));
  if (state.history.length > 60) state.history.shift();
  state.future = [];
  state.lastEdit = "";
}

export function rememberEdit(token) {
  const t = Date.now();
  if (state.lastEdit !== token || t - state.lastEditAt > 1200) {
    pushHistory();
    state.lastEdit = token;
  }
  state.lastEditAt = t;
}

export function changed(renderNow = false) {
  state.project.updatedAt = now();
  state.dirty = true;
  state.exported = false;
  clearTimeout(state.cacheTimer);
  state.cacheTimer = setTimeout(persist, 350);
  reconcileSimulation();
  updateTop();
  if (renderNow) render();
}

export function mutate(fn, renderNow = true) {
  pushHistory();
  fn();
  if (!state.composition)
    for (const { row, text } of dialogueWrapChanges(state.project))
      row.text = text;
  changed(renderNow);
}

export function edit(token, fn) {
  rememberEdit(token);
  fn();
  changed(false);
}

export function undo() {
  closeMenu();
  if (!state.history.length) return;
  state.future.push(clone(state.project));
  state.project = state.history.pop();
  $("#project-name").value = state.project.title;
  state.lastEdit = "";
  validateView();
  changed(true);
}

export function redo() {
  closeMenu();
  if (!state.future.length) return;
  state.history.push(clone(state.project));
  state.project = state.future.pop();
  $("#project-name").value = state.project.title;
  state.lastEdit = "";
  validateView();
  changed(true);
}

export function persist() {
  if (!state.project) return;
  if (state.libraryOnly) {
    // A placeholder behind the project library is not a real editor session. Saving it used to
    // offer an empty/default project after a cloud load, despite the source files being present.
    try {
      localStorage.removeItem(STORAGE);
    } catch {
      state.cacheOK = false;
    }
    return;
  }
  const data = {
    project: state.project,
    sourceName: state.sourceName,
    fileStamp: state.fileStamp,
    dirty: state.dirty,
    exported: state.exported,
    view: state.view,
    zoom: state.zoom,
    boardPresentation: state.boardPresentation,
    lastWritingView: state.lastWritingView,
    libraryRevision: state.libraryRevision,
    savedAt: now(),
  };
  try {
    localStorage.setItem(STORAGE, JSON.stringify(data));
    state.cacheOK = true;
  } catch (e) {
    if (state.cacheOK && !isAndroid)
      toast("本机草稿暂存空间不足，请保存源文件", true);
    state.cacheOK = false;
  }
  if (isAndroid && state.project)
    void writeMobileDraft(data)
      .then(() => {
        state.cacheOK = true;
        updateTop();
      })
      .catch(() => {
        state.cacheOK = false;
        updateTop();
        toast("本机草稿暂存失败，请保存源文件", true);
      });
  updateTop();
}

export function backup() {
  try {
    const arr = JSON.parse(localStorage.getItem(BACKUPS) || "[]");
    arr.unshift({
      title: state.project.title,
      at: now(),
      project: clone(state.project),
    });
    localStorage.setItem(BACKUPS, JSON.stringify(arr.slice(0, 3)));
  } catch (e) {
    /* Main draft is never removed to make room for optional backups. */
  }
}

export function hasWritableSource() {
  return !!(state.fileHandle || state.bridgeBinding);
}

export function updateTop() {
  if (document.activeElement !== $("#project-name"))
    $("#project-name").value = state.project.title;
  document.title = state.project.title + " · 叙线";
  const status = $("#save-state");
  status.innerHTML = `<i class="state-dot ${state.dirty ? "dirty" : "saved"}"></i><span class="state-label">${!state.cacheOK ? "未暂存" : state.dirty ? (state.sourceName ? "未保存" : "本地草稿") : state.exported ? "已导出" : "已保存"}</span>`;
  status.title =
    (hasWritableSource()
      ? "已关联：" + state.sourceName
      : state.sourceName
        ? "已导入（尚未关联写入）：" + state.sourceName
        : "尚未关联源文件") +
    "\n" +
    (state.dirty
      ? "改动尚未保存到源文件。"
      : "当前版本已" + (state.exported ? "导出。" : "保存。")) +
    (state.cacheOK ? "本机草稿暂存不能替代文件备份。" : "本机草稿暂存不可用。");
  $("#undo-btn").disabled = !state.history.length;
  const stageCount = $(".stage-header .count");
  if (stageCount && currentStage())
    stageCount.textContent =
      branchRowCount(currentStage()) +
      " 行 · " +
      textCount(currentStage()) +
      " 字";
  document.dispatchEvent(new Event("editor:status"));
}

export function validateView() {
  if (state.view.type === "chapter" && !C(state.view.chapterId))
    state.view = { type: "board" };
  if (state.view.type === "stage" && !currentStage())
    state.view = C(state.view.chapterId)
      ? { type: "chapter", chapterId: state.view.chapterId }
      : { type: "board" };
}

export function go(type, chapterId = null, stageId = null) {
  if (type !== "stage" || stageId !== state.view.stageId)
    state.activeInspectObjectId = null;
  if (state.view.type === "board") {
    const e = $("#graph-viewport");
    if (e) state.boardScroll = { x: e.scrollLeft, y: e.scrollTop };
  }
  if (
    type !== "stage" ||
    stageId !== state.view.stageId ||
    chapterId !== state.view.chapterId
  ) {
    state.selectedRowIds.clear();
    state.selectionAnchor = null;
  }
  state.view = { type, chapterId, stageId };
  state.connectFrom = null;
  closeMenu();
  render();
  persist();
}

export function ruleTitle(r) {
  if (r.type === "chapter") {
    const c = C(r.targetId);
    return c ? `${R(c.routeId)?.name || ""} / ${c.title}` : "[缺失章节]";
  }
  if (r.type === "stage") {
    const s = S(r.targetId);
    return s ? `${s.chapter.title} / ${s.stage.title}` : "[缺失阶段]";
  }
  return F(r.targetId)?.name || "[缺失条件]";
}

export function ruleSatisfied(r) {
  if (r.type === "chapter") return state.sim.chapters.has(r.targetId);
  if (r.type === "stage") {
    const s = S(r.targetId);
    return (
      !!s &&
      (state.sim.stages.has(r.targetId) || state.sim.chapters.has(s.chapter.id))
    );
  }
  if (r.type === "flag")
    return (
      !!F(r.targetId) &&
      state.sim.flags.has(r.targetId) === (r.expected !== false)
    );
  return false;
}

export function isUnlocked(c) {
  const rs = c.unlock.rules;
  if (!rs.length) return true;
  return c.unlock.mode === "any"
    ? rs.some(ruleSatisfied)
    : rs.every(ruleSatisfied);
}

export function reconcileSimulation() {
  if (!state.sim.active) return;
  let change = true;
  while (change) {
    change = false;
    for (const id of [...state.sim.chapters]) {
      const c = C(id);
      if (!c || !isUnlocked(c)) {
        state.sim.chapters.delete(id);
        if (c) c.stages.forEach((s) => state.sim.stages.delete(s.id));
        change = true;
      }
    }
    for (const id of [...state.sim.stages]) {
      const obj = S(id);
      if (!obj || !isUnlocked(obj.chapter)) {
        state.sim.stages.delete(id);
        change = true;
      }
    }
  }
}

export function toggleChapter(id) {
  const c = C(id);
  if (!c) return;
  if (!isUnlocked(c)) return toast("前置条件尚未满足");
  if (state.sim.chapters.has(id)) {
    state.sim.chapters.delete(id);
    c.stages.forEach((s) => state.sim.stages.delete(s.id));
  } else state.sim.chapters.add(id);
  reconcileSimulation();
  render();
}

export function toggleStage(id) {
  const obj = S(id);
  if (!obj) return;
  if (!isUnlocked(obj.chapter)) return toast("章节尚未解锁");
  if (state.sim.chapters.has(obj.chapter.id)) {
    state.sim.chapters.delete(obj.chapter.id);
    obj.chapter.stages.forEach((s) => state.sim.stages.add(s.id));
  }
  if (state.sim.stages.has(id)) state.sim.stages.delete(id);
  else state.sim.stages.add(id);
  reconcileSimulation();
  render();
}

export function render() {
  validateView();
  if (state.view.type === "stage")
    state.lastWritingView = { ...state.view, projectId: state.project.id };
  const key =
    state.view.type +
    ":" +
    (state.view.chapterId || "") +
    ":" +
    (state.view.stageId || "");
  const same = key === state.renderedKey;
  const scroll = same
    ? ($(".script-scroll")?.scrollTop ?? $(".page-scroll")?.scrollTop ?? 0)
    : 0;
  const vp = $("#graph-viewport");
  if (same && state.view.type === "board" && vp && !state.skipBoardCapture)
    state.boardScroll = { x: vp.scrollLeft, y: vp.scrollTop };
  state.skipBoardCapture = false;
  state.renderedKey = key;
  updateTop();
  const e = $("#view");
  if (state.view.type === "board") renderBoard(e);
  else if (state.view.type === "chapter") renderChapter(e);
  else if (state.view.type === "stage") renderStage(e);
  else if (state.view.type === "characters") renderCharacters(e);
  else if (state.view.type === "locations") renderLocations(e);
  else if (state.view.type === "mobile-settings") renderMobileSettings(e);
  document.dispatchEvent(new Event("editor:render"));
  requestAnimationFrame(() => {
    $$("textarea.autosize").forEach(autoSize);
    const sc = $(".script-scroll") || $(".page-scroll");
    if (sc) sc.scrollTop = scroll;
  });
}

export async function boot() {
  let restored = false;
  let openedSource = null;
  const isEditorDraft = (data) =>
    data?.project &&
    (data.dirty !== false ||
      data.exported === true ||
      Boolean(data.sourceName));
  try {
    let data = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (isNative) {
      const library = await bridgeCall("projects/library-revision");
      state.libraryRevision = library?.revision || "legacy";
      if ((data?.libraryRevision || "legacy") !== state.libraryRevision)
        data = null;
    }
    if (!isEditorDraft(data)) data = null;
    if (isAndroid) {
      try {
        const nativeResult = await readMobileDraft();
        if (nativeResult.warning) toast(nativeResult.warning, true);
        const nativeDraft = nativeResult.draft;
        if (
          isEditorDraft(nativeDraft) &&
          (nativeDraft.libraryRevision || "legacy") === state.libraryRevision &&
          (!data?.project || String(nativeDraft.savedAt) > String(data.savedAt))
        )
          data = nativeDraft;
      } catch {
        toast("本机草稿无法读取，请从项目库打开", true);
      }
    }
    if (isNative && data?.sourceName) {
      try {
        const source = await bridgeCall("projects/open", {
          fileName: data.sourceName,
        });
        const project = normalizeProject(JSON.parse(source.text));
        if (data.dirty === false) {
          // Clean caches are only navigation state. Saved content always comes from disk.
          data = { ...data, project, fileStamp: source.stamp };
          openedSource = source;
        } else if (project.id === data.project.id) openedSource = source;
        else data = { ...data, sourceName: "", fileStamp: null };
      } catch {
        if (data.dirty === false) data = null;
        else data = { ...data, sourceName: "", fileStamp: null };
      }
    }
    if (data?.project) {
      state.project = normalizeProject(data.project);
      state.sourceName = data.sourceName || "";
      state.bridgeBinding = openedSource?.bindingId || null;
      state.fileStamp = data.fileStamp || openedSource?.stamp || null;
      state.dirty = data.dirty !== false;
      state.exported = data.exported === true;
      state.view = data.view || { type: "board" };
      state.lastWritingView = data.lastWritingView || null;
      state.boardPresentation = ["auto", "list", "graph"].includes(
        data.boardPresentation,
      )
        ? data.boardPresentation
        : "auto";
      state.zoom =
        typeof data.zoom === "number"
          ? Math.max(0.35, Math.min(1.6, data.zoom))
          : 1;
      restored = true;
    }
  } catch (e) {
    state.cacheOK = false;
  }
  if (!state.project) {
    state.project = newProject();
    state.dirty = false;
  }
  state.restoredDraft = restored;
  state.libraryOnly = !restored;
  if (state.libraryOnly) persist();
  render();
  if (restored) {
    if (!isNative) restoreHandle();
  }
  showProjectLibrary(true);
}
