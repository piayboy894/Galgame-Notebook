import { LibraryArchiveService } from "../application/archive-service";
import { isNative, credentialStoreName } from "../platform/runtime";
import { newProject } from "../domain/project.js";
import {
  $,
  $$,
  attr,
  btn,
  esc,
  option,
  state,
  libraryVisible,
} from "./context.js";
import {
  adopt,
  bridgeCall,
  refreshProjectLibrary,
  showProjectLibrary,
  saveSource,
} from "./project-files.js";
import { closeModal, modal } from "./dialogs.js";
import { persist, toast } from "./session.js";

function setBusy(value) {
  state.syncBusy = value;
  $(".app").inert = value || libraryVisible();
  $("#project-library").inert = value;
  $("#modal-root").inert = value;
  document.dispatchEvent(new Event("editor:library"));
}
async function busy(work) {
  if (state.syncBusy) return;
  setBusy(true);
  try {
    return await work();
  } finally {
    setBusy(false);
  }
}
function parseRepository(value) {
  const clean = value
    .trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\.git\/?$/, "")
    .replace(/\/$/, "");
  const match = /^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/.exec(clean);
  if (!match) throw Error("请填写 GitHub 仓库地址或「用户名/仓库名」");
  return { owner: match[1], repo: match[2] };
}
function displayTime(time) {
  return time ? new Date(time).toLocaleString("zh-CN") : "旧版数据";
}

export async function showSyncSettings(library = true, onConnected = null) {
  if (!isNative) return toast("GitHub 云存档请使用叙线应用", true);
  let settings;
  try {
    settings = await bridgeCall("sync/settings", {
      projectId: "",
    });
  } catch (error) {
    return toast(error.message, true);
  }
  const connections = settings.connections || [];
  const initial =
    connections.find((item) => item.id === preferredConnection) ||
    connections[0];
  modal(
    "全局云存档连接",
    `
    <div class="sync-intro"><strong>私有仓库 · 本地优先</strong><p>每个存档包含软件的全部项目，由你手动选择存档、覆盖和整库读取。 同仓库可供其他软件使用，叙线只读写指定数据目录。</p></div>
    ${connections.length ? `<div class="field"><label for="sync-existing">已有连接</label><select class="input" id="sync-existing">${option("", "新连接", initial?.id)}${connections.map((item) => option(item.id, `${item.connection.owner}/${item.connection.repo} · ${item.connection.directory}`, initial?.id)).join("")}</select></div>` : ""}
    <div class="field"><label for="sync-repository">GitHub 私有仓库</label><input class="input" id="sync-repository" placeholder="https://github.com/用户名/xuxian-data" autocomplete="off" autofocus></div>
    <div class="sync-fields"><div class="field"><label for="sync-branch">分支</label><input class="input" id="sync-branch" value="main" autocomplete="off"></div><div class="field"><label for="sync-directory">叙线数据目录</label><input class="input" id="sync-directory" value="xuxian/projects" autocomplete="off"></div></div>
    <div class="field"><label for="sync-token">GitHub Fine-grained Token</label><input class="input" id="sync-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="只在本机 ${credentialStoreName} 保存"><small class="tiny" id="sync-token-hint"></small></div>
    <details class="sync-help"><summary>如何创建和授权令牌</summary><ol><li>创建私有仓库，勾选 README，确认已有 main 分支。</li><li>创建 Fine-grained Token，Resource owner 选仓库所有者。</li><li>Repository access 选择 Only select repositories，仅选数据仓库。</li><li>在 Repository 权限添加 Contents，再将该行设为 Read and write。Account 权限留空。</li><li>令牌只填在此处。换电脑时需在新电脑单独配置令牌。</li></ol><button class="btn small" id="sync-token-page">打开预填授权页</button><p class="tiny">令牌的 GitHub 权限作用于所选仓库，数据目录由叙线约束。共享仓库时，各软件应使用独立目录。</p></details>

    <p id="sync-settings-message" class="sync-message" role="status"></p>

  `,
    btn("取消", null, "modal-close") +
      '<button class="btn primary" id="sync-configure">验证并保存</button>',
  );
  function fill(item) {
    const connection = item?.connection;
    $("#sync-repository").value = connection
      ? connection.owner + "/" + connection.repo
      : "";
    $("#sync-branch").value = connection?.branch || "main";
    $("#sync-directory").value = connection?.directory || "xuxian/projects";
    $("#sync-token").value = "";
    $("#sync-token-hint").textContent = item?.hasToken
      ? "此连接已保存令牌；留空可继续使用，填写新令牌可更新。"
      : "需要数据仓库的 Contents 读写权限；不需要 Actions 或账号权限。";
  }
  fill(initial);
  if ($("#sync-existing"))
    $("#sync-existing").onchange = (event) =>
      fill(connections.find((item) => item.id === event.target.value));
  $("#sync-token-page").onclick = async () => {
    try {
      const { owner } = parseRepository($("#sync-repository").value);
      await bridgeCall("sync/open-token-page", { owner });
    } catch (error) {
      $("#sync-settings-message").textContent = error.message;
    }
  };
  $("#sync-configure").onclick = async () => {
    const input = $("#sync-token");
    try {
      const connection = {
        ...parseRepository($("#sync-repository").value),
        branch: $("#sync-branch").value.trim(),
        directory: $("#sync-directory").value.trim(),
      };
      $("#sync-settings-message").textContent = "正在验证仓库和分支…";
      const configured = await busy(() =>
        bridgeCall("sync/configure", {
          projectId: "",
          connection,
          token: input.value,
        }),
      );
      closeModal();
      preferredConnection = configured.connectionId;
      toast("全局云存档连接已保存");
      if (onConnected) onConnected();
    } catch (error) {
      if ($("#sync-settings-message"))
        $("#sync-settings-message").textContent = error.message;
    } finally {
      input.value = "";
    }
  };
}

