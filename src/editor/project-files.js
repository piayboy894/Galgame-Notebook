import { investigationIndex, matchesInheritedInvestigationScript } from "../domain/investigation-inheritance.js";
import { isInvestigationPresent, presentInvestigationItems } from "../domain/investigation-world.js";
import { investigationStageLabel } from "./investigation-world.js";
import { planReadableInvestigation } from "../domain/readable-investigation.js";
import { encyclopediaParts, wrappedEncyclopediaLinks } from "../domain/encyclopedia.js";
import {
  dialogueMarkdown,
  applyDialogueWrap,
  normalizeDialogueSettings,
  wrapDialogue,
  dialogueWrapChanges,
} from "../domain/dialogue.js";
import { effectiveLocation, LOCATION_FIELDS } from "../domain/scenes.js";
import { investigationScripts } from "../domain/investigation.js";
import { describeInvestigationRule, describeInvestigationOutcomes } from "./investigation-editor.js";
import {
  nativeCommand,
  isNative,
  isAndroid,
  projectStorageName,
} from "../platform/runtime";
import { flattenRows, normalizeProject, newProject } from "../domain/project.js";
import { clone, uid, now } from "../domain/primitives.js";
import {
  mutate,
  persist,
  render,
  ruleTitle,
  toast,
  updateTop,
} from "./session.js";
import {
  $,
  $$,
  BRIDGE,
  C,
  HANDLE_DB,
  P,
  R,
  S,
  currentChapter,
  option,
  attr,
  btn,
  esc,
  ico,
  inspectLocation,
  inspectName,
  routeChapters,
  state,
} from "./context.js";
import {
  closeMenu,
  closeModal,
  confirmBox,
  guardReplace,
  menu,
  modal,
  newDialog,
} from "./dialogs.js";

export async function importLegacyProjects() {
  try {
    const result = await bridgeCall("projects/import-folder");
    if (result.cancelled) return;
    await refreshProjectLibrary();
    toast(
      "已导入 " +
        result.imported +
        " 个项目，跳过 " +
        result.skipped +
        " 个重复或无效文件",
    );
  } catch (e) {
    toast("导入失败：" + e.message, true);
  }
}

export // Strictly copy known fields: imported JSON never becomes executable HTML or code.
// IndexedDB stores native handles, not the text of the source. Unavailable on some file:// origins.
function handleStore(mode, work) {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }
    let req;
    try {
      req = indexedDB.open(HANDLE_DB, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("source"))
        req.result.createObjectStore("source");
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction("source", mode),
          st = tx.objectStore("source");
        const op = work(st);
        op.onsuccess = () => resolve(op.result);
        op.onerror = () => reject(op.error);
        tx.oncomplete = () => db.close();
        tx.onabort = () => db.close();
      } catch (e) {
        db.close();
        reject(e);
      }
    };
  });
}

export async function rememberHandle() {
  if (!state.fileHandle) return;
  try {
    await handleStore("readwrite", (st) =>
      st.put(
        {
          handle: state.fileHandle,
          name: state.sourceName,
          stamp: state.fileStamp,
        },
        state.project.id,
      ),
    );
  } catch (e) {
    /* No storage permission: keep handle until this tab closes. */
  }
}

export async function restoreHandle() {
  if (BRIDGE || !state.sourceName) return;
  const refId = state.project.id,
    refName = state.sourceName;
  try {
    const item = await handleStore("readonly", (st) => st.get(refId));
    if (
      item?.handle?.kind === "file" &&
      item.name === refName &&
      state.project.id === refId &&
      state.sourceName === refName &&
      !state.fileHandle &&
      !state.bridgeBinding
    ) {
      state.fileHandle = item.handle;
      state.fileStamp = item.stamp || null;
      updateTop();
    }
  } catch (e) {
    /* Reopen the file when the browser cannot remember handles. */
  }
}

export async function bridgeCall(endpoint, data = {}) {
  return nativeCommand(endpoint, data);
}

export function showProjectLibrary(asRoot = false) {
  state.libraryAtRoot = asRoot === true;
  if (!BRIDGE) $("#library-folder").classList.add("hidden");
  $("#library-close").classList.toggle(
    "hidden",
    state.libraryOnly ||
      (!state.sourceName &&
        !state.bridgeBinding &&
        !state.fileHandle &&
        !state.dirty &&
        !state.restoredDraft),
  );
  closeMenu();
  $("#project-library").classList.remove("hidden");
  $(".app").inert = true;
  $("#library-close").title = state.dirty ? "返回未保存的草稿" : "返回编辑器";
  document.dispatchEvent(new Event("editor:library"));
  return refreshProjectLibrary();
}

