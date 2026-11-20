import {
  dialogueEncyclopediaMenu,
  editDialogueLink,
  encyclopediaEntryDialog,
  revealEncyclopediaEntry,
  selectedDialogueText,
} from "./encyclopedia.js";
import { remapEncyclopediaLinks, setEncyclopediaLinks } from "../domain/encyclopedia.js";
import { applyDialogueWrap } from "../domain/dialogue.js";
import {
  clearPasteGesture,
  finishPasteShortcut,
  forgetClipboard,
  handleClipboardShortcut,
  handleCopy,
  handlePaste,
  releaseClipboard,
} from "./clipboard.js";
import {
  projectSettingsDialog,
  prepareDialogueInput,
  refreshDialogueMeter,
  refreshDialogueLinks,
} from "./dialogue-settings.js";
import { revealSource } from "./project-files.js";
import { groupDialog, groupMenu, locationDialog } from "./scenes.js";
import { findRow } from "../domain/scenes.js";
import { initializeMobile } from "./mobile.js";
import { revealInvestigationElement } from "./investigation-canvas.js";
import {
  inspectObjectMenu,
  investigationAddMenu,
  investigationRuleDialog,
  rehearseInvestigation,
} from "./investigation-editor.js";
import { showGitHubProjects } from "./github-sync.js";
import { uid, clone } from "../domain/primitives.js";
import { line } from "../domain/project.js";
import { showUpdates, configureUpdates } from "../ui/update-dialog";
import { isNative, isAndroid, onDesktopClose } from "../platform/runtime";
import { version as VERSION } from "../../package.json";
import {
  centerBoard,
  fitBoard,
  scheduleEdges,
  setZoom,
} from "./route-graph.js";
import {
  $,
  $$,
  BRIDGE,
  P,
  S,
  currentChapter,
  currentStage,
  ico,
  libraryVisible,
  state,
} from "./context.js";
import { autoSize } from "./script-view.js";
import {
  boot,
  currentInvestigationScript,
  currentRows,
  edit,
  go,
  mutate,
  persist,
  reconcileSimulation,
  redo,
  render,
  rowLocation,
  selectInvestigationItem,
  toast,
  toggleChapter,
  toggleStage,
  undo,
} from "./session.js";
import {
  addChapterDialog,
  addConnection,
  boardMenu,
  chapterMenu,
  characterDialog,
  closeMenu,
  closeModal,
  flagsDialog,
  investigationStageMenu,
  menu,
  notesDialog,
  readStage,
  requestDesktopClose,
  routeMenu,
  rulesDialog,
  searchDialog,
  stageDialog,
  stageMenu,
  topMenu,
} from "./dialogs.js";
import {
  addRow,
  branchRowMenu,
  copyRowsButton,
  deleteSelectedRows,
  focusRow,
  localOptionMenu,
  pasteRowsButton,
  rowMenu,
  rowsAreEditable,
  scriptMenu,
  selectRow,
  syncRowSelection,
} from "./row-operations.js";
import {
  bridgeCall,
  closeProjectLibrary,
  importLegacyProjects,
  importSelectedSource,
  importSourceAction,
  loadFile,
  newHubDialog,
  openSource,
  refreshProjectLibrary,
  saveSource,
} from "./project-files.js";

window.addEventListener("resize", () => {
  centerBoard();
  scheduleEdges();
  if (state.view.type === "stage")
    requestAnimationFrame(() => $$("textarea.autosize").forEach(autoSize));
});

