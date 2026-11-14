import { GitHubSyncService } from "../application/sync-service";
import { isNative, credentialStoreName } from "../platform/runtime";
import { normalizeProject } from "../domain/project.js";
import { $, $$, attr, btn, esc, option, state } from "./context.js";
import {
  adopt,
  bridgeCall,
  refreshProjectLibrary,
  saveSource,
} from "./project-files.js";
import { closeModal, guardReplace, modal } from "./dialogs.js";
import { persist, toast, updateTop } from "./session.js";

function setBusy(value) {
  state.syncBusy = value;
  $(".app").inert = value;
  $("#project-library").inert = value;
  $("#modal-root").inert = value;
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
  return time ? new Date(time).toLocaleString("zh-CN") : "尚未同步";
}

export async function showSyncSettings(library = false, onConnected = null) {
  if (!isNative) return toast("GitHub 同步请使用叙线应用", true);
  let settings;
  try {
    settings = await bridgeCall("sync/settings", {
      projectId: library ? "" : state.project.id,
    });
  } catch (error) {
    return toast(error.message, true);
  }
  const connections = settings.connections || [];
  const initial =
    connections.find((item) => item.id === settings.linked?.connectionId) ||
    connections[0];
  modal(
    library ? "添加 GitHub 数据连接" : "GitHub 同步设置",
    `
    <div class="sync-intro"><strong>私有仓库 · 本地优先</strong><p>${library ? "连接后可预览并恢复已有剧本。" : "本项目单独关联同步目标，点击「一键同步」时才上传或拉取。"} 同仓库可供其他软件使用，叙线只读写指定数据目录。</p></div>
    ${connections.length ? `<div class="field"><label for="sync-existing">已有连接</label><select class="input" id="sync-existing">${option("", "新连接", initial?.id)}${connections.map((item) => option(item.id, `${item.connection.owner}/${item.connection.repo} · ${item.connection.directory}`, initial?.id)).join("")}</select></div>` : ""}
    <div class="field"><label for="sync-repository">GitHub 私有仓库</label><input class="input" id="sync-repository" placeholder="https://github.com/用户名/xuxian-data" autocomplete="off" autofocus></div>
    <div class="sync-fields"><div class="field"><label for="sync-branch">分支</label><input class="input" id="sync-branch" value="main" autocomplete="off"></div><div class="field"><label for="sync-directory">叙线数据目录</label><input class="input" id="sync-directory" value="xuxian/projects" autocomplete="off"></div></div>
    <div class="field"><label for="sync-token">GitHub Fine-grained Token</label><input class="input" id="sync-token" type="password" autocomplete="new-password" spellcheck="false" placeholder="只在本机 ${credentialStoreName} 保存"><small class="tiny" id="sync-token-hint"></small></div>
    <details class="sync-help"><summary>如何创建和授权令牌</summary><ol><li>创建私有仓库，勾选 README，确认已有 main 分支。</li><li>创建 Fine-grained Token，Resource owner 选仓库所有者。</li><li>Repository access 选择 Only select repositories，仅选数据仓库。</li><li>在 Repository 权限添加 Contents，再将该行设为 Read and write。Account 权限留空。</li><li>令牌只填在此处。换电脑时需在新电脑单独配置令牌。</li></ol><button class="btn small" id="sync-token-page">打开预填授权页</button><p class="tiny">令牌的 GitHub 权限作用于所选仓库，数据目录由叙线约束。共享仓库时，各软件应使用独立目录。</p></details>
    <p class="tiny" id="sync-last-time">上次同步：${esc(displayTime(settings.linked?.lastSync))}</p>
    <p id="sync-settings-message" class="sync-message" role="status"></p>
    ${settings.linked && !library ? '<div class="sync-disconnect"><label><input type="checkbox" id="sync-forget-token"> 同时删除本机令牌（影响使用该连接的其他项目）</label><button class="btn danger small" id="sync-disconnect">断开此项目</button></div>' : ""}
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
      await busy(() =>
        bridgeCall("sync/configure", {
          projectId: library ? "" : state.project.id,
          connection,
          token: input.value,
        }),
      );
      closeModal();
      toast("GitHub 配置已保存，可以一键同步");
      if (onConnected) onConnected();
    } catch (error) {
      if ($("#sync-settings-message"))
        $("#sync-settings-message").textContent = error.message;
    } finally {
      input.value = "";
    }
  };
  if ($("#sync-disconnect"))
    $("#sync-disconnect").onclick = async () => {
      try {
        const forgetToken = $("#sync-forget-token").checked;
        await busy(() =>
          bridgeCall("sync/disconnect", {
            projectId: state.project.id,
            forgetToken,
          }),
        );
        closeModal();
        toast("已断开此项目的 GitHub 同步");
      } catch (error) {
        $("#sync-settings-message").textContent = error.message;
      }
    };
}

const service = new GitHubSyncService(
  {
    inspect: () =>
      bridgeCall("sync/inspect", {
        bindingId: state.bridgeBinding,
        stamp: state.fileStamp,
      }),
    execute: (planId, resolution) =>
      bridgeCall("sync/execute", { planId, resolution }),
    validate: (text) => {
      normalizeProject(JSON.parse(text.replace(/^\uFEFF/, "")));
    },
    apply: (result) => {
      const opened = result.opened;
      const project = normalizeProject(
        JSON.parse(opened.text.replace(/^\uFEFF/, "")),
      );
      if (project.id !== state.project.id)
        throw Error("同步返回了另一份项目，已停止切换");
      if (result.action === "download")
        adopt(
          project,
          opened.name,
          null,
          false,
          opened.stamp,
          opened.bindingId,
        );
      else {
        state.bridgeBinding = opened.bindingId;
        state.fileStamp = opened.stamp;
        state.sourceName = opened.name;
        persist();
        updateTop();
      }
    },
  },
  (next) => {
    const pending = ["saving", "checking", "syncing"].includes(next.phase);
    setBusy(pending);
    if (pending) {
      const labels = {
        saving: "保存本地剧本…",
        checking: "比较 GitHub 与本地版本…",
        syncing: "同步中，请稍候…",
      };
      modal(
        "GitHub 一键同步",
        `<p id="sync-progress" role="status">${labels[next.phase]}</p>`,
      );
      return;
    }
    if (next.phase === "idle") {
      if ($("#sync-progress")) closeModal();
      return;
    }
    if (next.phase === "conflict") {
      const deleted = next.plan.action === "deleted";
      modal(
        deleted ? "GitHub 文件已删除" : "双方都有改动",
        `<div class="help"><p>${deleted ? "这个项目曾经同步过，但 GitHub 上的文件现在不存在。你可以重新上传本地剧本，也可以取消并检查远端目录。" : "本地和 GitHub 都在上次同步后发生改动，需要你选择如何处理。"}</p><p class="sync-path">${esc(next.plan.path)}</p>${!deleted ? "<p>保留本地：先把 GitHub 版本另存为本地冲突副本，再同步当前剧本。<br>使用 GitHub：先自动备份本地，再切换到 GitHub 版本。</p>" : ""}</div>`,
        '<button class="btn" id="sync-cancel">取消</button>' +
          (!deleted
            ? '<button class="btn" id="sync-use-remote">使用 GitHub 版本</button>'
            : "") +
          `<button class="btn primary" id="sync-use-local">${deleted ? "重新上传本地" : "保留本地及远端副本"}</button>`,
        false,
        () => service.cancel(),
      );
      $("#sync-cancel").onclick = () => closeModal();
      $("#sync-use-local").onclick = () => service.resolve("local");
      if ($("#sync-use-remote"))
        $("#sync-use-remote").onclick = () => service.resolve("remote");
      return;
    }
    if (next.phase === "error") {
      modal(
        "GitHub 同步未完成",
        `<p class="sync-message" role="alert">${esc(next.message)}</p><p class="tiny">本地剧本已保留。检查网络或更新令牌后，可以再次点击一键同步。</p>`,
        btn("关闭", null, "modal-close") +
          '<button class="btn" id="sync-error-settings">同步设置</button><button class="btn primary" id="sync-retry">重试</button>',
      );
      $("#sync-error-settings").onclick = () => showSyncSettings();
      $("#sync-retry").onclick = () => oneClickSync();
      return;
    }
    if (next.phase === "done") {
      const result = next.result;
      const labels = {
        upload: "本地剧本已上传 GitHub",
        download: "已拉取 GitHub 的更新",
        current: "本地与 GitHub 已一致",
      };
      modal(
        "GitHub 同步完成",
        `<p role="status">${esc(labels[result.action] || "同步完成")}</p><p class="tiny">${esc(displayTime(result.lastSync))}</p>${result.conflictCopy ? `<p>远端版本已另存到项目库：<br><strong>${esc(result.conflictCopy)}</strong></p>` : ""}`,
        btn("完成", null, "modal-close", "primary"),
      );
    }
  },
);

export async function oneClickSync() {
  if (state.syncBusy) return;
  if (!isNative) return toast("GitHub 同步请使用叙线应用", true);
  try {
    const settings = await bridgeCall("sync/settings", {
      projectId: state.project.id,
    });
    if (!settings.linked) return showSyncSettings();
    await service.synchronize(async () =>
      state.dirty || !state.bridgeBinding ? saveSource() : true,
    );
  } catch (error) {
    toast(error.message, true);
  }
}

export async function showGitHubProjects() {
  if (!isNative) return toast("从 GitHub 恢复项目请使用叙线应用", true);
  let settings;
  try {
    settings = await bridgeCall("sync/settings", { projectId: "" });
  } catch (error) {
    return toast(error.message, true);
  }
  const connections = settings.connections || [];
  if (!connections.length) return showSyncSettings(true, showGitHubProjects);
  modal(
    "GitHub 项目",
    `<div class="field"><label for="sync-remote-connection">数据连接</label><select class="input" id="sync-remote-connection">${connections.map((item) => option(item.id, `${item.connection.owner}/${item.connection.repo} · ${item.connection.directory}`, connections[0].id)).join("")}</select></div><p class="tiny">选择文件可预览项目名称，再恢复到本地。已有同 ID 项目请直接打开并同步。</p><div id="sync-remote-list" class="sync-remote-list" role="status">读取中…</div><div id="sync-remote-preview"></div>`,
    '<button class="btn" id="sync-add-connection">添加连接</button>' +
      btn("关闭", null, "modal-close"),
    true,
  );
  $("#sync-add-connection").onclick = () =>
    showSyncSettings(true, showGitHubProjects);
  const load = async () => {
    const connectionId = $("#sync-remote-connection").value;
    $("#sync-remote-preview").innerHTML = "";
    try {
      const files = await busy(() => bridgeCall("sync/list", { connectionId }));
      $("#sync-remote-list").innerHTML = files.length
        ? files
            .map(
              (file, index) =>
                `<button class="search-item" data-sync-preview="${index}"><strong>${esc(file.name)}</strong><small>${Math.ceil(Number(file.size || 0) / 1024)} KB</small></button>`,
            )
            .join("")
        : '<p class="sync-empty">这个目录还没有剧本。在另一台电脑一键同步后，即可在此恢复。</p>';
      $$("[data-sync-preview]").forEach(
        (button) =>
          (button.onclick = async () => {
            const file = files[Number(button.dataset.syncPreview)];
            try {
              const preview = await busy(() =>
                bridgeCall("sync/preview", {
                  connectionId,
                  fileName: file.name,
                }),
              );
              const project = normalizeProject(
                JSON.parse(preview.text.replace(/^\uFEFF/, "")),
              );
              $("#sync-remote-preview").innerHTML =
                `<div class="sync-preview"><h3>${esc(project.title)}</h3><p>${project.routes.length} 条路线 · ${project.chapters.length} 个章节</p><button class="btn primary" id="sync-restore">恢复到本地</button></div>`;
              $("#sync-restore").onclick = () => {
                guardReplace(async () => {
                  try {
                    const result = await busy(() =>
                      bridgeCall("sync/restore", {
                        connectionId,
                        fileName: file.name,
                        sha: preview.sha,
                      }),
                    );
                    const opened = result.opened;
                    adopt(
                      normalizeProject(
                        JSON.parse(opened.text.replace(/^\uFEFF/, "")),
                      ),
                      opened.name,
                      null,
                      false,
                      opened.stamp,
                      opened.bindingId,
                    );
                    await refreshProjectLibrary();
                    toast("已从 GitHub 恢复 " + project.title);
                  } catch (error) {
                    toast(error.message, true);
                  }
                });
              };
            } catch (error) {
              $("#sync-remote-preview").textContent = error.message;
            }
          }),
      );
    } catch (error) {
      if ($("#sync-remote-list"))
        $("#sync-remote-list").textContent = error.message;
    }
  };
  $("#sync-remote-connection").onchange = load;
  load();
}