export function closeProjectLibrary() {
  if (state.libraryOnly) return;
  state.libraryAtRoot = false;
  $("#project-library").classList.add("hidden");
  $(".app").inert = false;
  document.dispatchEvent(new Event("editor:library"));
}

export function renderProjectLibrary() {
  const box = $("#library-grid"),
    counter = $("#library-count"),
    status = $("#library-status");
  if (!BRIDGE) {
    counter.textContent = "";
    box.innerHTML = `<button class="library-new" id="library-standalone-open">${ico("folder")} 打开 JSON</button><button class="library-new" id="library-standalone-new">${ico("plus")} 新建剧本</button>`;
    status.textContent = "当前为浏览器预览。桌面版支持本地项目库与一键更新。";
    $("#library-standalone-open").onclick = () => openStandaloneSource();
    $("#library-standalone-new").onclick = newDialog;
    return;
  }
  counter.textContent = state.libraryItems.length
    ? `${state.libraryItems.length} 个项目`
    : "";
  status.textContent = state.libraryBusy ? "读取中…" : projectStorageName;
  box.innerHTML =
    state.libraryItems
      .map(
        (
          p,
          i,
        ) => `<article class="library-card" data-project-file="${attr(p.fileName)}">
   <button class="library-open" data-library-open="${i}" title="打开 ${attr(p.title)}"><span class="library-title">${esc(p.title || "未命名剧本")}</span><span class="library-file">${esc(p.fileName)}</span></button>
   <div class="library-actions"><button class="icon-btn" title="项目操作" aria-label="${attr(p.title)} 的操作" data-library-more="${i}">${ico("dots")}</button></div>
   <div class="library-meta"><span>${Number(p.routes || 0)} 路线 · ${Number(p.chapters || 0)} 章节</span><span>${p.modified ? new Date(Number(p.modified)).toLocaleDateString("zh-CN") : ""}</span></div>
 </article>`,
      )
      .join("") +
    `<button class="library-new" id="library-new-card">${ico("plus")} 新建项目</button>`;
  $("#library-new-card").onclick = newHubDialog;
  $$("[data-library-open]").forEach(
    (b) =>
      (b.onclick = () =>
        openManagedProject(
          state.libraryItems[+b.dataset.libraryOpen].fileName,
        )),
  );
  $$("[data-library-more]").forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        const p = state.libraryItems[+b.dataset.libraryMore];
        menu(b, [
          {
            label: "打开",
            icon: "folder",
            click: () => openManagedProject(p.fileName),
          },
          {
            label: "复制项目",
            icon: "copy",
            click: () => duplicateManagedProject(p.fileName),
          },
          {
            label: "重命名",
            icon: "edit",
            click: () => renameManagedProject(p),
          },
          null,
          {
            label: "删除项目",
            icon: "trash",
            danger: true,
            click: () => deleteManagedProject(p),
          },
        ]);
      }),
  );
}

export async function refreshProjectLibrary() {
  if (!BRIDGE) {
    renderProjectLibrary();
    return;
  }
  if (state.libraryBusy) return;
  state.libraryBusy = true;
  try {
    const d = await bridgeCall("projects/list");
    state.libraryItems = Array.isArray(d.items) ? d.items : [];
    renderProjectLibrary();
  } catch (e) {
    $("#library-grid").innerHTML =
      `<div class="library-empty">无法读取项目文件夹 <small>${esc(e.message)}</small></div>`;
    toast("项目列表读取失败：" + e.message, true);
  } finally {
    state.libraryBusy = false;
    $("#library-status").textContent = projectStorageName;
  }
}

export function managedAction(action) {
  return async () => {
    try {
      await action();
      await refreshProjectLibrary();
    } catch (e) {
      toast(e.message || "项目操作失败", true);
    }
  };
}

export function openManagedProject(fileName) {
  const proceed = async () => {
    try {
      const d = await bridgeCall("projects/open", { fileName });
      const p = normalizeProject(JSON.parse(d.text.replace(/^\uFEFF/, "")));
      adopt(p, d.name, null, false, d.stamp, d.bindingId);
      toast("已打开 " + p.title);
    } catch (e) {
      toast("打开失败：" + e.message, true);
    }
  };
  guardReplace(proceed);
}

