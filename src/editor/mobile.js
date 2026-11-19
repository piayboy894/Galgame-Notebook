import { onBackButtonPress } from "@tauri-apps/api/app";
import { isAndroid, nativeCommand } from "../platform/runtime";
import {
  $,
  $$,
  state,
  libraryVisible,
  currentChapter,
  currentStage,
  S,
  attr,
  esc,
  ico,
  btn,
} from "./context.js";
import {
  closeMenu,
  closeModal,
  modal,
  menu,
  topMenu,
  searchDialog,
} from "./dialogs.js";
import {
  closeProjectLibrary,
  showProjectLibrary,
  saveSource,
  downloadSource,
  newHubDialog,
  importSourceAction,
} from "./project-files.js";
import {
  go,
  persist,
  render,
  toast,
  mutate,
  rowLocation,
  undo,
} from "./session.js";
import {
  addRow,
  insertRowAt,
  selectRow,
  syncRowSelection,
  rowMenu,
} from "./row-operations.js";
import { showGitHubProjects, showSyncSettings } from "./github-sync.js";
import { showUpdates } from "../ui/update-dialog";
import { isPhoneLayout } from "./mobile-presentation.js";
import { revealInvestigationElement } from "./investigation-canvas.js";

let compact = false;
let selecting = false;
let activeField = null;
let cameraBeforeKeyboard = null;
let initialized = false;

function control(id, icon, label, extra = "") {
  return `<button id="${id}" class="icon-btn" aria-label="${label}" title="${label}" ${extra}>${ico(icon)}</button>`;
}
function shell() {
  const app = $(".app");
  app.insertAdjacentHTML(
    "afterbegin",
    `<header class="mobile-header" id="mobile-header">${control("mobile-back", "back", "返回")}<button id="mobile-title"><strong></strong><small></small></button>${control("mobile-save", "save", "保存当前剧本")}${control("mobile-more", "dots", "更多操作")}</header><div class="mobile-stage-bar" id="mobile-stage-bar"><button id="mobile-stage-picker"></button><button id="mobile-select">多选</button>${control("mobile-search", "search", "搜索剧本")}</div>`,
  );
  app.insertAdjacentHTML(
    "beforeend",
    `<div class="mobile-compose" id="mobile-compose"><button id="mobile-add-effect">${ico("note")}描述</button><button id="mobile-add-dialogue">${ico("plus")}新增对白</button></div><nav id="mobile-nav" class="mobile-nav" aria-label="主要导航">${[
      ["outline", "map", "大纲"],
      ["writing", "edit", "写作"],
      ["settings", "users", "设定"],
      ["library", "folder", "项目"],
    ]
      .map(
        ([key, icon, label]) =>
          `<button data-mobile-nav="${key}">${ico(icon)}<span>${label}</span></button>`,
      )
      .join(
        "",
      )}<button class="mobile-rail-shortcuts" data-mobile-command="shortcuts" title="键盘快捷键">${ico("help")}<span>快捷键</span></button></nav>`,
  );
  app.insertAdjacentHTML(
    "beforeend",
    `<div class="mobile-keyboard-bar" id="mobile-keyboard-bar"><button id="mobile-keyboard-previous" aria-label="前往上一行">${ico("up")}上一行</button><button id="mobile-keyboard-next" aria-label="前往下一行">${ico("down")}下一行</button><button id="mobile-keyboard-add" aria-label="下方新增对白">${ico("plus")}</button><button id="mobile-keyboard-done">完成</button></div>`,
  );
  $("#mobile-keyboard-previous").onclick = () => focusNeighbour(-1);
  $("#mobile-keyboard-next").onclick = () => focusNeighbour(1);
  $("#mobile-keyboard-add").onclick = () => {
    const row = activeField?.closest("[data-row],[data-branch-row]");
    if (row)
      insertRowAt(
        row.dataset.branchRow || row.dataset.row,
        "dialogue",
        "below",
      );
  };
  $("#mobile-keyboard-done").onclick = hideKeyboard;
  $("#mobile-keyboard-bar").addEventListener("pointerdown", (event) =>
    event.preventDefault(),
  );
  $(".library-toolbar").insertAdjacentHTML(
    "beforeend",
    control("mobile-library-more", "dots", "项目库更多操作"),
  );
  $("#project-library").insertAdjacentHTML(
    "beforeend",
    `<div class="mobile-library-actions"><button id="mobile-library-import">${ico("folder")}导入剧本</button><button id="mobile-library-create">${ico("plus")}新建剧本</button></div>`,
  );
  $("#mobile-back").onclick = back;
  $("#mobile-title").onclick = renameCurrent;
  $("#mobile-save").onclick = () => saveSource();
  $("#mobile-more").onclick = () =>
    menu($("#mobile-more"), [
      { label: "搜索剧本", icon: "search", click: searchDialog },
      { label: "重命名", icon: "edit", click: renameCurrent },
      { label: "导出源文件", icon: "download", click: downloadSource },
      {
        label: "撤销",
        icon: "undo",
        disabled: !state.history.length,
        click: undo,
      },
      {
        label: "更多项目操作",
        icon: "dots",
        click: () => topMenu($("#mobile-more")),
      },
    ]);
  $("#mobile-stage-picker").onclick = stagePicker;
  $("#mobile-search").onclick = searchDialog;
  $("#mobile-select").onclick = () => {
    selecting = !selecting;
    if (!selecting) {
      state.selectedRowIds.clear();
      syncRowSelection();
    } else toast("点击行号或内容多选，再点建组、复制或删除");
    syncShell();
  };
  $("#mobile-add-dialogue").onclick = () => addRow("dialogue");
  $("#mobile-add-effect").onclick = () => addRow("effect");
  $("#mobile-library-create").onclick = newHubDialog;
  $("#mobile-library-import").onclick = importSourceAction;
  $("#mobile-library-more").onclick = () =>
    menu($("#mobile-library-more"), [
      { label: "云存档", icon: "download", click: showGitHubProjects },
      {
        label: "云存档连接设置",
        icon: "settings",
        click: () => showSyncSettings(true),
      },
      { label: "检测软件更新", icon: "download", click: showUpdates },
      { label: "键盘快捷键", icon: "help", click: shortcuts },
    ]);
  $$("[data-mobile-nav]").forEach(
    (button) => (button.onclick = () => navigate(button.dataset.mobileNav)),
  );
}