export // Event delegation keeps document state independent of the current view.
function dispatch(action, el) {
  const id = el.dataset.id;
  switch (action) {
    case "board-list":
    case "board-graph":
      state.boardPresentation = action === "board-list" ? "list" : "graph";
      render();
      persist();
      break;
    case "board":
      go("board");
      break;
    case "project-settings":
      projectSettingsDialog();
      break;
    case "encyclopedia":
      go("encyclopedia");
      break;
    case "add-encyclopedia-entry":
      encyclopediaEntryDialog();
      break;
    case "edit-encyclopedia-entry":
      encyclopediaEntryDialog(id);
      break;
    case "edit-dialogue-link":
      editDialogueLink(el);
      break;
    case "read-encyclopedia-entry":
      revealEncyclopediaEntry(el);
      break;
    case "locations":
      go("locations");
      break;
    case "add-location":
      locationDialog();
      break;
    case "edit-location":
      locationDialog(id);
      break;
    case "group-selected":
      groupDialog();
      break;
    case "edit-group":
      groupDialog(id);
      break;
    case "group-menu":
      groupMenu(id, el);
      break;
    case "group-toggle":
      state.collapsedGroupIds.has(id)
        ? state.collapsedGroupIds.delete(id)
        : state.collapsedGroupIds.add(id);
      render();
      break;
    case "group-add-dialogue":
    case "group-add-effect": {
      const group = rowLocation(id)?.row;
      if (group?.type === "group") {
        const row = line(action === "group-add-effect" ? "effect" : "dialogue");
        mutate(() => group.rows.push(row));
        focusRow(row.id);
      }
      break;
    }
    case "characters":
      go("characters");
      break;
    case "add-character":
      characterDialog();
      break;
    case "edit-character":
      characterDialog(id);
      break;
    case "board-menu":
      boardMenu(el);
      break;
    case "route-menu":
      routeMenu(id, el);
      break;
    case "add-chapter":
      addChapterDialog();
      break;
    case "lane-add":
      addChapterDialog(id);
      break;
    case "open-chapter":
      go("chapter", id);
      break;
    case "chapter-menu":
      chapterMenu(id, el);
      break;
    case "current-chapter-menu":
      chapterMenu(state.view.chapterId, el);
      break;
    case "current-rules":
      rulesDialog(state.view.chapterId);
      break;
    case "rules":
      rulesDialog(id);
      break;
    case "chapter-notes":
      notesDialog("chapter", state.view.chapterId);
      break;
    case "stage-notes":
      notesDialog("stage", state.view.stageId);
      break;
    case "add-stage":
      stageDialog();
      break;
    case "inspect-create":
      investigationAddMenu(el);
      break;
    case "inspect-stage-menu":
      investigationStageMenu(el);
      break;
    case "inspect-select":
    case "inspect-fold": {
      const expanded = state.expandedInvestigationItems;
      const collapse = action === "inspect-fold" && expanded.has(id);
      if (collapse) expanded.delete(id);
      else expanded.add(id);
      selectInvestigationItem(id);
      if (collapse) {
        state.selectedRowIds.clear();
        state.selectionAnchor = null;
      }
      render();
      const card = $(`[data-investigation-card="${id}"]`);
      $(`[data-act="${action}"]`, card)?.focus({ preventScroll: true });
      if (!collapse) revealInvestigationElement(card);
      break;
    }
    case "inspect-collapse-all":
      for (const item of currentStage().objects) state.expandedInvestigationItems.delete(item.id);
      state.selectedRowIds.clear();
      state.selectionAnchor = null;
      render();
      $(".investigation-viewport")?.focus({ preventScroll: true });
      break;
    case "inspect-menu":
      inspectObjectMenu(id, el);
      break;
    case "inspect-rule-add":
      investigationRuleDialog();
      break;
    case "inspect-rule-settings": {
      const scriptId = currentInvestigationScript()?.id;
      if (scriptId) {
        const isDefault = scriptId === state.activeInspectObjectId;
        investigationRuleDialog(isDefault ? null : scriptId, isDefault);
      }
      break;
    }
    case "inspect-rehearse":
      rehearseInvestigation();
      break;
    case "open-stage": {
      const obj = S(id);
      if (obj) go("stage", obj.chapter.id, id);
      break;
    }
    case "stage-menu":
      stageMenu(id, el);
      break;
    case "add-row":
      addRow();
      break;
    case "add-effect":
      addRow("effect");
      break;
    case "row-menu":
      rowMenu(id, el);
      break;
    case "branch-row-menu":
      branchRowMenu(id, el);
      break;
    case "local-option-menu":
      localOptionMenu(id, el.dataset.option, el);
      break;
    case "local-toggle": {
      const section = el.closest(".local-option"),
        folded = section.classList.toggle("collapsed"),
        oid = section.dataset.option;
      folded
        ? state.collapsedOptionIds.add(oid)
        : state.collapsedOptionIds.delete(oid);
      el.setAttribute("aria-expanded", String(!folded));
      break;
    }
    case "local-add-option": {
      const row = rowLocation(id)?.row;
      if (!row || row.type !== "branch") break;
      mutate(() =>
        row.options.push({
          id: uid("opt"),
          text: "选项 " + String.fromCharCode(65 + row.options.length),
          mode: "continue",
          chapterId: "",
          stageId: "",
          rows: [line()],
        }),
      );
      break;
    }
    case "branch-add-line": {
      const row = rowLocation(id)?.row,
        op = row?.options.find((o) => o.id === el.dataset.option);
      if (!op) break;
      const r = line();
      mutate(() => op.rows.push(r));
      focusRow(r.id);
      break;
    }
    case "branch-add-effect": {
      const row = rowLocation(id)?.row,
        op = row?.options.find((o) => o.id === el.dataset.option);
      if (!op) break;
      const r = line("effect");
      mutate(() => op.rows.push(r));
      focusRow(r.id);
      break;
    }
    case "branch-action-presets": {
      const loc = rowLocation(id),
        p = P(loc?.row.speakerId);
      if (p)
        menu(
          el,
          p.actions.map((action) => ({
            label: action,
            click: () => mutate(() => (loc.row.action = action)),
          })),
        );
      break;
    }
    case "copy-rows":
      copyRowsButton();
      break;
    case "delete-selected":
      deleteSelectedRows();
      break;
    case "paste-rows":
      pasteRowsButton();
      break;
    case "clear-rows":
      state.selectedRowIds.clear();
      state.selectionAnchor = null;
      syncRowSelection();
      break;
    case "script-menu":
      scriptMenu(el);
      break;
    case "action-presets": {
      const row = rowLocation(id)?.row,
        p = P(row?.speakerId);
      if (p)
        menu(
          el,
          p.actions.map((action) => ({
            label: action,
            click: () => mutate(() => (row.action = action)),
          })),
        );
      break;
    }
    case "read-stage":
      readStage();
      break;
    case "port-out":
      state.connectFrom = state.connectFrom === id ? null : id;
      render();
      break;
    case "port-in":
      addConnection(id);
      break;
    case "connection-toggle":
      state.connectFrom = state.connectFrom ? null : "__choose";
      render();
      if (state.connectFrom)
        toast("点击前置章节下方圆点，再点击目标章节上方圆点");
      break;
    case "cancel-connect":
      state.connectFrom = null;
      render();
      break;
    case "zoom-in":
      setZoom(state.zoom + 0.1);
      break;
    case "zoom-out":
      setZoom(state.zoom - 0.1);
      break;
    case "zoom-reset":
      setZoom(1);
      break;
    case "fit-board":
      fitBoard();
      break;
    case "sim-toggle":
      state.sim.active = !state.sim.active;
      reconcileSimulation();
      render();
      break;
    case "sim-reset":
      state.sim.chapters.clear();
      state.sim.stages.clear();
      state.sim.flags.clear();
      render();
      toast("演练已重置");
      break;
    case "sim-flags":
      flagsDialog(true);
      break;
    case "complete-chapter":
      toggleChapter(id);
      break;
    case "complete-stage":
      toggleStage(id);
      break;
    case "modal-close":
      closeModal();
      break;
  }
}