export function newHubDialog() {
  modal(
    "新建项目",
    `<div class="field"><label>项目名称</label><input class="input" id="library-new-name" value="未命名剧本" maxlength="200" autofocus></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="library-new-submit">创建</button>',
  );
  const create = () => {
    const title = $("#library-new-name")?.value.trim();
    if (!title) return toast("请输入项目名称", true);
    closeModal();
    const run = async () => {
      try {
        if (BRIDGE) {
          const p = newProject(title),
            d = await bridgeCall("projects/create", {
              text: JSON.stringify(p, null, 2),
            });
          adopt(
            normalizeProject(JSON.parse(d.text)),
            d.name,
            null,
            false,
            d.stamp,
            d.bindingId,
          );
        } else adopt(newProject(title), "", null, true);
        toast("已创建 " + title);
      } catch (e) {
        toast("创建失败：" + e.message, true);
      }
    };
    guardReplace(run);
  };
  $("#library-new-submit").onclick = create;
  $("#library-new-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      create();
    }
  });
}

export async function duplicateManagedProject(fileName) {
  try {
    await bridgeCall("projects/duplicate", { fileName });
    await refreshProjectLibrary();
    toast("已复制项目");
  } catch (e) {
    toast("复制失败：" + e.message, true);
  }
}

export function renameManagedProject(p) {
  modal(
    "重命名项目",
    `<div class="field"><label>项目名称</label><input class="input" id="library-rename-name" value="${attr(p.title)}" maxlength="200" autofocus></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="library-rename-submit">保存</button>',
  );
  $("#library-rename-submit").onclick = () => {
    const title = $("#library-rename-name").value.trim();
    if (!title) return toast("请输入项目名称", true);
    closeModal();
    const run = async () => {
      try {
        const d = await bridgeCall("projects/rename", {
          fileName: p.fileName,
          title,
        });
        if (state.sourceName === p.fileName) {
          adopt(
            normalizeProject(JSON.parse(d.text)),
            d.name,
            null,
            false,
            d.stamp,
            d.bindingId,
          );
          showProjectLibrary();
        } else await refreshProjectLibrary();
        toast("已重命名");
      } catch (e) {
        toast("重命名失败：" + e.message, true);
      }
    };
    if (state.sourceName === p.fileName) guardReplace(run);
    else run();
  };
}

export function deleteManagedProject(p) {
  confirmBox(
    "删除项目",
    `将「${p.title}」移入「剧本项目/_回收站」，不会直接永久删除。`,
    async () => {
      try {
        if (state.dirty && state.sourceName === p.fileName) {
          toast("当前项目有未保存的改动，请先保存或返回项目列表", true);
          return;
        }
        await bridgeCall("projects/delete", { fileName: p.fileName });
        if (state.sourceName === p.fileName) {
          adopt(newProject(), "", null, false);
          showProjectLibrary();
        } else await refreshProjectLibrary();
        toast("已移入回收站");
      } catch (e) {
        toast("删除失败：" + e.message, true);
      }
    },
    true,
  );
}

export async function importSourceAction() {
  if (isAndroid) {
    try {
      const result = await nativeCommand("mobile/import");
      if (result.cancelled) return;
      await importSelectedSource(
        new File([result.text], result.name || "剧本.story.json", {
          type: "application/json",
        }),
      );
    } catch (error) {
      toast("导入失败：" + error.message, true);
    }
    return;
  }
  if (BRIDGE || !window.showOpenFilePicker) {
    $("#file-input").click();
  } else openStandaloneSource();
}

export async function importSelectedSource(file) {
  if (!BRIDGE) {
    await loadFile(file);
    return;
  }
  try {
    if (file.size > 25 * 1024 * 1024) throw Error("文件不能超过 25 MB");
    const raw = await file.text();
    const p = normalizeProject(JSON.parse(raw.replace(/^\uFEFF/, "")));
    const run = async () => {
      try {
        const d = await bridgeCall("projects/create", {
          text: JSON.stringify(p, null, 2),
        });
        adopt(
          normalizeProject(JSON.parse(d.text)),
          d.name,
          null,
          false,
          d.stamp,
          d.bindingId,
        );
        toast("已导入 " + p.title);
      } catch (e) {
        toast("导入失败：" + e.message, true);
      }
    };
    guardReplace(run);
  } catch (e) {
    toast("导入失败：" + e.message, true);
  }
}