function syncShell() {
  if (!initialized || !state.project) return;
  const phone = isPhoneLayout();
  document.documentElement.classList.toggle("phone-ui", phone);
  document.documentElement.classList.toggle(
    "mobile-selecting",
    selecting || state.selectedRowIds.size > 0,
  );
  document.documentElement.classList.toggle(
    "library-visible",
    libraryVisible(),
  );
  if (state.view.type !== "stage") selecting = false;
  const stage = currentStage(),
    chapter = currentChapter();
  const title =
    state.view.type === "stage"
      ? stage?.title
      : state.view.type === "chapter"
        ? chapter?.title
        : {
            characters: "角色",
            locations: "地点预设",
            "mobile-settings": "设定",
            board: "大纲",
          }[state.view.type] || "叙线";
  $("#mobile-title strong").textContent = title || "叙线";
  $("#mobile-title small").textContent =
    `${state.project.title} · ${!state.cacheOK ? "草稿未暂存" : state.dirty ? "未保存" : state.exported ? "已导出" : "已保存"}`;
  $("#mobile-save").disabled = state.saving || state.syncBusy;
  $("#mobile-save").classList.toggle("has-changes", state.dirty);
  $("#mobile-stage-bar").hidden = state.view.type !== "stage" || stage?.kind === "investigation";
  $("#mobile-compose").hidden = state.view.type !== "stage" || stage?.kind === "investigation";
  $("#mobile-stage-picker").innerHTML =
    `<span>${esc(chapter?.title || "")} · ${esc(stage?.title || "")}</span>${ico("down")}`;
  $("#mobile-select").textContent =
    selecting || state.selectedRowIds.size ? "取消多选" : "多选";
  const active =
    state.view.type === "stage"
      ? "writing"
      : ["mobile-settings", "characters", "locations"].includes(state.view.type)
        ? "settings"
        : "outline";
  $$("[data-mobile-nav]").forEach((button) =>
    button.setAttribute(
      "aria-current",
      button.dataset.mobileNav === active ? "page" : "false",
    ),
  );
  // The library is a top-level screen. Prevent Tab from reaching the editor underneath it.
  $(".app").inert =
    state.syncBusy ||
    libraryVisible() ||
    Boolean($(".update-overlay:not([hidden])"));
}