document.addEventListener("click", (ev) => {
  if (
    Date.now() < state.dragSuppressUntil &&
    ev.target.closest(
      state.dragSource === "chapter"
        ? ".chapter-card"
        : ".script-row,.branch-script-row",
    )
  )
    return;
  const row = ev.target.closest(".branch-script-row,.script-row");
  if (row && state.view.type === "stage" && !$("#modal-root").firstChild) {
    const gutter = ev.target.closest(".row-select,.row-number");
    const interactive = ev.target.closest(
      "button,input,textarea,select,.drag-handle",
    );
    if (
      gutter ||
      !interactive ||
      ((ev.shiftKey || ev.ctrlKey || ev.metaKey) &&
        !ev.target.closest("[data-act]"))
    ) {
      selectRow(row.dataset.branchRow || row.dataset.row, {
        shift: ev.shiftKey,
        toggle:
          ev.ctrlKey ||
          ev.metaKey ||
          ev.pointerType === "touch" ||
          ev.pointerType === "pen",
      });
      if (interactive && !gutter && (ev.shiftKey || ev.ctrlKey || ev.metaKey))
        ev.preventDefault();
      return;
    }
  }
  const el = ev.target.closest("[data-act]");
  if (el) {
    ev.stopPropagation();
    dispatch(el.dataset.act, el);
  }
});