let preferredConnection = "";
function libraryClass() {
  $("#modal-root .modal")?.classList.add("archive-modal");
}
function message(error) {
  const label = $("#archive-message");
  if (label) label.textContent = error.message || String(error);
  else toast(error.message || String(error), true);
}
function applyLibrary(result) {
  state.libraryRevision = result.revision;
  state.lastWritingView = null;
  state.restoredDraft = false;
  adopt(newProject(), "", null, false);
  persist();
}
const archiveService = new LibraryArchiveService({
  saveCurrent: async () => (state.dirty ? saveSource() : true),
  saveSlot: (request) => bridgeCall("sync/archive-save", request),
  loadSlot: (request) => bridgeCall("sync/archive-load", request),
  deleteSlot: (request) => bridgeCall("sync/archive-delete", request),
  applyLibrary,
});
function projectSummary(preview) {
  const projects = preview.projects || [];
  return `<div class="archive-summary"><strong>${Number(preview.projectCount)} 个项目 · 整个项目库</strong><ul>${projects
    .slice(0, 100)
    .map(
      (item) =>
        `<li>${esc(String(item.title || "未命名剧本").slice(0, 300))}</li>`,
    )
    .join(
      "",
    )}</ul>${projects.length > 100 ? `<p>另有 ${projects.length - 100} 个项目，也包含在此次整库读取中。</p>` : ""}</div>`;
}