export function adopt(
  p,
  name = "",
  handle = null,
  isNew = false,
  stamp = null,
  binding = null,
  libraryOnly = false,
) {
  $("#project-library")?.classList.add("hidden");
  $(".app").inert = false;
  state.collapsedOptionIds.clear();
  state.collapsedGroupIds.clear();
  state.investigationCameras.clear();
  state.expandedInvestigationItems.clear();
  state.investigationScriptsByItem.clear();
  state.activeInspectObjectId = null;
  state.selectedInvestigationCardIds.clear();
  state.project = p;
  state.libraryOnly = libraryOnly;
  state.sourceName = name;
  state.fileHandle = handle;
  state.fileStamp = stamp;
  state.bridgeBinding = binding;
  state.history = [];
  state.future = [];
  state.lastEdit = "";
  state.dirty = isNew;
  state.exported = false;
  state.view = { type: "board" };
  state.zoom = 1;
  state.boardScroll = { x: 0, y: 0 };
  state.boardPresentation = "auto";
  state.connectFrom = null;
  state.sim = {
    active: false,
    chapters: new Set(),
    stages: new Set(),
    flags: new Set(),
  };
  closeModal();
  render();
  persist();
  if (handle) rememberHandle();
}

export function loadText(txt, name, handle, stamp, binding = null) {
  try {
    if (txt.length > 25 * 1024 * 1024)
      throw Error("文件超过 25 MB，请使用拆分后的剧本");
    const p = normalizeProject(JSON.parse(txt.replace(/^\uFEFF/, "")));
    guardReplace(() => {
      adopt(p, name, handle, false, stamp, binding);
      toast("已打开 " + name);
    });
  } catch (e) {
    toast(
      e instanceof SyntaxError
        ? "无法读取：JSON 格式错误"
        : e.message || "无法读取此文件",
      true,
    );
  }
}

export async function loadFile(file, handle = null) {
  try {
    if (file.size > 25 * 1024 * 1024)
      throw Error("文件超过 25 MB，请使用拆分后的剧本");
    loadText(await file.text(), file.name, handle, {
      size: file.size,
      lastModified: file.lastModified,
    });
  } catch (e) {
    toast(e.message || "无法读取此文件", true);
  }
}

export async function openSource() {
  return showProjectLibrary();
}