document.addEventListener("contextmenu", (event) => {
  if (
    state.view.type !== "stage" ||
    $("#modal-root").firstChild ||
    libraryVisible()
  )
    return;
  const selection = selectedDialogueText(event.target);
  if (selection) {
    dialogueEncyclopediaMenu(event, selection);
    return;
  }
  const element = event.target.closest(".script-row,.branch-script-row");
  if (!element || event.target.closest("input,textarea,select")) return;
  event.preventDefault();
  const id = element.dataset.branchRow || element.dataset.row;
  if (!state.selectedRowIds.has(id)) selectRow(id);
  const anchor = {
    getBoundingClientRect: () => ({
      right: event.clientX,
      bottom: event.clientY,
    }),
  };
  if (rowLocation(id)?.row.type === "group") groupMenu(id, anchor);
  else rowMenu(id, anchor);
});

document.addEventListener("pointerdown", (ev) => {
  clearPasteGesture();
  if (
    !ev.target.closest(".menu") &&
    !ev.target.closest("#menu-btn,#mobile-more")
  )
    closeMenu();
});

const dialogueEdits = new WeakMap();
document.addEventListener("beforeinput", (event) => {
  const field = event.target;
  if (field.matches?.("textarea.dialogue-cell"))
    dialogueEdits.set(field, {
      start: field.selectionStart, end: field.selectionEnd, inputType: event.inputType,
    });
});

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "project-name") {
    edit("project:title", () => (state.project.title = t.value));
    return;
  }
  if (t.dataset.bind) {
    const key = t.dataset.bind;
    if (key === "chapter-title")
      edit(
        "chapter:" + state.view.chapterId,
        () => (currentChapter().title = t.value),
      );
    else if (key === "stage-title")
      edit(
        "stage:" + state.view.stageId,
        () => (currentStage().title = t.value),
      );
    return;
  }
  if (t.matches("textarea.dialogue-cell")) {
    const element = t.closest("[data-branch-row],[data-row]");
    const id = element.dataset.branchRow || element.dataset.row;
    const row = rowLocation(id)?.row;
    if (!row) return;
    const selection = dialogueEdits.get(t);
    dialogueEdits.delete(t);
    const typed = t.value;
    if (!state.composition && !ev.isComposing) prepareDialogueInput(t);
    else refreshDialogueMeter(t);
    if (row.text !== t.value || row.text !== typed) {
      edit("row:" + id + ":text", () => {
        setEncyclopediaLinks(row, remapEncyclopediaLinks(row.encyclopediaLinks, row.text, typed, selection));
        row.text = typed;
        applyDialogueWrap(row, t.value);
      });
      refreshDialogueLinks(t, row);
    }
    autoSize(t);
    return;
  }
  if (t.dataset.branchField && t.tagName !== "SELECT") {
    const id = t.closest("[data-branch-row]")?.dataset.branchRow,
      loc = rowLocation(id);
    if (!loc) return;
    edit(
      "row:" + id + ":" + t.dataset.branchField,
      () => (loc.row[t.dataset.branchField] = t.value),
    );
    if (t.tagName === "TEXTAREA") autoSize(t);
    return;
  }
  if (t.dataset.rowField && t.tagName !== "SELECT") {
    const id = t.closest("[data-row]").dataset.row,
      r = rowLocation(id)?.row;
    if (!r) return;
    edit(
      "row:" + id + ":" + t.dataset.rowField,
      () => (r[t.dataset.rowField] = t.value),
    );
    if (t.tagName === "TEXTAREA") autoSize(t);
    return;
  }
  if (t.dataset.optionField && t.tagName !== "SELECT") {
    const id = t.closest("[data-row]").dataset.row,
      oid = t.closest("[data-option]").dataset.option,
      row = rowLocation(id)?.row,
      op = row?.options.find((o) => o.id === oid);
    edit(
      "option:" + oid + ":" + t.dataset.optionField,
      () => (op[t.dataset.optionField] = t.value),
    );
  }
});

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.matches(".investigation-stage-picker")) {
    go("stage", state.view.chapterId, t.value);
    ($(".investigation-stage-picker") || $(".stage-tab.active"))?.focus({ preventScroll: true });
    return;
  }
  if (t.matches(".investigation-script-select")) {
    const itemId = t.closest("[data-inspect-item]").dataset.inspectItem;
    selectInvestigationItem(itemId, t.value || null);
    render();
    $(`[data-inspect-item="${itemId}"] .investigation-script-select`)?.focus({ preventScroll: true });
    revealInvestigationElement($(`[data-investigation-card="${itemId}"]`));
    return;
  }
  if (t.dataset.branchField && t.tagName === "SELECT") {
    const loc = rowLocation(t.closest("[data-branch-row]")?.dataset.branchRow);
    if (!loc) return;
    if (t.value === "__new") {
      t.value = loc.row.speakerId;
      characterDialog(null, (charId) => (loc.row.speakerId = charId));
    } else mutate(() => (loc.row[t.dataset.branchField] = t.value));
    return;
  }
  if (t.dataset.rowField && t.tagName === "SELECT") {
    const id = t.closest("[data-row]").dataset.row,
      row = rowLocation(id)?.row;
    if (!row) return;
    if (t.value === "__new") {
      t.value = row.speakerId;
      characterDialog(null, (charId) => (row.speakerId = charId));
    } else mutate(() => (row[t.dataset.rowField] = t.value));
    return;
  }
  if (t.dataset.optionField && t.tagName === "SELECT") {
    const id = t.closest("[data-row]").dataset.row,
      oid = t.closest("[data-option]").dataset.option,
      row = rowLocation(id)?.row,
      op = row?.options.find((o) => o.id === oid);
    const key = t.dataset.optionField,
      value = t.value;
    mutate(() => {
      op[key] = value;
      if (key === "chapterId") op.stageId = "";
    });
  }
});