export async function showGitHubProjects() {
  if (!isNative) return toast("云存档请使用叙线应用", true);
  let settings;
  try {
    settings = await bridgeCall("sync/settings", { projectId: "" });
  } catch (error) {
    return toast(error.message, true);
  }
  const connections = settings.connections || [];
  if (!connections.length) return showSyncSettings(true, showGitHubProjects);
  if (!connections.some((item) => item.id === preferredConnection))
    preferredConnection = connections[0].id;
  modal(
    "云存档 · 全部项目",
    `<p class="archive-intro">每个存档保存整个项目库。你自己选择存档、覆盖或读档，不会自动上传、下载或合并。</p><div class="field"><label for="archive-connection">存档位置</label><select class="input" id="archive-connection">${connections.map((item) => option(item.id, `${item.connection.owner}/${item.connection.repo} · ${item.connection.directory}`, preferredConnection)).join("")}</select></div><div class="archive-tools"><button class="btn primary" id="archive-new">＋ 新建云存档</button><button class="btn" id="archive-refresh">刷新</button><button class="btn" id="archive-settings">连接设置</button></div><p id="archive-message" role="status" class="sync-message"></p><div id="archive-slots" class="archive-slots"></div>`,
    btn("关闭", null, "modal-close"),
    true,
  );
  libraryClass();
  $("#archive-new").onclick = () => saveForm();
  $("#archive-settings").onclick = () =>
    showSyncSettings(true, showGitHubProjects);
  async function load() {
    preferredConnection = $("#archive-connection").value;
    $("#archive-message").textContent = "正在读取存档列表…";
    try {
      const result = await busy(() =>
        bridgeCall("sync/archive-list", { connectionId: preferredConnection }),
      );
      const slots = result.slots || [];
      $("#archive-message").textContent = slots.length
        ? `${slots.length} 个云存档`
        : "还没有云存档。点击新建，将软件的全部项目存到一个存档中。";
      $("#archive-slots").innerHTML = slots
        .map(
          (slot, index) =>
            `<button class="archive-slot" data-archive-slot="${index}"><strong>${esc(String(slot.name || "未命名存档").slice(0, 160))}</strong><small>${esc(displayTime(slot.savedAt))} · ${slot.projectCount == null ? "待预览" : Number(slot.projectCount) + " 个项目"}</small>${slot.note ? `<p>${esc(String(slot.note).slice(0, 400))}</p>` : ""}${slot.warning ? `<p>${esc(slot.warning)}</p>` : ""}<span>预览与管理 →</span></button>`,
        )
        .join("");
      $$("[data-archive-slot]").forEach(
        (button) =>
          (button.onclick = () =>
            previewSlot(slots[Number(button.dataset.archiveSlot)].fileName)),
      );
    } catch (error) {
      message(error);
    }
  }
  $("#archive-refresh").onclick = load;
  $("#archive-connection").onchange = load;
  void load();
}
async function previewSlot(fileName) {
  try {
    const preview = await busy(() =>
      bridgeCall("sync/archive-preview", {
        connectionId: preferredConnection,
        fileName,
      }),
    );
    modal(
      String(preview.name || "云存档").slice(0, 160),
      `<p class="tiny">${esc(displayTime(preview.savedAt))}</p>${preview.note ? `<p>${esc(preview.note)}</p>` : ""}${projectSummary(preview)}<p id="archive-message" role="status" class="sync-message"></p>`,
      '<button class="btn" id="archive-back">返回</button>' +
        '<button class="btn" id="archive-overwrite">覆盖存档</button>' +
        '<button class="btn primary" id="archive-load">读取整库</button>' +
        '<button class="btn danger" id="archive-delete">删除存档</button>',
      true,
    );
    libraryClass();
    $("#archive-back").onclick = showGitHubProjects;
    if ($("#archive-overwrite"))
      $("#archive-overwrite").onclick = () => saveForm(preview);
    $("#archive-load").onclick = () => confirmLoad(preview);
    if ($("#archive-delete"))
      $("#archive-delete").onclick = () => confirmDelete(preview);
  } catch (error) {
    message(error);
  }
}
function saveForm(target = null) {
  const name =
    target?.name ||
    `存档 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
  modal(
    target ? "覆盖整库云存档" : "新建整库云存档",
    `<p class="archive-intro">${target ? `将用本机的全部项目覆盖「${esc(target.name)}」。` : "将软件里全部项目保存为一个独立存档。"} 当前未保存的改动会先保存到本机项目库。</p><div class="field"><label for="archive-name">存档名称</label><input id="archive-name" class="input" value="${attr(name)}" maxlength="50" autofocus></div><div class="field"><label for="archive-note">备注（可选）</label><textarea class="input" id="archive-note" rows="3" maxlength="1200" placeholder="例如：第一章完成，准备修改支线">${esc(target?.note || "")}</textarea></div><p class="tiny">每个存档最多 50 MB，仅包含项目文件；不包含授权令牌或软件连接设置。</p><p id="archive-message" role="status" class="sync-message"></p>`,
    '<button class="btn" id="archive-cancel">取消</button><button class="btn primary" id="archive-save">' +
      (target ? "用本机整库覆盖" : "保存全部项目") +
      "</button>",
  );
  libraryClass();
  $("#archive-cancel").onclick = showGitHubProjects;
  $("#archive-save").onclick = async () => {
    const request = {
      connectionId: preferredConnection,
      fileName: target?.fileName || "",
      sha: target?.sha || "",
      name: $("#archive-name").value.trim(),
      note: $("#archive-note").value,
    };
    if (!request.name) return message(Error("请填写存档名称"));
    $("#archive-message").textContent = "正在保存全部项目，请稍候…";
    try {
      const result = await busy(() => archiveService.save(request));
      if (!result) return;
      closeModal();
      await showGitHubProjects();
      toast(`已保存整库云存档，共 ${result.projectCount} 个项目`);
    } catch (error) {
      message(error);
    }
  };
}
function confirmLoad(target) {
  modal(
    "读取整库云存档",
    `<p class="archive-warning">将用此存档的 ${Number(target.projectCount)} 个项目替换本机整个项目库。本机多出的项目不会合并。</p><p>本机项目及未保存改动将被替换，不会先保存，也不保留本机读档备份。软件授权与云端其他存档不受影响。</p>${projectSummary(target)}<p id="archive-message" role="status" class="sync-message"></p>`,
    '<button class="btn" id="archive-load-cancel">取消</button><button class="btn primary" id="archive-load-confirm">直接读取并替换整库</button>',
    true,
  );
  libraryClass();
  $("#archive-load-cancel").onclick = showGitHubProjects;
  $("#archive-load-confirm").onclick = async () => {
    try {
      $("#archive-message").textContent = "正在校验并读取整库…";
      const result = await busy(() =>
        archiveService.load({
          connectionId: preferredConnection,
          fileName: target.fileName,
          sha: target.sha,
        }),
      );
      if (!result) return;
      closeModal();
      await showProjectLibrary(true);
      await refreshProjectLibrary();
      toast(
        result.cleanupPending
          ? `已读取整库，共 ${result.projectCount} 个项目；旧文件清理未完成，请重启软件`
          : `已读取整库，共 ${result.projectCount} 个项目`,
      );
    } catch (error) {
      message(error);
    }
  };
}
function confirmDelete(target) {
  modal(
    "删除这个云存档？",
    `<p>删除「${esc(target.name)}」及其索引，不影响本机项目和其他云存档。</p><p id="archive-message" role="status" class="sync-message"></p>`,
    '<button class="btn" id="archive-delete-cancel">取消</button><button class="btn danger" id="archive-delete-confirm">删除此云存档</button>',
  );
  $("#archive-delete-cancel").onclick = showGitHubProjects;
  $("#archive-delete-confirm").onclick = async () => {
    try {
      await busy(() =>
        archiveService.delete({
          connectionId: preferredConnection,
          fileName: target.fileName,
          sha: target.sha,
        }),
      );
      closeModal();
      await showGitHubProjects();
      toast("已删除选中的云存档");
    } catch (error) {
      message(error);
    }
  };
}