function navigate(destination) {
  closeMenu();
  if (destination === "library") return showProjectLibrary(true);
  closeProjectLibrary();
  if (destination === "outline") go("board");
  if (destination === "settings") go("mobile-settings");
  if (destination === "writing") {
    const remembered = state.lastWritingView;
    if (remembered?.projectId === state.project.id && S(remembered.stageId))
      go("stage", remembered.chapterId, remembered.stageId);
    else stagePicker();
  }
}
function stagePicker() {
  const chapters = state.project.chapters;
  modal(
    "选择写作阶段",
    `<div class="mobile-stage-list">${chapters.map((chapter) => `<h3>${esc(chapter.title)}</h3>${chapter.stages.map((stage) => `<button class="mobile-stage-choice ${stage.id === state.view.stageId ? "active" : ""}" data-chapter="${attr(chapter.id)}" data-stage="${attr(stage.id)}"><span>${esc(stage.title)}</span><small>${stage.kind === "investigation" ? "调查" : "剧情"}</small>${ico("next")}</button>`).join("")}`).join("") || '<p class="mobile-section-hint">先在大纲中创建章节和阶段。</p>'}</div>`,
  );
  $$(".mobile-stage-choice").forEach(
    (button) =>
      (button.onclick = () => {
        closeModal();
        go("stage", button.dataset.chapter, button.dataset.stage);
      }),
  );
}
function renameCurrent() {
  const item =
    state.view.type === "stage"
      ? currentStage()
      : state.view.type === "chapter"
        ? currentChapter()
        : state.project;
  if (!item) return;
  modal(
    "重命名",
    `<div class="field"><label for="mobile-rename">名称</label><input class="input" id="mobile-rename" value="${attr(item.title)}" maxlength="200" autofocus></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="mobile-rename-save">确定</button>',
  );
  $("#mobile-rename-save").onclick = () => {
    const value = $("#mobile-rename").value.trim();
    if (!value) return toast("请填写名称", true);
    mutate(() => (item.title = value));
    closeModal();
  };
}
export function shortcuts() {
  modal(
    "键盘快捷键",
    `<dl class="shortcut-list">${[
      ["Ctrl / ⌘ + S", "保存当前剧本"],
      ["Ctrl / ⌘ + O", "打开源文件"],
      ["Ctrl / ⌘ + K", "搜索"],
      ["Ctrl / ⌘ + G", "将连续选中行建组"],
      ["Ctrl / ⌘ + Z", "撤销"],
      ["Ctrl / ⌘ + Shift + Z", "重做"],
      ["Ctrl / ⌘ + C / V", "复制、粘贴选中行"],
      ["Alt + Enter", "下方新增对白"],
      ["Shift + F10", "选中行的右键菜单"],
      ["Esc", "返回或关闭当前操作"],
      ["Tab / Shift + Tab", "移动焦点"],
    ]
      .map(
        ([key, label]) =>
          `<div><dt>${esc(label)}</dt><dd><kbd>${esc(key)}</kbd></dd></div>`,
      )
      .join(
        "",
      )}</dl><p class="tiny">鼠标右键打开行菜单；Ctrl 点击增减选择，Shift 点击连续选择。触屏点击行号多选。文字选择和输入法候选期间保留系统行为。</p>`,
  );
}

export async function back() {
  if (state.syncBusy) return toast("操作进行中，请稍候");
  if (document.documentElement.classList.contains("ime-visible")) {
    await hideKeyboard();
    return;
  }
  if ($(".update-overlay:not([hidden])")) return $("#update-close")?.click();
  if ($("#menu-root").firstChild) {
    if ($("#menu-root").touchMenuBack) $("#menu-root").touchMenuBack();
    else closeMenu();
    return;
  }
  if ($("#modal-root").firstChild) return closeModal();
  if (state.selectedRowIds.size || selecting) {
    selecting = false;
    state.selectedRowIds.clear();
    syncRowSelection();
    syncShell();
    return;
  }
  if (libraryVisible()) {
    if (!state.libraryAtRoot && (state.dirty || state.sourceName))
      closeProjectLibrary();
    else {
      persist();
      await nativeCommand("mobile/background");
    }
  } else if (state.view.type === "stage") go("chapter", state.view.chapterId);
  else if (state.view.type !== "board") go("board");
  else showProjectLibrary(true);
}
function editableLines() {
  return $$(
    '.script-scroll textarea[data-row-field="text"],.script-scroll textarea[data-branch-field="text"]',
  ).filter((element) => {
    const item = element.closest("[data-inspect-item]");
    return element.offsetParent !== null && (!item || item.dataset.inspectItem === state.activeInspectObjectId);
  });
}
function updateAccessory() {
  if (!initialized) return;
  const lines = editableLines(),
    at = lines.indexOf(activeField);
  $("#mobile-keyboard-previous").disabled = at <= 0;
  $("#mobile-keyboard-next").disabled = at < 0 || at >= lines.length - 1;
  $("#mobile-keyboard-add").disabled = at < 0;
}
function focusNeighbour(direction) {
  const lines = editableLines(),
    at = lines.indexOf(activeField),
    next = lines[at + direction];
  if (!next) return;
  next.focus({ preventScroll: true });
  if (!revealInvestigationElement(next)) next.scrollIntoView({ block: "nearest" });
}
async function hideKeyboard() {
  document.activeElement?.blur();
  try {
    await nativeCommand("mobile/hide-keyboard");
  } catch {
    /* A hardware-only window has no IME. */
  }
}
function inputState(detail) {
  const classes = document.documentElement.classList;
  const wasVisible = classes.contains("ime-visible");
  const keyboardVisible = detail.imeVisible === true;
  const viewport = $(".investigation-viewport");
  const camera = state.investigationCameras.get(viewport?.dataset.investigationStage);
  if (keyboardVisible && !wasVisible && camera)
    cameraBeforeKeyboard = { camera, ...camera };
  classes.toggle("ime-visible", keyboardVisible);
  classes.toggle("hardware-keyboard", detail.hardwareKeyboard === true);
  if (!keyboardVisible && wasVisible) {
    const saved = cameraBeforeKeyboard;
    cameraBeforeKeyboard = null;
    if (camera && saved?.camera === camera && saved.scale === camera.scale) {
      camera.x = saved.x;
      camera.y = saved.y;
      viewport.dispatchEvent(new Event("investigation:camera"));
    }
  }
  updateAccessory();
  requestAnimationFrame(() => {
    if (activeField?.isConnected && keyboardVisible && !revealInvestigationElement(activeField))
      activeField.scrollIntoView({ block: "nearest" });
  });
}
function resize() {
  const next = isPhoneLayout();
  if (next !== compact) {
    const focused = document.activeElement;
    const row = focused?.closest("[data-row],[data-branch-row]");
    if (
      next &&
      row &&
      focused?.matches(".expression-wrap input,.action-wrap textarea")
    ) {
      row.classList.add("show-performance");
      row
        .querySelector(".mobile-performance-toggle")
        ?.setAttribute("aria-expanded", "true");
    }
    compact = next;
    syncShell();
    if (
      state.project &&
      state.view.type === "board" &&
      !$("#modal-root").firstChild
    )
      render();
  }
  const active = document.activeElement;
  if (active?.matches("input,textarea,select"))
    requestAnimationFrame(() => {
      if (active.isConnected && !revealInvestigationElement(active))
        active.scrollIntoView({ block: "nearest" });
    });
}
export function initializeMobile() {
  if (!isAndroid || initialized) return;
  initialized = true;
  compact = isPhoneLayout();
  document.documentElement.classList.add("android");
  document.documentElement.classList.toggle("phone-ui", compact);
  document.documentElement.dataset.input =
    navigator.maxTouchPoints > 0 ? "touch" : "mouse";
  shell();
  syncShell();
  document.addEventListener(
    "pointerdown",
    (event) => {
      document.documentElement.dataset.input =
        event.pointerType === "mouse" ? "mouse" : "touch";
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (state.syncBusy) return;
      if (event.isComposing || state.composition || event.keyCode === 229)
        return;
      if (
        document.documentElement.classList.contains("hardware-keyboard") ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        ["Tab", "Escape", "ArrowUp", "ArrowDown", "F10"].includes(event.key)
      )
        document.documentElement.dataset.input = "keyboard";
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        event.stopImmediatePropagation();
        shortcuts();
      }
      if (
        event.shiftKey &&
        event.key === "F10" &&
        !$("#modal-root").firstChild &&
        !event.target.matches("input,textarea,select")
      ) {
        const row = event.target.closest("[data-row],[data-branch-row]");
        if (row) {
          event.preventDefault();
          event.stopImmediatePropagation();
          const id = row.dataset.branchRow || row.dataset.row;
          if (!state.selectedRowIds.has(id)) selectRow(id);
          rowMenu(id, row);
        }
      }
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target.closest(
        "[data-mobile-details],[data-mobile-command]",
      );
      if (target) {
        event.stopImmediatePropagation();
        if (target.dataset.mobileDetails) {
          const row = target.closest("[data-row],[data-branch-row]");
          const expanded = row.classList.toggle("show-performance");
          target.setAttribute("aria-expanded", String(expanded));
        } else if (target.dataset.mobileCommand === "shortcuts") shortcuts();
        else if (target.dataset.mobileCommand === "updates") showUpdates();
      }
      if (event.target.closest('[data-act="clear-rows"]')) selecting = false;
    },
    true,
  );
  document.addEventListener("focusin", (event) => {
    if (
      event.target.matches(
        '.script-scroll textarea[data-row-field="text"],.script-scroll textarea[data-branch-field="text"]',
      )
    ) {
      activeField = event.target;
      updateAccessory();
    }
  });
  document.addEventListener("input", (event) => {
    const row = event.target.closest("[data-row],[data-branch-row]");
    if (row) {
      const value = rowLocation(row.dataset.branchRow || row.dataset.row)?.row;
      const toggle = row.querySelector(".mobile-performance-toggle span");
      if (toggle && value)
        toggle.textContent =
          [value.expression, value.action].filter(Boolean).join(" · ") ||
          "表情与动作";
    }
  });
  document.addEventListener("editor:render", syncShell);
  document.addEventListener("editor:status", syncShell);
  document.addEventListener("editor:library", syncShell);
  document.addEventListener("editor:selection", syncShell);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(state.cacheTimer);
      persist();
    }
  });
  window.addEventListener("pagehide", persist);
  window.addEventListener("resize", resize);
  window.addEventListener("xuxian:input-state", (event) =>
    inputState(event.detail),
  );
  void nativeCommand("mobile/input-state")
    .then(inputState)
    .catch(() => {});
  void onBackButtonPress(back).catch(() =>
    toast("系统返回操作初始化失败", true),
  );
}