document.addEventListener("copy", handleCopy);
document.addEventListener("cut", forgetClipboard);
document.addEventListener("paste", handlePaste);
document.addEventListener("keyup", finishPasteShortcut);

document.addEventListener("compositionstart", () => (state.composition = true));

document.addEventListener("compositionend", (event) => {
  state.composition = false;
  setTimeout(() => {
    if (
      event.target.isConnected &&
      !state.composition &&
      event.target.matches?.("textarea.dialogue-cell")
    )
      event.target.dispatchEvent(new Event("input", { bubbles: true }));
  }, 0);
});

document.addEventListener("keydown", (ev) => {
  clearPasteGesture();
  if (state.syncBusy) {
    ev.preventDefault();
    return;
  }
  if (document.querySelector(".update-overlay:not([hidden])")) return;
  if (state.composition || ev.isComposing || ev.keyCode === 229) return;
  const mod = ev.ctrlKey || ev.metaKey,
    k = ev.key.toLowerCase();
  if (mod && !ev.shiftKey && !ev.altKey && (k === "c" || k === "v")) {
    handleClipboardShortcut(ev, k);
    return;
  }
  if (
    mod &&
    k === "g" &&
    state.view.type === "stage" &&
    !$("#modal-root").firstChild &&
    !libraryVisible()
  ) {
    ev.preventDefault();
    groupDialog();
    return;
  }
  if (mod && ["s", "o", "k", "z", "y"].includes(k)) {
    if (k === "s") {
      ev.preventDefault();
      saveSource(ev.shiftKey);
      return;
    }
    if (k === "o") {
      ev.preventDefault();
      openSource();
      return;
    }
    if (k === "k") {
      ev.preventDefault();
      searchDialog();
      return;
    }
    if ($("#modal-root").firstChild && ["z", "y"].includes(k)) return;
    ev.preventDefault();
    if (k === "y" || (k === "z" && ev.shiftKey)) redo();
    else if (k === "z") undo();
    return;
  }
  if (
    ev.key === "Delete" &&
    !mod &&
    !ev.altKey &&
    state.view.type === "stage" &&
    state.selectedRowIds.size &&
    !$("#modal-root").firstChild &&
    !libraryVisible() &&
    !rowsAreEditable(ev.target)
  ) {
    ev.preventDefault();
    deleteSelectedRows();
    return;
  }
  if (ev.key === "Escape") {
    if ($("#menu-root").firstChild) closeMenu();
    else if ($("#modal-root").firstChild) closeModal();
    else if (libraryVisible()) closeProjectLibrary();
    else if (state.connectFrom) {
      state.connectFrom = null;
      render();
    }
    return;
  }
  if (
    ev.altKey &&
    ev.key === "Enter" &&
    state.view.type === "stage" &&
    !$("#modal-root").firstChild
  ) {
    ev.preventDefault();
    const inside = document.activeElement.closest("[data-branch-row]");
    if (inside) {
      const loc = rowLocation(inside.dataset.branchRow),
        r = line();
      if (loc) {
        mutate(() => loc.rows.splice(loc.rows.indexOf(loc.row) + 1, 0, r));
        focusRow(r.id);
      }
      return;
    }
    addRow(
      "dialogue",
      document.activeElement.closest("[data-row]")?.dataset.row || null,
    );
    return;
  }
  if (ev.key === "Enter" && ev.target.matches('[tabindex="0"][data-act]')) {
    ev.preventDefault();
    ev.target.click();
  }
  if (ev.key === "Tab" && $("#modal-root").firstChild) {
    const elements = $$(
      'button,input,select,textarea,[tabindex="0"]',
      $("#modal-root"),
    ).filter((e) => !e.disabled && e.offsetParent !== null);
    const first = elements[0],
      last = elements.at(-1);
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last?.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first?.focus();
    }
  }
});