export async function openStandaloneSource() {
  if (typeof window.showOpenFilePicker === "function") {
    try {
      const [handle] = await window.showOpenFilePicker({
        id: "xuxian-source",
        multiple: false,
        types: [
          {
            description: "叙线剧本源文件",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      if (handle) {
        const f = await handle.getFile();
        await loadFile(f, handle);
      }
      return;
    } catch (e) {
      if (e.name === "AbortError") return;
      toast("无法关联文件写入权限，将使用普通导入", true);
    }
  }
  $("#file-input").click();
}

export function fileName() {
  return (
    (state.project.title || "未命名剧本")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 120) + ".story.json"
  );
}

export async function downloadText(text, name, type = "application/json") {
  if (isNative) {
    try {
      const r = await nativeCommand("export", { name, text });
      return !r.cancelled;
    } catch (e) {
      toast("导出失败：" + e.message, true);
      return false;
    }
  }
  const blob = new Blob([text], { type: type + ";charset=utf-8" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

export async function downloadSource() {
  const name = state.sourceName || fileName(),
    text = JSON.stringify(state.project, null, 2);
  if (!(await downloadText(text, name))) return false;
  state.dirty = false;
  state.exported = true;
  persist();
  toast("已下载源文件副本（未覆盖磁盘原件）");
  return true;
}

export function fileConflict() {
  modal(
    "源文件已改变",
    '<div class="help"><p>磁盘上的 JSON 在上次打开或保存之后发生过修改。直接覆盖会替换这些外部改动。</p></div>',
    btn("取消", null, "modal-close") +
      '<button class="btn" id="conflict-copy">另存</button><button class="btn danger" id="conflict-write">覆盖原文件</button>',
  );
  $("#conflict-copy").onclick = () => {
    closeModal();
    saveSource(true);
  };
  $("#conflict-write").onclick = () => {
    closeModal();
    saveSource(false, true);
  };
}

export function cannotWriteDialog() {
  modal(
    "当前浏览器不能直接写回",
    `<div class="help"><p>Firefox 的普通 HTML 页面无法覆盖磁盘上的 JSON。</p><p>Windows 可使用压缩包里的「启动叙线.cmd」，然后正常打开、保存；也可以用 Chrome / Edge 打开 HTML。</p></div>`,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="download-fallback">下载副本</button>',
  );
  $("#download-fallback").onclick = () => {
    closeModal();
    downloadSource();
  };
}

export async function chooseLinkForExisting() {
  const [h] = await window.showOpenFilePicker({
    id: "xuxian-source",
    multiple: false,
    types: [
      {
        description: "叙线剧本源文件",
        accept: { "application/json": [".json"] },
      },
    ],
  });
  if (!h) return null;
  const f = await h.getFile();
  let other;
  try {
    other = normalizeProject(
      JSON.parse((await f.text()).replace(/^\uFEFF/, "")),
    );
  } catch (e) {
    throw Error("所选 JSON 不是有效的叙线源文件");
  }
  if (other.id !== state.project.id)
    throw Error("所选文件属于另一份剧本，请选择原 JSON 或使用「另存」");
  const previous = state.fileStamp;
  state.fileHandle = h;
  state.sourceName = h.name;
  state.fileStamp = { size: f.size, lastModified: f.lastModified };
  if (
    previous &&
    (previous.size !== state.fileStamp.size ||
      previous.lastModified !== state.fileStamp.lastModified)
  )
    return "conflict";
  return h;
}

export async function revealSource() {
  if (!state.bridgeBinding)
    return toast("当前是未保存草稿，请先保存源文件", true);
  try {
    await bridgeCall("projects/reveal-source", {
      bindingId: state.bridgeBinding,
    });
  } catch (error) {
    toast("无法打开源文件位置：" + error.message, true);
  }
}

export async function saveSource(asNew = false, force = false) {
  if (state.libraryOnly) {
    toast("请先打开一个项目", true);
    return false;
  }
  if (state.saving || state.composition) return false;
  const changes = dialogueWrapChanges(state.project);
  if (changes.length)
    mutate(() => {
      for (const { row, text } of changes) applyDialogueWrap(row, text);
    });
  state.saving = true;
  $("#save-btn").disabled = true;
  try {
    const snapshot = JSON.stringify(state.project, null, 2);
    if (BRIDGE) {
      let result,
        created = null;
      try {
        if (asNew) {
          created = clone(state.project);
          created.id = uid("project");
          created.title += " 副本";
          created.createdAt = now();
          created.updatedAt = now();
          result = await bridgeCall("projects/create", {
            text: JSON.stringify(created, null, 2),
          });
        } else if (!state.bridgeBinding) {
          result = await bridgeCall("projects/create", { text: snapshot });
        } else
          result = await bridgeCall("save", {
            text: snapshot,
            bindingId: state.bridgeBinding,
            stamp: state.fileStamp,
            force,
          });
      } catch (e) {
        if (e.status === 409) {
          fileConflict();
          return false;
        }
        throw e;
      }
      if (result.cancelled) return false;
      if (created) {
        adopt(
          normalizeProject(JSON.parse(result.text)),
          result.name,
          null,
          false,
          result.stamp,
          result.bindingId,
        );
      } else {
        state.bridgeBinding = result.bindingId;
        state.fileHandle = null;
        state.sourceName = result.name;
        state.fileStamp = result.stamp;
        state.dirty = JSON.stringify(state.project, null, 2) !== snapshot;
        state.exported = false;
        persist();
      }
      toast((asNew ? "已另存 " : "已写回 ") + state.sourceName);
      return true;
    }
    let h = asNew ? null : state.fileHandle;
    if (
      !h &&
      !asNew &&
      state.sourceName &&
      typeof window.showOpenFilePicker === "function"
    ) {
      const selected = await chooseLinkForExisting();
      if (selected === "conflict") {
        fileConflict();
        return false;
      }
      h = selected;
    }
    if (!h) {
      if (typeof window.showSaveFilePicker === "function") {
        h = await window.showSaveFilePicker({
          id: "xuxian-source",
          suggestedName: state.sourceName || fileName(),
          types: [
            {
              description: "叙线剧本源文件",
              accept: { "application/json": [".json"] },
            },
          ],
        });
      } else {
        cannotWriteDialog();
        return false;
      }
    }
    if (!h) return false;
    if (h === state.fileHandle && state.fileStamp && !force) {
      const f = await h.getFile();
      if (
        f.lastModified !== state.fileStamp.lastModified ||
        f.size !== state.fileStamp.size
      ) {
        fileConflict();
        return false;
      }
    }
    const stream = await h.createWritable();
    try {
      await stream.write(snapshot);
      await stream.close();
    } catch (e) {
      try {
        await stream.abort();
      } catch (_) {}
      throw e;
    }
    state.fileHandle = h;
    state.sourceName = h.name;
    const f = await h.getFile();
    state.fileStamp = { size: f.size, lastModified: f.lastModified };
    state.dirty = JSON.stringify(state.project, null, 2) !== snapshot;
    state.exported = false;
    persist();
    rememberHandle();
    toast("已写回 " + state.sourceName);
    return true;
  } catch (e) {
    if (e.name === "AbortError") return false;
    toast("保存未完成：" + (e.message || "文件不可写"), true);
    return false;
  } finally {
    state.saving = false;
    $("#save-btn").disabled = false;
    updateTop();
  }
}

function encyclopediaMarkdown(row, indent) {
  const limit = normalizeDialogueSettings(state.project.settings).dialogueLineLength;
  if (!row.encyclopediaLinks?.length) return dialogueMarkdown(row.text, limit, indent);
  const text = wrapDialogue(row.text, limit);
  const links = wrappedEncyclopediaLinks(row.encyclopediaLinks, row.text, text);
  const markup = encyclopediaParts(text, links).map(({ text, entryId }) => {
    if (!entryId) return text;
    return text.split("\n").map((line) =>
      line ? "[" + line.replace(/[\\[\]]/g, "\\$&") + "](#encyclopedia-" + entryId + ")" : "",
    ).join("\n");
  }).join("");
  return dialogueMarkdown(markup, 0, indent);
}

export function appendMarkdownRows(out, rows, indent = "") {
  for (const row of rows) {
    if (row.type === "group") {
      const location = effectiveLocation(row, state.project.locations);
      out.push(indent + "〔场景组〕" + row.title, "");
      if (location.name) out.push(indent + "地点：" + location.name, "");
      for (const field of LOCATION_FIELDS)
        if (location[field.key] || Object.hasOwn(row.overrides, field.key))
          out.push(
            indent + field.label + "：" + (location[field.key] || "无"),
            "",
          );
      for (const property of location.properties)
        out.push(indent + property.name + "：" + property.value, "");
      if (row.notes) out.push(indent + "备注：" + row.notes, "");
      appendMarkdownRows(out, row.rows, indent);
      continue;
    }

    if (row.type === "note") {
      out.push(indent + "〔笔记〕" + row.text, "");
      continue;
    }
    if (row.type === "effect") {
      out.push(indent + "〔画面效果〕" + row.text, "");
      continue;
    }
    if (row.type === "branch") {
      out.push(indent + "〔选项〕" + row.text, "");
      for (const op of row.options) {
        out.push(indent + "- **" + op.text + "**", "");
        appendMarkdownRows(out, op.rows || [], indent + "    ");
        out.push(
          indent +
            (op.mode === "jump"
              ? "↳ 跳转：" +
                chapterDestination(op.chapterId, op.stageId)
              : "↳ 合流，继续下一行"),
          "",
        );
      }
      continue;
    }
    out.push(
      indent +
        "**" +
        (P(row.speakerId)?.name || "旁白") +
        "**" +
        ([row.expression, row.action].some(Boolean)
          ? " 〔" +
            [row.expression, row.action].filter(Boolean).join(" · ") +
            "〕"
          : "") +
        "  ",
      encyclopediaMarkdown(row, indent),
      "",
    );
  }
}

function chapterDestination(chapterId, stageId) {
  const chapter = C(chapterId);
  return [R(chapter?.routeId)?.name, chapter?.title || "未设置章节",
    stageId ? S(stageId)?.stage.title || "未设置阶段" : "章节起始"].filter(Boolean).join(" / ");
}

export function markdownScopeDialog() {
  const chapterId = currentChapter()?.id;
  modal(
    "按范围导出可读剧本",
    `<div class="field"><label for="markdown-scope">导出范围</label><select id="markdown-scope" class="input" autofocus>
      ${option("", "整个项目", chapterId ? null : "")}
      ${state.project.routes.map((route) => `<optgroup label="${attr(route.name)}">
        ${option("route:" + route.id, "整条路线 · " + route.name)}
        ${routeChapters(route.id).map((chapter) => option("chapter:" + chapter.id, chapter.title, "chapter:" + chapterId)).join("")}
      </optgroup>`).join("")}</select></div>
    <p class="investigation-form-help">部分导出会写入所选范围内实际生效的对白。指向范围外的分支仍保留完整去向。</p>`,
    btn("取消", null, "modal-close") + '<button class="btn primary" id="markdown-scope-export">导出 Markdown</button>',
  );
  $("#markdown-scope-export").onclick = () => {
    const [type, id] = $("#markdown-scope").value.split(":");
    closeModal();
    exportMarkdown(type ? { type, id } : null);
  };
}

export async function exportMarkdown(scope = null) {
  const chapterGroups = state.project.routes.map((route) => ({
    route,
    chapters: routeChapters(route.id).filter((chapter) => !scope ||
      (scope.type === "route" ? route.id === scope.id : chapter.id === scope.id)),
  })).filter(({ chapters }) => chapters.length);
  const chapters = chapterGroups.flatMap(({ chapters }) => chapters);
  const stages = chapters.flatMap((chapter) => chapter.stages);
  const investigations = stages.filter((stage) => stage.kind === "investigation");
  const worldIndex = investigationIndex(state.project);
  const includedStages = new Set(investigations.map((stage) => stage.id));
  const compact = new Set();
  const readableRows = (stage) => stage.kind === "investigation"
    ? presentInvestigationItems(stage).flatMap(investigationScripts).flatMap((script) => script.rows)
    : stage.rows;
  for (const stage of investigations) {
    const active = presentInvestigationItems(stage);
    const source = worldIndex.stages.get(stage.worldSourceId)?.stage;
    if (!source || !includedStages.has(source.id)) continue;
    const originals = presentInvestigationItems(source);
    for (const item of active) {
      if (!item.world?.from || item.inheritance?.sourceId !== item.world.from) continue;
      const prior = worldIndex.placements.get(item.world.from);
      if (prior?.stage !== source || !isInvestigationPresent(prior.item)) continue;
      const name = inspectName(item);
      if (active.filter((card) => inspectName(card) === name).length !== 1 ||
          originals.filter((card) => inspectName(card) === name).length !== 1) continue;
      if (item.notes === prior.item.notes && item.locationId === prior.item.locationId &&
          matchesInheritedInvestigationScript(worldIndex, item)) compact.add(item.id);
    }
  }
  const rows = flattenRows(stages.flatMap(readableRows));
  const scoped = Boolean(scope);
  const usedSpeakers = new Set([
    ...rows.map((row) => row.speakerId),
    ...investigations.flatMap((stage) => presentInvestigationItems(stage).map((item) => item.characterId)),
  ]);
  const usedTerms = new Set(rows.flatMap((row) => (row.encyclopediaLinks || []).map((link) => link.entryId)));
  const plan = planReadableInvestigation(investigations, (row) => {
    const lines = [];
    appendMarkdownRows(lines, [row]);
    return lines.join("\n").trimEnd();
  }, compact);
  const scopeName = scope?.type === "route" ? R(scope.id)?.name : C(scope?.id)?.title;
  const out = ["# " + state.project.title, ""];
  if (scopeName) out.push("> 范围 · " + scopeName, "");
  if (plan.hasReferences)
    out.push("> 「沿用」按所指脚本的条目顺序展开，之后继续阅读本段。", "");
  if (investigations.some((stage) => stage.worldSourceId))
    out.push("> 延续阶段保留调查次数和已达成条件。新对象或重置对象从第 1 次开始。", "");
  if (investigations.some((stage) => presentInvestigationItems(stage).some((item) => item.interactions.length)))
    out.push("> 按顺序使用首条命中的规则，否则使用启用的默认脚本。成功交互才计次。", "");
  const characters = state.project.characters.filter((p) => p.notes && (!scoped || usedSpeakers.has(p.id)));
  if (characters.length) {
    out.push("## 角色", "");
    for (const p of characters) out.push("### " + p.name, p.notes, "");
  }
  const usedFlags = new Set(chapters.flatMap((chapter) => chapter.unlock.rules
    .filter((rule) => rule.type === "flag").map((rule) => rule.targetId)));
  for (const stage of stages)
    if (stage.kind === "investigation")
      for (const script of presentInvestigationItems(stage).flatMap(investigationScripts)) {
        for (const outcome of script.outcomes) usedFlags.add(outcome);
        for (const condition of script.conditions || [])
          if (condition.type === "flag") usedFlags.add(condition.targetId);
      }
  const flags = state.project.flags.filter((flag) => flag.notes && usedFlags.has(flag.id));
  if (flags.length) {
    out.push("## 条件说明", "");
    for (const flag of flags) out.push("- **" + flag.name + "** " + flag.notes);
    out.push("");
  }
  for (const { route, chapters } of chapterGroups) {
    out.push("## " + route.name, "");    for (const c of chapters) {
      out.push("### " + c.title, "");
      if (c.ending !== "continue")
        out.push(
          "收束：" + (c.ending === "pause" ? "未完待续" : "路线结局"),
          "",
        );
      if (c.unlock.rules.length)
        out.push(
          "解锁（" +
            (c.unlock.mode === "all" ? "全部满足" : "任一满足") +
            "）：",
          ...c.unlock.rules.map(
            (rule) =>
              "- " +
              ruleTitle(rule) +
              (rule.type === "flag"
                ? rule.expected === false
                  ? "：未达成"
                  : "：已达成"
                : "：已完成"),
          ),
          "",
        );
      if (c.summary) out.push(c.summary, "");
      for (const st of c.stages) {
        out.push(
          "#### " +
            st.title +
            " [" +
            (st.kind === "investigation" ? st.worldSourceId ? "调查" : "独立调查" : "剧情") +
            "]",
          "",
        );
        if (st.notes) out.push("> " + st.notes.replace(/\n/g, "\n> "), "");
        if (st.kind === "investigation") {
          const active = presentInvestigationItems(st);
          const source = worldIndex.stages.get(st.worldSourceId);
          const list = (items) => items.map(inspectName).join("、") || "无";
          const away = st.objects.filter((item) => !isInvestigationPresent(item));
          const resets = active.filter((item) => item.world?.resetVisits);
          const short = active.filter((item) => compact.has(item.id));
          const newItems = active.filter((item) => !item.world?.from);
          if (source) out.push("- 延续「" + investigationStageLabel(source) + "」", "- 本阶段在场：" + list(active));
          if (away.length) out.push("- 本阶段离场：" + list(away));
          if (source && newItems.length) out.push("- 本阶段新出现：" + list(newItems));
          if (source && resets.length) out.push("- 本阶段重置调查次数：" + list(resets));
          if (short.length) out.push("- 沿用来源的地点和交互：" + list(short));
          if (source || away.length) out.push("");
          for (const item of active) {
            if (compact.has(item.id)) continue;
            out.push("##### " + inspectName(item) + (item.characterId || item.temporaryCharacter ? " [人物]" : " [物品]"), "");
            const location = inspectLocation(item);
            if (location) out.push("地点：" + location, "");
            if (item.notes) out.push("> " + item.notes.replace(/\n/g, "\n> "), "");
            for (const script of investigationScripts(item)) {
              if (item.interactions.length || !item.fallbackEnabled) {
                out.push("###### " + (script === item ? (item.fallbackEnabled ? "默认脚本" : "默认脚本（已停用）") : script.name), "");
                if (script !== item) out.push("触发：" + describeInvestigationRule(st, script, worldIndex), "");
              }
              const outcome = describeInvestigationOutcomes(script);
              if (outcome) out.push("完成后达成：" + outcome, "");
              const text = plan.render(item, script);
              if (text) out.push(text, "");
            }
          }
        } else appendMarkdownRows(out, st.rows);
      }
    }
  }
  const encyclopedia = state.project.encyclopedia.filter((entry) => !scoped || usedTerms.has(entry.id));
  if (encyclopedia.length) {
    out.push("## 百科", "");
    for (const { id, title, body } of encyclopedia)
      out.push('<a id="encyclopedia-' + id + '"></a>', "", "### " + title, "", body, "");
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n");
  const suffix = scopeName ? " - " + scopeName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 70) : "";
  if (await downloadText(text, fileName().replace(/\.story\.json$/, suffix + ".md"), "text/markdown")) {
    const size = new Blob([text]).size;
    toast(`已导出可读剧本 · ${size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB"}`);
  }
}