$("#source-folder-btn").innerHTML = ico("folder");
$("#source-folder-btn").hidden = !isNative || isAndroid;
$("#source-folder-btn").onclick = revealSource;
$("#library-github").hidden = !isNative;
$("#library-github").onclick = showGitHubProjects;
$("#library-update").onclick = showUpdates;

$("#library-migrate").onclick = importLegacyProjects;

$("#library-migrate").hidden = !isNative || isAndroid;

$("#library-refresh").innerHTML = ico("reset");

$("#library-folder").innerHTML = ico("folder");
$("#library-folder").hidden = isAndroid;

$("#library-folder").onclick = async () => {
  if (!BRIDGE) return;
  try {
    await bridgeCall("projects/open-folder");
  } catch (e) {
    toast("无法打开项目文件夹：" + e.message, true);
  }
};

$("#library-refresh").onclick = refreshProjectLibrary;

$("#library-create").onclick = newHubDialog;

$("#library-import").onclick = importSourceAction;

$("#library-close").onclick = closeProjectLibrary;

$("#brand").innerHTML = ico("logo") + "<span>叙线</span>";

$("#brand").onclick = () => go("board");

$("#undo-btn").innerHTML = ico("undo");

$("#undo-btn").onclick = undo;

$("#search-btn").innerHTML = ico("search");

$("#search-btn").onclick = searchDialog;

$("#menu-btn").innerHTML = ico("dots");

$("#menu-btn").onclick = (e) => topMenu(e.currentTarget);

$("#open-btn").onclick = openSource;

$("#save-btn").onclick = () => saveSource();

$("#project-name").addEventListener("blur", () => {
  if (!state.project.title.trim()) {
    edit("project:title", () => (state.project.title = "未命名剧本"));
    $("#project-name").value = state.project.title;
  }
});

$("#file-input").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (f) await importSelectedSource(f);
};

window.addEventListener("beforeunload", (ev) => {
  clearTimeout(state.cacheTimer);
  persist();
  if (state.dirty && !state.suppressUnload) {
    ev.preventDefault();
    ev.returnValue = "";
  }
});

export function clearFileDrop() {
  state.dragDepth = 0;
  $(".file-drop-overlay")?.remove();
}

document.addEventListener("dragenter", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    state.dragDepth++;
    if (!$(".file-drop-overlay")) {
      const n = document.createElement("div");
      n.className = "file-drop-overlay";
      n.innerHTML = ico("file") + "<span>打开源文件</span>";
      document.body.append(n);
    }
  }
});

document.addEventListener("dragleave", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    state.dragDepth--;
    if (state.dragDepth <= 0) clearFileDrop();
  }
});

document.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) e.preventDefault();
});

document.addEventListener("drop", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    clearFileDrop();
    if (e.dataTransfer.files.length !== 1) return toast("一次只打开一份源文件");
    const file = e.dataTransfer.files[0],
      item = e.dataTransfer.items?.[0];
    let hp;
    try {
      hp = !BRIDGE && item?.getAsFileSystemHandle?.();
    } catch (_) {}
    Promise.resolve(hp)
      .then(async (h) => {
        if (h?.kind === "file") {
          try {
            return await loadFile(await h.getFile(), h);
          } catch (e) {
            toast("无法取得文件权限，将改用普通导入", true);
          }
        }
        await importSelectedSource(file);
      })
      .catch((e) => toast(e.message || "文件导入失败", true));
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) releaseClipboard();
});
window.addEventListener("blur", () => {
  releaseClipboard();
  clearFileDrop();
});

configureUpdates(async () => {
  if (state.dirty || state.exported) {
    const ok = await saveSource();
    if (!ok || state.dirty) return false;
  }
  persist();
  return true;
});

onDesktopClose(requestDesktopClose).catch((e) => toast(e.message, true));

window.XuXian = Object.freeze({
  version: VERSION,
  snapshot: () => clone(state.project),
});

boot();
initializeMobile();
